"""SQS flight-status-queue → Resend. ONE consumer for subscription-status emails, routed by event_type:
"welcome" (first charge succeeded) and "cancel" (renewals stopped, service until period end).
Once-only per (email, route, event_type, merchant_trade_no) via a conditional put in notification_history.
"""
import json, os, urllib.error, urllib.request
from datetime import datetime, timezone
import boto3

H = boto3.resource("dynamodb").Table("notification_history")
S3 = boto3.client("s3")
UA = "Mozilla/5.0 (compatible; flight-notifier/1.0)"
SITE_URL = os.environ.get("SITE_URL", "https://faredrop-alerts.vercel.app").rstrip("/")
_s = None
_labels = None


def cfg():
    global _s
    if _s is None:
        _s = json.loads(boto3.client("secretsmanager").get_secret_value(SecretId="flight/resend")["SecretString"])
    return _s


def label(m):
    global _labels
    if _labels is None:
        try:
            body = S3.get_object(Bucket=os.environ["CONFIG_BUCKET"], Key="flight-routes.json")["Body"].read()
            _labels = {f"{r['origin']}-{r['destination']}": r.get("label") for r in json.loads(body)}
        except Exception as e:  # labels are cosmetic; never block the email on them
            print("route labels unavailable", repr(e)[:200])
            _labels = {}
    return _labels.get(m["route"]) or m["route"].replace("-", " ✈ ")


def nt(n):
    try:
        return f"NT${int(float(n)):,}"
    except (TypeError, ValueError):
        return ""


def wrap(title, body_html):
    return (f"<div style='font-family:sans-serif;max-width:480px'><h2>{title}</h2>{body_html}"
            f"<p><a href='{SITE_URL}/app' style='background:#7c3aed;color:#fff;padding:10px 18px;"
            "border-radius:6px;text-decoration:none'>前往我的儀表板</a></p>"
            "<p style='color:#999;font-size:12px'>Flight Price Notifier</p></div>")


def render(m):
    trip, until = label(m), m.get("current_period_end_date") or ""
    if m["event_type"] == "welcome":
        subj = f"✅ 訂閱成功：{trip} 機票降價通知已啟用"
        price = nt(m.get("amount_twd"))
        lines = [f"你的 {trip} 訂閱已付款完成，從現在起票價低於目標價就會寄信通知你。"]
        if m.get("target_price") is not None:
            lines.append(f"目標價：{nt(m['target_price'])}")
        if price:
            lines.append(f"月費：{price}（每月自動扣款，可隨時取消）")
        if until:
            lines.append(f"本期有效至：{until}")
        return subj, wrap("訂閱成功 🎉", "<p>" + "<br>".join(lines) + "</p>"), "\n".join(lines) + f"\n{SITE_URL}/app\n"
    if m["event_type"] == "cancel":
        subj = f"已取消訂閱：{trip}"
        lines = [f"你的 {trip} 訂閱已取消，之後不會再扣款。"]
        if until:
            lines.append(f"已付費的期間內仍會繼續通知，直到 {until}。")
        lines.append("想恢復的話，隨時可以在儀表板重新訂閱。")
        return subj, wrap("已取消訂閱", "<p>" + "<br>".join(lines) + "</p>"), "\n".join(lines) + f"\n{SITE_URL}/app\n"
    return None


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
        rendered = render(m)
        if not rendered:
            print("unknown event_type, dropped", m.get("event_type"))
            continue
        pk = f"status#{m['email']}#{m['route']}#{m['event_type']}#{m.get('merchant_trade_no') or '-'}"
        try:
            H.put_item(Item={"pk": pk, "sent_at": "claimed", "email": m["email"], "route": m["route"],
                             "event_type": m["event_type"]},
                       ConditionExpression="attribute_not_exists(pk)")
        except H.meta.client.exceptions.ConditionalCheckFailedException:
            print("already sent", pk)
            continue
        code, body = send(m["email"], *rendered)
        if 200 <= code < 300:
            H.update_item(Key={"pk": pk, "sent_at": "claimed"}, UpdateExpression="SET delivered_at=:n",
                          ExpressionAttributeValues={":n": datetime.now(timezone.utc).isoformat(timespec="seconds")})
            print("sent", m["event_type"], pk, body)
        elif code == 429 or code >= 500:
            H.delete_item(Key={"pk": pk, "sent_at": "claimed"})  # release the claim so the retry can send
            raise RuntimeError(f"transient resend error {code}: {body}")
        else:
            print("dropped (permanent)", code, pk, body)
