"""Shared ECPay (綠界) helpers for the M2 Lambdas — bundled into each zip next to index.py.

stdlib + boto3 only (no SDK, no layer). CheckMacValue follows ecpay-best-practice Rule 2 and
is checked against .claude/skills/ecpay/test-vectors/checkmacvalue.json (aws/tests/).
"""
import base64, hashlib, json, urllib.parse
from datetime import datetime, timedelta, timezone
import boto3

TW = timezone(timedelta(hours=8))  # ECPay timestamps (MerchantTradeDate) are Taiwan local time
HOSTS = {"stage": "https://payment-stage.ecpay.com.tw", "prod": "https://payment.ecpay.com.tw"}
STATUS_QUEUE = "flight-status-queue"

_cfg = None
_qurl = None


def cfg():
    """flight/ecpay: merchant_id, hash_key, hash_iv, env (stage|prod), amount (TWD)."""
    global _cfg
    if _cfg is None:
        sm = boto3.client("secretsmanager")
        _cfg = json.loads(sm.get_secret_value(SecretId="flight/ecpay")["SecretString"])
    return _cfg


def host():
    return HOSTS["prod" if cfg().get("env") == "prod" else "stage"]


# ---- CheckMacValue (SHA256) ------------------------------------------------------------
def url_encode(s):
    e = urllib.parse.quote_plus(str(s)).replace("~", "%7E").lower()
    for o, n in (("%2d", "-"), ("%5f", "_"), ("%2e", "."), ("%21", "!"),
                 ("%2a", "*"), ("%28", "("), ("%29", ")")):
        e = e.replace(o, n)
    return e


def gen_cmv(params, hash_key=None, hash_iv=None):
    hk = hash_key if hash_key is not None else cfg()["hash_key"]
    hi = hash_iv if hash_iv is not None else cfg()["hash_iv"]
    items = {k: v for k, v in params.items() if k != "CheckMacValue"}  # KEEP "" values
    body = "&".join(f"{k}={items[k]}" for k in sorted(items, key=str.lower))
    return hashlib.sha256(url_encode(f"HashKey={hk}&{body}&HashIV={hi}").encode()).hexdigest().upper()


def verify_cmv(params):
    return bool(params.get("CheckMacValue")) and params["CheckMacValue"].upper() == gen_cmv(params)


# ---- HTTP helpers ----------------------------------------------------------------------
def parse_form(event):
    """ECPay callbacks are application/x-www-form-urlencoded. Keep blank values (Rule 2)."""
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8")
    return {k: v[0] for k, v in urllib.parse.parse_qs(raw, keep_blank_values=True).items()}


def text(body, status=200):
    return {"statusCode": status, "headers": {"Content-Type": "text/plain; charset=utf-8"}, "body": body}


# ---- time: ONE fixed-width UTC format everywhere (string-compared in the parser) --------
def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def now_iso():
    return iso(datetime.now(timezone.utc))


def add_period(dt, period_type="M"):
    if period_type == "D":
        return dt + timedelta(days=1)
    if period_type == "Y":
        return dt.replace(year=dt.year + 1, day=min(dt.day, 28))
    y, m = (dt.year + 1, 1) if dt.month == 12 else (dt.year, dt.month + 1)
    for d in (dt.day, 30, 29, 28):  # clamp e.g. Jan 31 → Feb 28
        try:
            return dt.replace(year=y, month=m, day=d)
        except ValueError:
            continue


def next_period_end(row, period_type):
    """Extend from the later of now and the existing paid-through date (renewals stack)."""
    now = datetime.now(timezone.utc)
    cur = row.get("current_period_end")
    base = now
    if cur:
        try:
            base = max(now, datetime.strptime(cur, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc))
        except ValueError:
            pass
    end = add_period(base, period_type)
    return iso(end), end.astimezone(TW).strftime("%Y-%m-%d")


# ---- callbacks (ReturnURL = first charge, PeriodReturnURL = renewals) -------------------
MAX_FAILURES = 6  # ECPay auto-terminates the series after 6 consecutive failed renewals (Rule 10)


