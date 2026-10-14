"""Repository card docs/social_preview.png (1280 x 640) for GitHub (Settings -> Social preview) and link previews.

The image panel is the slice through the sphere centres of the demo dataset (digital IEC phantom, replicate 1) with the
ROIs found by the analysis core. Important content is kept >= 80 px from the edges. Fonts: Segoe UI (Windows).
Requires: numpy, pydicom, matplotlib, Pillow; Node.js for the analysis.

  node tests/analyse.js demo/NEMA_IQ_demo_digital_phantom.zip demo_out.json 2012 4
  python docs/make_social_preview.py demo/NEMA_IQ_demo_digital_phantom.zip demo_out.json docs/social_preview.png
"""
import io, sys, zipfile
import numpy as np
import pydicom
import json
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Circle
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ZIP, JS, OUT = sys.argv[1:4]
W, H, M = 1280, 640, 80
FD = "C:/Windows/Fonts/"
F = lambda name, sz: ImageFont.truetype(FD + name, sz)
NAVY0, NAVY1 = (8, 14, 48), (22, 34, 98)
GRAD = [(56, 189, 248), (139, 92, 246), (232, 64, 251)]           # cyan -> violet -> magenta (poster palette)


def grad_color(t):
    t = min(max(t, 0.0), 1.0) * (len(GRAD) - 1); i = min(int(t), len(GRAD) - 2); f = t - i
    return tuple(int(GRAD[i][k] + (GRAD[i + 1][k] - GRAD[i][k]) * f) for k in range(3))


def hgrad(w, h):
    a = np.zeros((h, w, 3), np.uint8)
    for x in range(w): a[:, x] = grad_color(x / max(w - 1, 1))
    return Image.fromarray(a)


# ------------------------------------------------------------------ phantom panel (matplotlib)
o = json.load(open(JS))
zf = zipfile.ZipFile(ZIP); ser = {}
for n in zf.namelist():
    if n.endswith(".dcm"):
        ds = pydicom.dcmread(io.BytesIO(zf.read(n)))
        ser.setdefault(ds.SeriesDescription, []).append((float(ds.ImagePositionPatient[2]), ds))
rep1 = sorted(ser[sorted(ser)[0]], key=lambda t: t[0])
iz = o["geom"]["iz0"]
ds = rep1[iz][1]
sl = ds.pixel_array * float(ds.RescaleSlope) + float(ds.RescaleIntercept)
px = o["px"]
bgv = np.median([sl[int(round(y)), int(round(x))] for x, y in o["rois"]["bgCentres"]])
ys, xs = np.nonzero(sl > 0.35 * bgv)
x0, x1, y0, y1 = xs.min() - 4, xs.max() + 4, ys.min() - 4, ys.max() + 4
PW, PH = 400, 328
fig = plt.figure(figsize=(PW / 100, PH / 100), dpi=200)
ax = fig.add_axes([0, 0, 1, 1]); ax.set_axis_off()
ax.imshow(sl, cmap="gray_r", vmin=0, vmax=2.6 * bgv, interpolation="bicubic")
ax.set_xlim(x0, x1); ax.set_ylim(y1, y0); ax.set_aspect("equal")
HOT, COLD, BG, LUNG = "#d62728", "#1f77b4", "#2ca02c", "#f28e2b"
for cx, cy in o["rois"]["bgCentres"]:
    for d in (37, 28, 22, 17, 13, 10):
        ax.add_patch(Circle((cx, cy), d / 2 / px, fill=False, ec=BG, lw=1.3 if d == 37 else 0.45, alpha=0.95 if d == 37 else 0.55))
for s in o["spheres"]:
    c = HOT if s["type"] == "hot" else COLD
    ax.add_patch(Circle((s["x"], s["y"]), s["d"] / 2 / px, fill=False, ec=c, lw=1.6))
    ax.text(s["x"], s["y"] - s["d"] / 2 / px - 1.6, str(s["d"]), color=c, ha="center", va="bottom", fontsize=7.5,
            fontweight="bold", family="Segoe UI")
