import json
from collections import Counter, defaultdict

recs = [json.loads(l) for l in open("results.jsonl")]
skin = json.load(open("skin_lab.json"))

r1 = {r["id"]:r for r in recs if r["run"]=="r1"}
r2 = {r["id"]:r for r in recs if r["run"]=="r2"}

print("="*60)
print("SAMPLE:", len(r1), "faces | retest:", len(r2))

# ---- distributions ----
print("\n--- 12-season distribution ---")
s12 = Counter(r["season"] for r in r1.values())
for k,v in s12.most_common():
    print(f"  {v:2d}  {k}")

print("\n--- 4-season distribution ---")
s4 = Counter(r["season4"] for r in r1.values())
for k,v in s4.most_common():
    print(f"  {v:2d}  {k}")

print("\n--- undertone distribution ---")
ut = Counter(r["undertone"] for r in r1.values())
for k,v in ut.most_common():
    print(f"  {v:2d}  {k}")

# ---- undertone vs b* ----
print("\n--- undertone vs measured skin b* (warmth) ---")
# map undertone to warm-score
warm_score = {"warm":2,"neutral-warm":1,"neutral":0,"neutral-cool":-1,"cool":-2,"unknown":None}
pairs=[]
for fid,r in r1.items():
    b = skin[fid]["b"]
    ws = warm_score.get(r["undertone"])
    if ws is not None:
        pairs.append((ws,b,fid,r["undertone"]))
# group means
by_ut = defaultdict(list)
for ws,b,fid,u in pairs:
    by_ut[u].append(b)
for u in ["warm","neutral-warm","neutral","neutral-cool","cool"]:
    if u in by_ut:
        vals=by_ut[u]
        print(f"  {u:14s} n={len(vals):2d}  mean b*={sum(vals)/len(vals):5.1f}  range {min(vals):.1f}..{max(vals):.1f}")

# Spearman-ish: pearson between warm_score and b*
import math
xs=[p[0] for p in pairs]; ys=[p[1] for p in pairs]
n=len(xs); mx=sum(xs)/n; my=sum(ys)/n
cov=sum((x-mx)*(y-my) for x,y in zip(xs,ys))
sx=math.sqrt(sum((x-mx)**2 for x in xs)); sy=math.sqrt(sum((y-my)**2 for y in ys))
pear = cov/(sx*sy) if sx*sy else 0
print(f"  Pearson r(undertone_warm_score, skin_b*) = {pear:.3f}  (n={n})")

# ---- consistency ----
print("\n--- test-retest consistency (6 faces) ---")
same12=same4=0
for fid in r2:
    a=r1[fid]; b=r2[fid]
    e12 = a["season"]==b["season"]
    e4 = a["season4"]==b["season4"]
    same12+=e12; same4+=e4
    print(f"  {fid}: r1={a['season']:26s} r2={b['season']:26s} 12same={e12} 4same={e4}")
print(f"  12-season exact match: {same12}/{len(r2)} = {same12/len(r2)*100:.0f}%")
print(f"  4-season match:        {same4}/{len(r2)} = {same4/len(r2)*100:.0f}%")

# ---- by race ----
print("\n--- by race: season4 & undertone ---")
by_race=defaultdict(list)
for r in r1.values():
    by_race[r["race"]].append(r)
for race in sorted(by_race):
    rs=by_race[race]
    s4c=Counter(r["season4"] for r in rs)
    utc=Counter(r["undertone"] for r in rs)
    bmean=sum(skin[r["id"]]["b"] for r in rs)/len(rs)
    Lmean=sum(skin[r["id"]]["L"] for r in rs)/len(rs)
    print(f"  {race:16s} n={len(rs)} L*={Lmean:4.0f} b*={bmean:4.1f} | season4={dict(s4c)} | undertone={dict(utc)}")

# ---- L* vs deep/light season ----
print("\n--- measured L* by 12-season (lightness vs season depth) ---")
by_s=defaultdict(list)
for fid,r in r1.items():
    by_s[r["season"]].append(skin[fid]["L"])
for s in sorted(by_s, key=lambda k:-sum(by_s[k])/len(by_s[k])):
    v=by_s[s]
    print(f"  {s:26s} n={len(v):2d} mean L*={sum(v)/len(v):4.1f}")

print("\n--- failure/parse ---")
print("  parse failures (undertone unknown):", sum(1 for r in r1.values() if r['undertone']=='unknown'))
print("  API failures:", sum(1 for r in r1.values() if not r['ok']))
