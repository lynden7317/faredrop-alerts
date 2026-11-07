import json, os, urllib.error, urllib.request
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import boto3
from boto3.dynamodb.conditions import Key

H = boto3.resource("dynamodb").Table("notification_history")
CITY = {"TPE": "台北", "TYO": "東京", "SEL": "首爾"}
UA = "Mozilla/5.0 (compatible; flight-notifier/1.0)"
_s = None


def cfg():
    global _s
    if _s is None:
        _s = json.loads(boto3.client("secretsmanager").get_secret_value(SecretId="flight/resend")["SecretString"])
    return _s


def nt(n):
    return f"NT${int(n):,}"


def link(route, f):
    o, d = route.split("-")
    dd = lambda s: s[8:10] + s[5:7] if s else ""
    return f"https://www.aviasales.com/search/{o}{dd(f.get('depart_date'))}{d}{dd(f.get('return_date'))}"


def render(m):
    o, d = m["route"].split("-")
    f, u = m["cheapest"], m.get("cheapest_usd")
    trip = f"{CITY.get(o, o)} → {CITY.get(d, d)}"
    subj = f"✈️ {trip} 降價通知！{nt(f['price'])} 已達標"
    dates = f"{(f.get('depart_date') or '')[:10]} 出發 / {(f.get('return_date') or '')[:10]} 回程"
    usd = f"約 US${u['price']}" if u else ""
    url = link(m["route"], f)
    html = (f"<div style='font-family:sans-serif;max-width:480px'><h2>{trip} 降價了</h2>"
            f"<p style='font-size:28px;font-weight:bold;margin:8px 0'>{nt(f['price'])}</p>"
            + (f"<p style='color:#666;margin:0'>{usd}</p>" if usd else "")
            + f"<p>你的目標價：{nt(m['target_price'])}<br>{dates}<br>航空公司：{f.get('airline') or '-'}</p>"
            f"<p><a href='{url}' style='background:#7c3aed;color:#fff;padding:10px 18px;"
            f"border-radius:6px;text-decoration:none'>立即訂購</a></p>"
            "<p style='color:#999;font-size:12px'>Flight Price Notifier</p></div>")
    text = (f"{trip} 降價了：{nt(f['price'])} {usd}\n目標價：{nt(m['target_price'])}\n{dates}\n"
            f"航空公司：{f.get('airline') or '-'}\n立即訂購：{url}\n")
    return subj, html, text


def should_send(pk, price):
    rows = H.query(KeyConditionExpression=Key("pk").eq(pk), ScanIndexForward=False, Limit=1)["Items"]
    if not rows:
        return True
    last = rows[0]
    floor = int(os.environ.get("NOTIFY_FLOOR_HOURS", "24"))
    if datetime.fromisoformat(last["sent_at"]) < datetime.now(timezone.utc) - timedelta(hours=floor):
        return True
    lp = Decimal(last["price"])
    pct = Decimal(os.environ.get("REALERT_PCT", "20"))
    ab = Decimal(os.environ.get("REALERT_ABS_TWD", "2000"))
    return price <= lp * (1 - pct / 100) or (lp - price) >= ab


def send(to, subj, html, text):
    s = cfg()
    req = urllib.request.Request("https://api.resend.com/emails", method="POST",
        data=json.dumps({"from": s["from"], "to": to, "subject": subj, "html": html, "text": text}).encode(),
        headers={"Authorization": "Bearer " + s["api_key"], "Content-Type": "application/json", "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]


def handler(event, context):
    for rec in event.get("Records", []):
        m = json.loads(rec["body"])
        pk = f"{m['email']}#{m['route']}"
        price = Decimal(str(m["cheapest"]["price"]))
        if not should_send(pk, price):
            print("skipped (deduped)", pk, price)
            continue
        code, body = send(m["email"], *render(m))
        if 200 <= code < 300:
            H.put_item(Item={"pk": pk, "sent_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                             "email": m["email"], "route": m["route"], "price": price, "currency": "TWD"})
            print("sent", pk, price, body)
        elif code == 429 or code >= 500:
            raise RuntimeError(f"transient resend error {code}: {body}")
        else:
            print("dropped (permanent)", code, pk, body)
