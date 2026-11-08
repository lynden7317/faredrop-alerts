"""Deploy helper: {"key": "deploy/<fn>/<sha>.zip", "files": {"index.py": "..."}, "s3_files": {"x.py": "deploy/src/x.py"}}
→ zip in the config bucket. s3_files lets a shared module be uploaded once (PutObject) and reused.

Exists because the Cowork/cloud sandbox cannot reach S3 directly and inline CloudFormation ZipFile is capped
at 4096 chars. CloudFormation stacks then deploy from Code.S3Bucket/S3Key. Returns size + md5 to verify.
"""
import hashlib, io, os, zipfile
import boto3

S3 = boto3.client("s3")


def handler(event, context):
    key = event["key"]
    if not key.startswith("deploy/") or not key.endswith(".zip"):
        raise ValueError("key must be deploy/*.zip")
    files = dict(event.get("files") or {})
    for name, src_key in (event.get("s3_files") or {}).items():
        if not src_key.startswith("deploy/src/"):
            raise ValueError("s3_files must come from deploy/src/")
        files[name] = S3.get_object(Bucket=os.environ["CONFIG_BUCKET"], Key=src_key)["Body"].read().decode("utf-8")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, src in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            info.external_attr = 0o644 << 16
            z.writestr(info, src)
    data = buf.getvalue()
    S3.put_object(Bucket=os.environ["CONFIG_BUCKET"], Key=key, Body=data, ContentType="application/zip")
    return {"bucket": os.environ["CONFIG_BUCKET"], "key": key, "bytes": len(data),
            "md5": hashlib.md5(data).hexdigest(),
            "sources": {n: hashlib.sha256(s.encode()).hexdigest()[:12] for n, s in files.items()}}
