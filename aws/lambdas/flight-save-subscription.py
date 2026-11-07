import base64, json
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import boto3

PLANS = {"tokyo": ("TPE", "TYO"), "seoul": ("TPE", "SEL"), "macau": ("TPE", "MFM")}
T = boto3.resource("dynamodb").Table("subscriptions")


def resp(code, body):
    return {"statusCode": code, "headers": {"content-type": "application/json"}, "body": json.dumps(body)}


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
    if plan not in PLANS:
        return resp(400, {"error": "plan_name must be tokyo, seoul or macau"})
    if not tp.is_finite() or tp <= 0 or tp > 1000000:
        return resp(400, {"error": "target_price must be a positive TWD amount"})
    tp = tp.quantize(Decimal("1"))
    origin, dest = PLANS[plan]
    route = f"{origin}-{dest}"
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    T.update_item(
        Key={"email": email, "route": route},
        UpdateExpression="SET plan_name=:p, origin=:o, destination=:d, target_price=:t, "
                         "currency=:c, updated_at=:n, created_at=if_not_exists(created_at,:n)",
        ExpressionAttributeValues={":p": plan, ":o": origin, ":d": dest, ":t": tp,
                                   ":c": "TWD", ":n": now},
    )
    print("saved", email, route, int(tp))
    return resp(200, {"ok": True, "email": email, "route": route, "plan_name": plan,
                      "target_price": int(tp), "currency": "TWD"})
