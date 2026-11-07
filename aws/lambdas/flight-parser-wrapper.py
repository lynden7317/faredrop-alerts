import json, os
import boto3

s3 = boto3.client("s3")
lam = boto3.client("lambda")


def handler(event, context):
    obj = s3.get_object(Bucket=os.environ["CONFIG_BUCKET"], Key="flight-routes.json")
    routes = json.loads(obj["Body"].read())
    for r in routes:
        payload = {"origin": r["origin"], "destination": r["destination"],
                   "route": f'{r["origin"]}-{r["destination"]}', "plan": r.get("plan")}
        lam.invoke(FunctionName="flight-parser", InvocationType="Event",
                   Payload=json.dumps(payload).encode())
        print("dispatched", payload["route"])
    return {"ok": True, "dispatched": len(routes)}