def handle_callback(event, kind):
    """Verify CMV, then flip the row. Always ack 1|OK once verified (ECPay resends otherwise)."""
    p = parse_form(event)
    mtn, rtn = p.get("MerchantTradeNo", ""), p.get("RtnCode", "")
    print(kind, "callback", mtn, "RtnCode", rtn, p.get("RtnMsg"), "SimulatePaid", p.get("SimulatePaid"),
          "TotalSuccessTimes", p.get("TotalSuccessTimes"), "keys", sorted(p))
    if not verify_cmv(p):
        print("CheckMacValueInvalid received", p.get("CheckMacValue"), "expected", gen_cmv(p))
        return text("0|CheckMacValueInvalid", 400)
    if p.get("MerchantID") != cfg()["merchant_id"]:
        print("MerchantID mismatch", p.get("MerchantID"))
        return text("0|MerchantIDMismatch", 400)
    if p.get("SimulatePaid") == "1":  # stage 模擬付款 — reachable + verified, but never grants access
        print("SimulatePaid=1 — acked, no state change")
        return text("1|OK")
    email, route = p.get("CustomField1", ""), p.get("CustomField2", "")
    tbl = boto3.resource("dynamodb").Table("subscriptions")
    key = {"email": email, "route": route}
    row = tbl.get_item(Key=key).get("Item") if email and route else None
    if not row:
        print("no subscription row for", email, route)
        return text("1|OK")
    ptype = p.get("PeriodType") or row.get("period_type") or "M"
    times = int(p.get("TotalSuccessTimes") or (1 if kind == "return" else 0) or 0)
    seen = int(row.get("success_times") or 0)
    now = now_iso()

    if rtn != "1":
        if kind == "return":
            print("first authorization failed — row stays", row.get("subscription_status"))
            return text("1|OK")
        fails = int(row.get("consecutive_failures") or 0) + 1
        expire = fails >= MAX_FAILURES
        tbl.update_item(Key=key, UpdateExpression="SET consecutive_failures=:f, last_failed_at=:n"
                        + (", subscription_status=:x" if expire else ""),
                        ExpressionAttributeValues={":f": fails, ":n": now, **({":x": "expired"} if expire else {})})
        print("renewal failed", fails, "consecutive", "→ expired" if expire else "(ECPay will retry)")
        return text("1|OK")

    already = row.get("merchant_trade_no") == mtn and (
        (kind == "return" and row.get("subscription_status") in ("active", "cancelled"))
        or (kind == "period" and times and times <= seen))
    if already:
        print("duplicate callback — already processed", mtn, times)
        return text("1|OK")
    if kind == "period" and row.get("merchant_trade_no") != mtn:
        print("renewal for a superseded order", mtn, "row has", row.get("merchant_trade_no"))
        return text("1|OK")

    end, end_date = next_period_end(row, ptype)
    status = "cancelled" if row.get("subscription_status") == "cancelled" else "active"
    expr = ("SET subscription_status=:s, merchant_trade_no=:m, period_type=:pt, current_period_end=:e, "
            "current_period_end_date=:ed, last_charged_at=:n, success_times=:t, consecutive_failures=:z")
    vals = {":s": status, ":m": mtn, ":pt": ptype, ":e": end, ":ed": end_date, ":n": now,
            ":t": max(times, seen + 1), ":z": 0}
    if kind == "return":
        expr += ", activated_at=:n"
    tbl.update_item(Key=key, UpdateExpression=expr, ExpressionAttributeValues=vals)
    print(kind, "→", status, email, route, "paid through", end)
    if kind == "return":
        enqueue_status("welcome", email, route, merchant_trade_no=mtn, plan_name=row.get("plan_name"),
                       target_price=row.get("target_price"), current_period_end_date=end_date,
                       amount_twd=p.get("PeriodAmount") or p.get("TradeAmt") or row.get("amount_twd"))
    return text("1|OK")


# ---- status notifications: one queue, one consumer, routed by event_type ---------------
def enqueue_status(event_type, email, route, **extra):
    global _qurl
    sqs = boto3.client("sqs")
    if _qurl is None:
        _qurl = sqs.get_queue_url(QueueName=STATUS_QUEUE)["QueueUrl"]
    msg = {"event_type": event_type, "email": email, "route": route, **extra}
    sqs.send_message(QueueUrl=_qurl, MessageBody=json.dumps(msg, default=str))
