import json, os
import boto3

S3 = boto3.client("s3")


def handler(event, context):
    body = S3.get_object(Bucket=os.environ["CONFIG_BUCKET"], Key="flight-routes.json")["Body"].read()
    routes = [{"name": r["plan"], "label": r.get("label") or f'{r["origin"]} ✈ {r["destination"]}',
               "route": f'{r["origin"]}-{r["destination"]}'} for r in json.loads(body)]
    return {"statusCode": 200,
            "headers": {"content-type": "application/json", "cache-control": "public, max-age=300"},
            "body": json.dumps({"routes": routes}, ensure_ascii=False)}
