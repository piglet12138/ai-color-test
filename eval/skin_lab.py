"""Estimate skin undertone warmth via CIELAB b* of median skin pixel.
No numpy: pure PIL + math. Skin mask via YCbCr heuristic + center crop weighting.
"""
import math
from PIL import Image

def rgb_to_ycbcr(r,g,b):
    y = 0.299*r + 0.587*g + 0.114*b
    cb = 128 - 0.168736*r - 0.331264*g + 0.5*b
    cr = 128 + 0.5*r - 0.418688*g - 0.081312*b
    return y,cb,cr

def is_skin(r,g,b):
    y,cb,cr = rgb_to_ycbcr(r,g,b)
    # common YCbCr skin range
    return (77<=cb<=135) and (133<=cr<=173) and y>40

# sRGB -> XYZ -> Lab (D65)
def rgb_to_lab(r,g,b):
    def inv(c):
        c/=255.0
        return ((c+0.055)/1.055)**2.4 if c>0.04045 else c/12.92
    r,g,b = inv(r),inv(g),inv(b)
    x = r*0.4124+g*0.3576+b*0.1805
    y = r*0.2126+g*0.7152+b*0.0722
    z = r*0.0193+g*0.1192+b*0.9505
    xn,yn,zn = 0.95047,1.0,1.08883
    def f(t):
        return t**(1/3) if t>0.008856 else 7.787*t+16/116
    fx,fy,fz = f(x/xn),f(y/yn),f(z/zn)
    L = 116*fy-16
    a = 500*(fx-fy)
    bb = 200*(fy-fz)
    return L,a,bb

def analyze(path):
    im = Image.open(path).convert("RGB")
    w,h = im.size
    px = im.load()
    # sample center region (faces are roughly centered/cropped)
    x0,x1 = int(w*0.20), int(w*0.80)
    y0,y1 = int(h*0.20), int(h*0.80)
    skin=[]
    step = max(1,(x1-x0)//60)
    for y in range(y0,y1,step):
        for x in range(x0,x1,step):
            r,g,b = px[x,y]
            if is_skin(r,g,b):
                skin.append((r,g,b))
    if len(skin) < 15:
        # fallback: use all center pixels
        for y in range(y0,y1,step):
            for x in range(x0,x1,step):
                skin.append(px[x,y])
    # median per channel
    rs=sorted(p[0] for p in skin); gs=sorted(p[1] for p in skin); bs=sorted(p[2] for p in skin)
    m=len(skin)//2
    R,G,B = rs[m],gs[m],bs[m]
    L,a,bstar = rgb_to_lab(R,G,B)
    return {"skin_rgb":[R,G,B],"L":round(L,2),"a":round(a,2),"b":round(bstar,2),
            "n_skin":len(skin)}

if __name__=="__main__":
    import sys, json, os
    res={}
    for f in sorted(os.listdir("faces")):
        res[f.replace('.jpg','')] = analyze("faces/"+f)
    json.dump(res, open("skin_lab.json","w"), indent=2)
    bs=[v["b"] for v in res.values()]
    Ls=[v["L"] for v in res.values()]
    print("n", len(res))
    print("b range", round(min(bs),1), "..", round(max(bs),1), "mean", round(sum(bs)/len(bs),1))
    print("L range", round(min(Ls),1), "..", round(max(Ls),1))
