import json, subprocess, random
from collections import defaultdict
from PIL import Image
import io, os

random.seed(42)
pool = json.load(open("meta_pool.json"))

RACE = {0:"White",1:"Black",2:"Latino_Hispanic",3:"East Asian",
        4:"Southeast Asian",5:"Indian",6:"Middle Eastern"}
GENDER = {0:"Male",1:"Female"}

by_race = defaultdict(list)
for r in pool:
    by_race[r["race"]].append(r)

sample = []
PER_RACE = 5
for race, items in by_race.items():
    random.shuffle(items)
    # try to balance gender within race
    males=[i for i in items if i["gender"]==0]
    females=[i for i in items if i["gender"]==1]
    pick=[]
    mi=fi=0
    for k in range(PER_RACE):
        if k%2==0 and mi<len(males): pick.append(males[mi]); mi+=1
        elif fi<len(females): pick.append(females[fi]); fi+=1
        elif mi<len(males): pick.append(males[mi]); mi+=1
    sample.extend(pick[:PER_RACE])

print("sample size", len(sample))
os.makedirs("faces", exist_ok=True)
manifest=[]
for i,r in enumerate(sample):
    fid=f"face_{i:03d}"
    raw = subprocess.run(["curl","-s","--noproxy","*","--max-time","40",r["url"]],
                         capture_output=True).stdout
    try:
        im=Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as e:
        print("FAIL download", fid, e); continue
    w,h=im.size
    if max(w,h)>512:
        s=512/max(w,h); im=im.resize((int(w*s),int(h*s)))
    path=f"faces/{fid}.jpg"
    im.save(path,"JPEG",quality=90)
    manifest.append({"id":fid,"path":path,"idx":r["idx"],
                     "race":RACE[r["race"]],"gender":GENDER[r["gender"]],"age":r["age"]})

json.dump(manifest, open("manifest.json","w"), indent=2)
from collections import Counter
print("downloaded", len(manifest))
print("race:", Counter(m["race"] for m in manifest))
print("gender:", Counter(m["gender"] for m in manifest))
