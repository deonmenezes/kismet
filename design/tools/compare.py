"""Contact sheets: each screen BEFORE | AFTER light | AFTER dark, one sheet per size.

usage: python compare.py <design-dir>   (writes compare/compare-phone.png and compare/compare-desktop.png)
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw
from board import font  # same fonts as the board

D = Path(sys.argv[1])
OUT = D / "compare"
OUT.mkdir(exist_ok=True)
COLS = [("before", "BEFORE (main @9564184)"), ("after", "AFTER light"), ("after-dark", "AFTER dark")]
CELL = {"phone": 390, "desktop": 720}
MAXH = {"phone": 1300, "desktop": 450}
GAP, PAD, LABEL = 24, 40, 70
BG, INK, MUTED = (251, 229, 245), (30, 21, 48), (102, 88, 120)


def cell(p, w, maxh):
    im = Image.open(p).convert("RGB")
    im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    return im.crop((0, 0, w, min(im.height, maxh)))


for size in ("phone", "desktop"):
    w = CELL[size]
    rows = []
    for b in sorted((D / "before").glob(f"*-{size}.png")):
        cells = [cell(D / c / b.name, w, MAXH[size]) if (D / c / b.name).exists() else None for c, _ in COLS]
        rows.append((b.stem.rsplit("-", 1)[0], cells))
    width = PAD * 2 + w * 3 + GAP * 2
    height = PAD + 80 + sum(LABEL + max(c.height for c in cs if c) + PAD for _, cs in rows)
    sheet = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(sheet)
    d.text((PAD, PAD), f"Kismet colour grading: before | after light | after dark  ({size})", font=font(30, "serif"), fill=INK)
    y = PAD + 80
    for name, cs in rows:
        d.text((PAD, y + 6), name, font=font(22, "bold"), fill=INK)
        for j, (c, (_, tag)) in enumerate(zip(cs, COLS)):
            x = PAD + j * (w + GAP)
            d.text((x, y + 38), tag, font=font(16, "bold"), fill=MUTED)
            if c:
                sheet.paste(c, (x, y + LABEL))
        y += LABEL + max(c.height for c in cs if c) + PAD
    sheet.save(OUT / f"compare-{size}.png", optimize=True)
    print(OUT / f"compare-{size}.png", sheet.size, len(rows), "rows")
