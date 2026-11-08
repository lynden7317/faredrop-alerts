"""POST /subscribe — M2: writes pending_payment and returns the ECPay 定期定額 auto-submit form.

Paid rows (active, or cancelled but still inside the paid period) get an in-place target-price
update and a JSON response — no re-payment. Everything else (new, unpaid, expired, lapsed) gets a
fresh MerchantTradeNo, status=pending_payment, and an HTML form that POSTs the browser to ECPay.
Only the ReturnURL/PeriodReturnURL callbacks ever write `active` (ecpay-best-practice Rule 1).
"""
import base64, html, json, os, secrets, time
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import boto3
import ecpay_common as ec

S3 = boto3.client("s3")
T = boto3.resource("dynamodb").Table("subscriptions")
PERIOD_TYPE = os.environ.get("PERIOD_TYPE", "M")       # M = monthly; D only for renewal testing
EXEC_TIMES = os.environ.get("EXEC_TIMES", "999")       # D/M max 999 (≈ "until cancelled")
SITE_URL = os.environ.get("SITE_URL", "https://faredrop-alerts.vercel.app").rstrip("/")
_plans, _at = {}, 0.0


def plans():
    global _plans, _at
    if time.time() - _at > 60:
        body = S3.get_object(Bucket=os.environ["CONFIG_BUCKET"], Key="flight-routes.json")["Body"].read()
        _plans = {r["plan"]: r for r in json.loads(body)}
        _at = time.time()
    return _plans


def resp(code, body):
    return {"statusCode": code, "headers": {"content-type": "application/json"}, "body": json.dumps(body)}


def is_paid(row):
    s = row.get("subscription_status")
    return s == "active" or (s == "cancelled" and row.get("current_period_end", "") >= ec.now_iso())


def checkout_html(params):
    fields = "".join(f'<input type="hidden" name="{html.escape(k)}" value="{html.escape(str(v), quote=True)}">'
                     for k, v in params.items())
    return ("<!doctype html><html><head><meta charset='utf-8'><title>前往綠界付款…</title></head><body>"
            f"<form method='post' action='{ec.host()}/Cashier/AioCheckOut/V5'>{fields}"
            "<noscript><button type='submit'>前往付款</button></noscript></form>"
            "<p style='font-family:sans-serif'>正在前往綠界付款頁面…</p>"
            "<script>document.forms[0].submit()</script></body></html>")


def handler(event, context):
    try:
        raw = event.get("body") or "{}"
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw).decode("utf-8")
        d = json.loads(raw) if isinstance(raw, str) else raw
        email = str(d.get("email", "")).strip().lower()
        plan = str(d.get("plan_name", "")).strip().lower()
        tp = Decimal(str(d.get("target_price")))
    except (ValueError, TypeError, InvalidOperation, AttributeError):
        return resp(400, {"error": "invalid request body"})
    if "@" not in email:
        return resp(400, {"error": "invalid email"})
    if plan not in plans():
        return resp(400, {"error": "unknown plan_name"})
    if not tp.is_finite() or tp <= 0 or tp > 1000000:
        return resp(400, {"error": "target_price must be a positive TWD amount"})
    tp = tp.quantize(Decimal("1"))
    p = plans()[plan]
    origin, dest = p["origin"], p["destination"]
    route = f"{origin}-{dest}"
    key = {"email": email, "route": route}
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    base = ("SET plan_name=:p, origin=:o, destination=:d, target_price=:t, currency=:c, "
            "updated_at=:n, created_at=if_not_exists(created_at,:n)")
    vals = {":p": plan, ":o": origin, ":d": dest, ":t": tp, ":c": "TWD", ":n": now}
    row = T.get_item(Key=key).get("Item") or {}

    if is_paid(row):  # in-place update, no re-payment, status untouched
        T.update_item(Key=key, UpdateExpression=base, ExpressionAttributeValues=vals)
        print("updated paid row", email, route, int(tp), row.get("subscription_status"))
        return resp(200, {"ok": True, "email": email, "route": route, "plan_name": plan,
                          "target_price": int(tp), "currency": "TWD",
                          "subscription_status": row["subscription_status"],
                          "current_period_end": row.get("current_period_end"),
                          "current_period_end_date": row.get("current_period_end_date")})

    c = ec.cfg()
    amount = str(int(Decimal(str(c["amount"]))))
    mtn = "FD" + datetime.now(ec.TW).strftime("%y%m%d%H%M%S") + secrets.token_hex(3).upper()  # 20 chars
    T.update_item(Key=key, UpdateExpression=base + ", subscription_status=:s, merchant_trade_no=:m, "
                  "period_type=:pt, amount_twd=:a",
                  ExpressionAttributeValues={**vals, ":s": "pending_payment", ":m": mtn,
                                             ":pt": PERIOD_TYPE, ":a": int(amount)})
    api = "https://" + event["requestContext"]["domainName"]
    params = {
        "MerchantID": c["merchant_id"], "MerchantTradeNo": mtn,
        "MerchantTradeDate": datetime.now(ec.TW).strftime("%Y/%m/%d %H:%M:%S"),
        "PaymentType": "aio", "TotalAmount": amount,
        "TradeDesc": "Flight Price Notifier monthly plan",
        "ItemName": f"機票降價通知 月訂閱 {p.get('label') or route}",
        "ReturnURL": f"{api}/ecpay-return", "ChoosePayment": "Credit", "EncryptType": "1",
        "PeriodAmount": amount, "PeriodType": PERIOD_TYPE, "Frequency": "1", "ExecTimes": EXEC_TIMES,
        "PeriodReturnURL": f"{api}/ecpay-period", "OrderResultURL": f"{api}/ecpay-result",
        "ClientBackURL": f"{SITE_URL}/app",
        "CustomField1": email, "CustomField2": route,
    }
    params["CheckMacValue"] = ec.gen_cmv(params)
    print("checkout", email, route, mtn, amount, PERIOD_TYPE, EXEC_TIMES)
    return {"statusCode": 200, "headers": {"content-type": "text/html; charset=utf-8"},
            "body": checkout_html(params)}