_, lx, ly = o["rois"]["lung"][len(o["rois"]["lung"]) // 2]
ax.add_patch(Circle((lx, ly), 15 / px, fill=False, ec=LUNG, lw=1.5, ls=(0, (3, 2))))
buf = io.BytesIO(); fig.savefig(buf, format="png", dpi=200, facecolor="white"); plt.close(fig)
panel = Image.open(buf).convert("RGB").resize((PW, PH), Image.LANCZOS)

# ------------------------------------------------------------------ card
yy, xx = np.mgrid[0:H, 0:W]
r = np.clip(np.hypot((xx - 0.78 * W) / W, (yy - 0.45 * H) / H) / 0.9, 0, 1)[..., None]
bgarr = (np.array(NAVY1) * (1 - r) + np.array(NAVY0) * r).astype(np.uint8)
card = Image.fromarray(bgarr)
# faint dot network (decoration only, inside the bleed area too)
rng = np.random.default_rng(7); dots = Image.new("RGBA", (W, H), (0, 0, 0, 0)); dd = ImageDraw.Draw(dots)
pts = rng.uniform([0, 0], [W, H], (70, 2))
for i, (x, y) in enumerate(pts):
    for j in range(i + 1, len(pts)):
        if np.hypot(*(pts[j] - (x, y))) < 120:
            dd.line([tuple(pts[i]), tuple(pts[j])], fill=(120, 150, 255, 28), width=1)
    dd.ellipse([x - 2, y - 2, x + 2, y + 2], fill=(150, 180, 255, 70))
card = Image.alpha_composite(card.convert("RGBA"), dots)
d = ImageDraw.Draw(card)

# right: phantom panel in a white rounded frame with gradient rim + glow
FX, FY, PAD, CAP = 1200 - PW - 28, 104, 14, 40
fw, fh = PW + 2 * PAD, PH + 2 * PAD + CAP
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.rounded_rectangle([FX - 6, FY - 6, FX + fw + 6, FY + fh + 6], 30, fill=(139, 92, 246, 110))
card = Image.alpha_composite(card, glow.filter(ImageFilter.GaussianBlur(18)))
rim = hgrad(fw + 8, fh + 8); rmask = Image.new("L", rim.size, 0)
ImageDraw.Draw(rmask).rounded_rectangle([0, 0, fw + 7, fh + 7], 26, fill=255)
card.paste(rim, (FX - 4, FY - 4), rmask)
d = ImageDraw.Draw(card)
d.rounded_rectangle([FX, FY, FX + fw, FY + fh], 22, fill=(255, 255, 255))
card.paste(panel, (FX + PAD, FY + PAD))
cap = "Demo: digital IEC phantom \u00b7 automatic ROIs"
fc = F("seguisb.ttf", 19); tw = d.textlength(cap, font=fc)
d.text((FX + fw / 2 - tw / 2, FY + PAD + PH + 9), cap, font=fc, fill=(40, 48, 90))

# left: title (gradient text), subtitle, bullets, demo pill
LX = M
ft = F("segoeuib.ttf", 70)
title = "NEMA IQ Analyzer"
tb = d.textbbox((0, 0), title, font=ft); tw, th = tb[2] - tb[0], tb[3] - tb[1]
tm = Image.new("L", (tw + 4, th + 4), 0); ImageDraw.Draw(tm).text((-tb[0] + 2, -tb[1] + 2), title, font=ft, fill=255)
TY = 100
card.paste(hgrad(tw + 4, th + 4), (LX - 2, TY), tm)
d = ImageDraw.Draw(card)
fs = F("seguisb.ttf", 30)
d.text((LX, TY + th + 26), "Independent, vendor-neutral PET", font=fs, fill=(255, 255, 255))
d.text((LX, TY + th + 64), "image-quality QA from PACS", font=fs, fill=(255, 255, 255))
fb = F("segoeui.ttf", 23)
bullets = ["NEMA NU 2-2012 and NU 2-2018 \u00b7 IEC body phantom",
           "One offline HTML file: no install, DICOM stays on the PC",
           "GE, Siemens, Philips \u00b7 validated vs. GE software"]
by = TY + th + 128
for i, b in enumerate(bullets):
    cy = by + i * 38
    d.ellipse([LX, cy + 9, LX + 11, cy + 20], fill=grad_color(0.25 + 0.3 * i))
    d.text((LX + 24, cy), b, font=fb, fill=(212, 220, 245))
# demo pill
py = 464; fp = F("segoeuib.ttf", 22); fq = F("segoeui.ttf", 22)
lab, url = "Try the demo", "yirmish.github.io/NEMA_IQ_Analyzer"
lw = d.textlength(lab, font=fp); uw = d.textlength(url, font=fq)
pw, ph = int(lw + uw + 64), 50
pill = hgrad(pw, ph); pm = Image.new("L", (pw, ph), 0); ImageDraw.Draw(pm).rounded_rectangle([0, 0, pw - 1, ph - 1], 25, fill=255)
card.paste(pill, (LX, py), pm)
d = ImageDraw.Draw(card)
d.text((LX + 22, py + 10), lab, font=fp, fill=(255, 255, 255))
d.text((LX + 22 + lw + 20, py + 10), url, font=fq, fill=(255, 255, 255))
d.line([(LX + 22 + lw + 9, py + 13), (LX + 22 + lw + 9, py + 37)], fill=(255, 255, 255), width=2)
fo = F("segoeui.ttf", 17)
d.text((LX, 530), "Open source (MIT) \u00b7 github.com/yirmish/NEMA_IQ_Analyzer", font=fo, fill=(150, 165, 215))
card.convert("RGB").save(OUT, optimize=True)
print(OUT, card.size, "title right edge", LX + tw, "pill right edge", LX + pw, "frame", FX, FX + fw, FY + fh)
