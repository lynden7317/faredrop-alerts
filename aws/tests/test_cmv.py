"""Run: python3 -I aws/tests/test_cmv.py <path-to>/checkmacvalue.json"""
import json, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lambdas"))
import ecpay_common as e

vecs = json.load(open(sys.argv[1]))["vectors"]
ok = bad = 0
for v in vecs:
    if v.get("method") != "SHA256" or "params" not in v:
        continue
    got = e.gen_cmv(v["params"], v["hashKey"], v["hashIV"])
    if got == v["expected"]:
        ok += 1
    else:
        bad += 1
        print("FAIL", v["name"], got, v["expected"])
print(f"SHA256 vectors: {ok} passed, {bad} failed")
sys.exit(1 if bad else 0)
