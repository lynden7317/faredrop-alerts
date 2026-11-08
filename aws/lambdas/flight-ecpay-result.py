"""ANY /ecpay-result — ECPay OrderResultURL. The browser arrives by POST, which a static SPA answers
with 405, so this only turns it into a 302 back to the dashboard. It never changes subscription state."""
import base64, os, urllib.parse

SITE_URL = os.environ.get("SITE_URL", "https://faredrop-alerts.vercel.app").rstrip("/")


def handler(event, context):
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8", "replace")
    rtn = (urllib.parse.parse_qs(raw).get("RtnCode") or [""])[0]
    result = "success" if rtn in ("1", "") else "failed"
    print("order result", rtn, "→", result)
    return {"statusCode": 302, "headers": {"Location": f"{SITE_URL}/app?purchase={result}"}, "body": ""}
