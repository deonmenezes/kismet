"""The colour grading board: the four palette swatches with hex and role, the derived light and dark tokens, the
contrast ratios, and before/after phone shots side by side.

usage: python board.py <design-dir>   (reads before/, after/, after-dark/; writes kismet-palette-board.png)
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from contrast import ratio
from tokens import PALETTE, LIGHT, DARK, pairs

D = Path(sys.argv[1])
W, PAD = 2400, 72
INK, MUTED, BLUSH, CARD, LINE = "#1E1530", "#665878", "#FBE5F5", "#FFFFFF", "#ECCCDF"


def font(size, kind="sans"):
    names = {"sans": ["segoeui.ttf", "arial.ttf"], "bold": ["segoeuib.ttf", "arialbd.ttf"],
             "serif": ["georgiai.ttf", "timesi.ttf"], "mono": ["consola.ttf", "cour.ttf"]}[kind]
    for n in names:
        try:
            return ImageFont.truetype(n, size)
        except OSError:
            pass
    return ImageFont.load_default()


def text_on(hx):  # the readable text colour on a swatch
    return INK if ratio(INK, hx) >= ratio("#FFFFFF", hx) else "#FFFFFF"


def shot(path, w):
    im = Image.open(path).convert("RGB")
    return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)


PHONES = [("02-sign-in", "Sign-in"), ("04b-chat-rec", "Chat + recommendation card"), ("05-sidebar", "Chats sidebar"), ("06-match-chat", "Match chat")]
PW = 340
phone_h = max(shot(D / "after" / f"{n}-phone.png", PW).height for n, _ in PHONES)

img = Image.new("RGB", (W, 5000), BLUSH)
d = ImageDraw.Draw(img)
y = PAD
d.text((PAD, y), "Kismet", font=font(44, "bold"), fill="#B23250")
d.text((PAD + 190, y - 14), "colour grading", font=font(64, "serif"), fill=INK)
d.text((PAD, y + 80), "Flat fills, 1px borders, no gradients, glows, blur or grain. Every text pair used is WCAG AA.", font=font(26), fill=MUTED)
y += 150

# 1. The four palette colours.
sw = (W - 2 * PAD - 3 * 24) // 4
for i, (hx, name, role) in enumerate(PALETTE):
    x = PAD + i * (sw + 24)
    d.rounded_rectangle((x, y, x + sw, y + 300), 24, fill=hx, outline=LINE if hx == "#FBE5F5" else None, width=2)
    t = text_on(hx)
    d.text((x + 28, y + 26), name, font=font(44, "serif"), fill=t)
    d.text((x + 28, y + 90), hx, font=font(30, "mono"), fill=t)
    line, ly = "", y + 190
    for w_ in role.split():  # wrap the role
        if d.textlength(f"{line} {w_}".strip(), font=font(23)) > sw - 56:
            d.text((x + 28, ly), line, font=font(23), fill=t)
            ly += 32
            line = w_
        else:
            line = f"{line} {w_}".strip()
    d.text((x + 28, ly), line, font=font(23), fill=t)
y += 360


# 2. Derived tokens, light and dark, each with its contrast pairs drawn for real.
def token_block(x, y, rows, title, bg, fg, sub, edge):
    bw = (W - 2 * PAD - 40) // 2
    rh = 62
    h = 90 + rh * len(rows) + 20
    d.rounded_rectangle((x, y, x + bw, y + h), 24, fill=bg, outline=edge, width=2)
    d.text((x + 32, y + 24), title, font=font(36, "serif"), fill=fg)
    for i, (tok, hx, role, ps) in enumerate(pairs(rows)):
        ry = y + 90 + i * rh
        d.rounded_rectangle((x + 32, ry, x + 80, ry + 44), 10, fill=hx, outline=sub, width=1)
        d.text((x + 96, ry), tok, font=font(21, "mono"), fill=fg)
        d.text((x + 96, ry + 24), f"{hx}  {role}", font=font(17), fill=sub)
        cx = x + bw - 30
        for fg_, bg_, need, r in reversed(ps):  # contrast chips, right-aligned: "Aa" in the real pair
            ok = r >= need
            label = f"{r:.2f}:1" + ("" if ok else " fails, not used")
            cw = 72 + int(d.textlength(label, font=font(19, "bold")))
            cx -= cw
            d.rounded_rectangle((cx, ry + 4, cx + cw - 10, ry + 40), 10, fill=bg_, outline=sub, width=1)
            d.text((cx + 12, ry + 8), "Aa", font=font(21, "bold"), fill=fg_)
            d.text((cx + 52, ry + 10), label, font=font(19, "bold"), fill=text_on(bg_))
    return h


bw = (W - 2 * PAD - 40) // 2
h1 = token_block(PAD, y, LIGHT, "Light tokens (blush canvas)", CARD, INK, MUTED, LINE)
h2 = token_block(PAD + bw + 40, y, DARK, "Dark tokens (indigo-ink canvas, device in dark mode)", "#14101C", "#F8EEF6", "#B0A4C0", "#342D45")
y += max(h1, h2) + 30
d.text((PAD, y), "Each chip draws 'Aa' in the real text colour on the real background. White on coral (2.99:1) fails, so coral buttons use ink text (5.83:1). "
       "Borders and the focus ring meet the 3:1 UI minimum.", font=font(22), fill=MUTED)
y += 80

# 3. Before / after phone shots.
d.text((PAD, y), "Before (main @9564184)  ->  after, light and dark (phone, 390 x 844)", font=font(40, "serif"), fill=INK)
y += 80
colw = PW * 3 + 2 * 16
gap = W - 2 * PAD - 2 * colw
for i, (name, label) in enumerate(PHONES):
    cx = PAD + (i % 2) * (colw + gap)
    cy = y + (i // 2) * (phone_h + 110)
    d.text((cx, cy), label, font=font(28, "bold"), fill=INK)
    for j, (sub, tag) in enumerate([("before", "BEFORE"), ("after", "AFTER  light"), ("after-dark", "AFTER  dark")]):
        p = D / sub / f"{name}-phone.png"
        if not p.exists():
            continue
        im = shot(p, PW)
        px = cx + j * (PW + 16)
        d.text((px, cy + 44), tag, font=font(18, "bold"), fill=MUTED)
        img.paste(im, (px, cy + 74))
        d.rectangle((px, cy + 74, px + PW - 1, cy + 74 + im.height - 1), outline=LINE, width=1)
y += 2 * (phone_h + 110)

img = img.crop((0, 0, W, y + PAD))
out = D / "kismet-palette-board.png"
img.save(out, optimize=True)
print(out, img.size)
