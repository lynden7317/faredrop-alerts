import json, os, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone
from decimal import Decimal
import boto3
from boto3.dynamodb.conditions import Attr

UA = "Mozilla/5.0 (compatible; flight-notifier/1.0)"
_sm = boto3.client("secretsmanager")
_sqs = boto3.client("sqs")
_tbl = boto3.resource("dynamodb").Table("subscriptions")
_fares = boto3.resource("dynamodb").Table("latest_fares")
_token = None
_qurl = None


def token():
    global _token
    if _token is None:
        _token = json.loads(_sm.get_secret_value(SecretId="flight/travelpayouts")["SecretString"])["token"]
    return _token


def qurl():
    global _qurl
    if _qurl is None:
        _qurl = _sqs.get_queue_url(QueueName="flight-fare-queue")["QueueUrl"]
    return _qurl


def next_month():
    n = datetime.now(timezone.utc)
    y, m = (n.year + 1, 1) if n.month == 12 else (n.year, n.month + 1)
    return f"{y:04d}-{m:02d}"


def fetch_cheapest(origin, dest, month, currency):
    q = urllib.parse.urlencode({"origin": origin, "destination": dest, "depart_date": month,
                                "currency": currency, "token": token()})
    req = urllib.request.Request(f"https://api.travelpayouts.com/v1/prices/cheap?{q}",
                                 headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            body = json.loads(r.read())
    except (urllib.error.URLError, ValueError) as e:
        print("fetch failed", origin, dest, currency, repr(e)[:200])
        return None
    if not body.get("success") or not body.get("data"):
        print("no data", origin, dest, currency, str(body)[:200])
        return None
    offers = body["data"].get(dest) or {}
    if not offers:
        return None
    best = min(offers.values(), key=lambda o: o["price"])
    return {"price": best["price"], "currency": currency.upper(), "airline": best.get("airline"),
            "depart_date": best.get("departure_at"), "return_date": best.get("return_at")}


def handler(event, context):
    origin, dest = event["origin"], event["destination"]
    route = event.get("route") or f"{origin}-{dest}"
    month = next_month()
    tw = fetch_cheapest(origin, dest, month, "twd")
    if not tw:
        print("no TWD fare for", route, month, "- skipping")
        return {"ok": True, "route": route, "matched": 0}
    us = fetch_cheapest(origin, dest, month, "usd")
    print(route, month, "cheapest", tw["price"], "TWD", tw["airline"],
          "| USD", us["price"] if us else None)
    snap = {"route": route, "price_twd": Decimal(str(tw["price"])), "airline": tw["airline"] or "-",
            "depart_date": tw["depart_date"] or "", "month": month,
            "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    if us:
        snap["price_usd"] = Decimal(str(us["price"]))
    _fares.put_item(Item=snap)
    items, kw = [], {"FilterExpression": Attr("route").eq(route)}
    while True:
        page = _tbl.scan(**kw)
        items += page.get("Items", [])
        if "LastEvaluatedKey" not in page:
            break
        kw["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    matched = 0
    for it in items:
        tp = it.get("target_price")
        if tp is None or Decimal(tp) < Decimal(str(tw["price"])):
            continue
        body = {"email": it["email"], "route": route, "plan_name": it.get("plan_name"),
                "target_price": int(tp), "cheapest": tw, "trip": event.get("trip") or route}
        if us:
            body["cheapest_usd"] = us
        _sqs.send_message(QueueUrl=qurl(), MessageBody=json.dumps(body))
        matched += 1
    print(route, "subscribers", len(items), "matched", matched)
    return {"ok": True, "route": route, "matched": matched, "cheapest_twd": tw["price"]}
