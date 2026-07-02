import json, subprocess, sys

DS = "HuggingFaceM4/FairFace"
CFG = "0.25"
SPLIT = "validation"

def fetch(offset, length):
    url = (f"https://datasets-server.huggingface.co/rows?dataset={DS}"
           f"&config={CFG}&split={SPLIT}&offset={offset}&length={length}")
    out = subprocess.run(["curl","-s","--noproxy","*","--max-time","40",url],
                         capture_output=True, text=True).stdout
    return json.loads(out)

# validation ~10954 rows; sample pages spread across the split
offsets = [0, 500, 1200, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 10500]
rows = []
for off in offsets:
    try:
        d = fetch(off, 30)
        for r in d.get("rows", []):
            row = r["row"]
            rows.append({
                "idx": r["row_idx"],
                "url": row["image"]["src"],
                "age": row["age"],
                "gender": row["gender"],
                "race": row["race"],
            })
    except Exception as e:
        print("skip", off, e, file=sys.stderr)

# dedup by idx
seen=set(); uniq=[]
for r in rows:
    if r["idx"] in seen: continue
    seen.add(r["idx"]); uniq.append(r)

from collections import Counter
print("collected", len(uniq))
print("race:", Counter(r["race"] for r in uniq))
print("gender:", Counter(r["gender"] for r in uniq))
json.dump(uniq, open("meta_pool.json","w"))
