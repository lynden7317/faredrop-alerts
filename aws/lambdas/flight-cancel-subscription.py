"""POST /cancel {email, route} — stop renewals at ECPay, keep service until current_period_end.

Calls CreditCardPeriodAction Action=Cancel, then sets subscription_status=cancelled (NOT expired).
The parser keeps alerting until current_period_end passes, then flips the row to expired.
"""
import base64, json, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone
import boto3
import ecpay_common as ec

T = boto3.resource("dynamodb").Table("subscriptions")
UA = "Mozilla/5.0 (compatible; flight-notifier/1.0)"


def resp(code, body):
    return {"statusCode": code, "headers": {"content-type": "application/json"}, "body": json.dumps(body)}


def ecpay_cancel(mtn):
    c = ec.cfg()
    params = {"MerchantID": c["merchant_id"], "MerchantTradeNo": mtn, "Action": "Cancel",
              "TimeStamp": str(int(time.time()))}
    params["CheckMacValue"] = ec.gen_cmv(params)
    req = urllib.request.Request(f"{ec.host()}/Cashier/CreditCardPeriodAction", method="POST",
                                 data=urllib.parse.urlencode(params).encode(),
                                 headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            body = r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:300]
    except urllib.error.URLError as e:
        return {"RtnCode": "", "RtnMsg": f"network error {e!r}"[:200]}
    parsed = {k: v[0] for k, v in urllib.parse.parse_qs(body, keep_blank_values=True).items()}
    return parsed or {"RtnCode": "", "RtnMsg": body[:200]}


def handler(event, context):
    try:
        raw = event.get("body") or "{}"
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw).decode("utf-8")
        d = json.loads(raw)
        email = str(d.get("email", "")).strip().lower()
        route = str(d.get("route", "")).strip().upper()
    except (ValueError, TypeError, AttributeError):
        return resp(400, {"error": "invalid request body"})
    if "@" not in email or "-" not in route:
        return resp(400, {"error": "email and route required"})
    key = {"email": email, "route": route}
    row = T.get_item(Key=key).get("Item")
    if not row:
        return resp(404, {"error": "subscription not found"})
    status = row.get("subscription_status")
    if status in ("cancelled", "expired"):
        return resp(200, {"ok": True, "subscription_status": status,
                          "current_period_end_date": row.get("current_period_end_date")})
    if status != "active":
        return resp(409, {"error": f"subscription is {status or 'unpaid'}, nothing to cancel"})

    r = ecpay_cancel(row.get("merchant_trade_no", ""))
    print("ECPay CreditCardPeriodAction Cancel", row.get("merchant_trade_no"), r.get("RtnCode"), r.get("RtnMsg"))
    # A non-1 RtnCode (e.g. stage 90100150 for a never-scheduled order) is logged; we still cancel locally.

    end, end_date = row.get("current_period_end"), row.get("current_period_end_date")
    if not end:  # migration fallback: activated before period tracking existed
        end, end_date = ec.next_period_end({}, "M")
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    T.update_item(Key=key, UpdateExpression="SET subscription_status=:s, current_period_end=:e, "
                  "current_period_end_date=:ed, cancelled_at=:n, ecpay_cancel_rtn=:r, updated_at=:n",
                  ExpressionAttributeValues={":s": "cancelled", ":e": end, ":ed": end_date, ":n": now,
                                             ":r": f"{r.get('RtnCode', '')}|{r.get('RtnMsg', '')}"[:200]})
    ec.enqueue_status("cancel", email, route, merchant_trade_no=row.get("merchant_trade_no"),
                      plan_name=row.get("plan_name"), current_period_end_date=end_date)
    print("cancelled", email, route, "service until", end)
    return resp(200, {"ok": True, "subscription_status": "cancelled", "current_period_end": end,
                      "current_period_end_date": end_date, "ecpay_rtn_code": r.get("RtnCode")})
