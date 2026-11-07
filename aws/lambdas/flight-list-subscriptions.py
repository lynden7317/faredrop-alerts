import json
from decimal import Decimal
import boto3
from boto3.dynamodb.conditions import Key

T = boto3.resource("dynamodb").Table("subscriptions")
FIELDS = ("email", "route", "plan_name", "origin", "destination", "target_price",
          "currency", "created_at", "updated_at")


def resp(code, body):
    return {"statusCode": code, "headers": {"content-type": "application/json"}, "body": json.dumps(body)}


def clean(item):
    out = {}
    for k in FIELDS:
        if k in item:
            v = item[k]
            out[k] = int(v) if isinstance(v, Decimal) else v
    return out


def handler(event, context):
    email = ((event.get("queryStringParameters") or {}).get("email") or "").strip().lower()
    if "@" not in email:
        return resp(400, {"error": "email query parameter required"})
    items = T.query(KeyConditionExpression=Key("email").eq(email)).get("Items", [])
    return resp(200, {"email": email, "subscriptions": [clean(i) for i in items]})
