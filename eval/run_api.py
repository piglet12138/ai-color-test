import base64, json, subprocess, time, sys, os, re

API = "https://sg.yaoyuheng2001.me/colorstyle/api/coloranalysis"
OUT = "results.jsonl"

def parse_season4(season):
    if not season: return None
    s = season
    m = {"春":"Spring","夏":"Summer","秋":"Autumn","冬":"Winter"}
    for zh,en in m.items():
        if zh in s: return en
    for en in ["Spring","Summer","Autumn","Winter"]:
        if en.lower() in s.lower(): return en
    return None

def parse_undertone(skin_tone):
    if not skin_tone: return None
    t = skin_tone
    # decide warm/cool/neutral. Order matters: neutral first if 中性 present
    warm = ("暖" in t) or ("warm" in t.lower())
    cool = ("冷" in t) or ("cool" in t.lower())
    neutral = ("中性" in t) or ("neutral" in t.lower())
    if neutral and not (warm ^ cool):  # 中性 with neither or both
        return "neutral"
    if neutral and warm: return "neutral-warm"
    if neutral and cool: return "neutral-cool"
    if warm: return "warm"
    if cool: return "cool"
    return "unknown"

def call(path, retries=3):
    b = base64.b64encode(open(path,"rb").read()).decode()
    payload = json.dumps({"image":"data:image/jpeg;base64,"+b})
    tmp = "/tmp/_payload.json"
    open(tmp,"w").write(payload)
    for attempt in range(retries):
        r = subprocess.run(["curl","-s","--noproxy","*","--max-time","70",
                            "-X","POST",API,"-H","Content-Type: application/json",
                            "--data","@"+tmp],capture_output=True,text=True)
        try:
            d = json.loads(r.stdout)
        except Exception:
            d = {"error":"nonjson:"+r.stdout[:200]}
        if "error" in d:
            err = str(d["error"])
            wait = 12 if "429" in err or "limit" in err else 6
            print(f"  attempt {attempt+1} err: {err[:80]} -> wait {wait}s", file=sys.stderr)
            time.sleep(wait)
            continue
        return d
    return {"error":"exhausted"}

def run_one(m, run_tag):
    d = call(m["path"])
    rec = {
        "id": m["id"], "run": run_tag,
        "race": m.get("race"), "gender": m.get("gender"), "age": m.get("age"),
        "ok": "error" not in d,
    }
    if "error" in d:
        rec["error"] = str(d["error"])[:200]
    else:
        rec["season"] = d.get("season")
        rec["season4"] = parse_season4(d.get("season"))
        rec["skin_tone"] = d.get("skin_tone")
        rec["undertone"] = parse_undertone(d.get("skin_tone"))
        recs = d.get("recommend") or []
        rec["rec0_hex"] = recs[0].get("hex") if recs else None
        rec["rec0_name"] = recs[0].get("name") if recs else None
        rec["summary"] = d.get("summary")
        rec["raw"] = d
    return rec

if __name__=="__main__":
    manifest = json.load(open("manifest.json"))
    mode = sys.argv[1] if len(sys.argv)>1 else "main"
    fout = open(OUT,"a")
    if mode=="main":
        for i,m in enumerate(manifest):
            print(f"[{i+1}/{len(manifest)}] {m['id']} ({m['race']}/{m['gender']})", file=sys.stderr)
            rec = run_one(m,"r1")
            fout.write(json.dumps(rec,ensure_ascii=False)+"\n"); fout.flush()
            print("   ->", rec.get("season"), "|", rec.get("skin_tone"), "|", rec.get("error",""), file=sys.stderr)
            time.sleep(3)
    elif mode=="retest":
        ids = sys.argv[2].split(",")
        mp = {m["id"]:m for m in manifest}
        for fid in ids:
            m = mp[fid]
            print(f"[retest] {fid}", file=sys.stderr)
            rec = run_one(m,"r2")
            fout.write(json.dumps(rec,ensure_ascii=False)+"\n"); fout.flush()
            print("   ->", rec.get("season"), file=sys.stderr)
            time.sleep(3)
    fout.close()
