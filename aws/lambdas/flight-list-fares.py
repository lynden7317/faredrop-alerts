import json
from decimal import Decimal
import boto3

T = boto3.resource("dynamodb").Table("latest_fares")


def handler(event, context):
    items = T.scan().get("Items", [])
    fares = [{k: (int(v) if isinstance(v, Decimal) else v) for k, v in i.items()} for i in items]
    return {"statusCode": 200,
            "headers": {"content-type": "application/json", "cache-control": "public, max-age=300"},
            "body": json.dumps({"fares": fares})}
