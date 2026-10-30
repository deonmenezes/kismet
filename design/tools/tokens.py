"""The Kismet palette tokens and their WCAG contrast pairs: prints a markdown table, and is imported by board.py."""
from contrast import ratio

PALETTE = [("#ED6B83", "Coral", "Primary action fill (Yes, Send, Sign in) with ink text"),
           ("#FBE5F5", "Blush", "Light canvas: html, body, chat shell, sign-in sheet"),
           ("#A86FF7", "Lavender", "Tags and highlights (as a soft fill), bio quote rule"),
           ("#6D5FF6", "Indigo", "Selected chips, my messages, focus ring; deeper shade for links")]

LIGHT = [  # token, hex, role, (fg, bg, need) pairs
    ("--bg", "#FBE5F5", "canvas (blush)", []),
    ("--card", "#FFFFFF", "raised surfaces", []),
    ("--bg-2", "#F6D8EC", "sunken fill, hover", [("#1E1530", "#F6D8EC", 4.5)]),
    ("--ink", "#1E1530", "text", [("#1E1530", "#FBE5F5", 4.5), ("#1E1530", "#FFFFFF", 4.5)]),
    ("--muted", "#665878", "secondary text", [("#665878", "#FBE5F5", 4.5), ("#665878", "#FFFFFF", 4.5)]),
    ("--line-strong", "#8E7AA2", "field/control borders", [("#8E7AA2", "#FFFFFF", 3), ("#8E7AA2", "#FBE5F5", 3)]),
    ("--accent", "#ED6B83", "coral fill + ink text", [("#1E1530", "#ED6B83", 4.5), ("#FFFFFF", "#ED6B83", 4.5)]),
    ("--accent-ink", "#B23250", "coral as text, wordmark", [("#B23250", "#FBE5F5", 4.5), ("#B23250", "#FFFFFF", 4.5)]),
    ("--select", "#6D5FF6", "indigo fill + white text", [("#FFFFFF", "#6D5FF6", 4.5), ("#6D5FF6", "#FBE5F5", 3)]),
    ("--link", "#4F41D9", "links", [("#4F41D9", "#FBE5F5", 4.5), ("#4F41D9", "#FFFFFF", 4.5)]),
    ("--tag / --tag-ink", "#EFE3FE", "lavender tag fill / text #5B2BB0", [("#5B2BB0", "#EFE3FE", 4.5)]),
    ("--danger", "#B4233F", "destructive (Delete, Block, Unmatch?)", [("#FFFFFF", "#B4233F", 4.5), ("#B4233F", "#FBE5F5", 4.5)]),
]
DARK = [
    ("--bg", "#14101C", "canvas (indigo-ink)", []),
    ("--card", "#1F1A2B", "raised surfaces", []),
    ("--bubble", "#282236", "their messages", [("#F8EEF6", "#282236", 4.5)]),
    ("--ink", "#F8EEF6", "text", [("#F8EEF6", "#14101C", 4.5), ("#F8EEF6", "#1F1A2B", 4.5)]),
    ("--muted", "#B0A4C0", "secondary text", [("#B0A4C0", "#14101C", 4.5), ("#B0A4C0", "#282236", 4.5)]),
    ("--line-strong", "#7A6B92", "field/control borders", [("#7A6B92", "#1F1A2B", 3)]),
    ("--accent", "#ED6B83", "coral fill + ink text", [("#1E1530", "#ED6B83", 4.5)]),
    ("--accent-ink", "#F2849A", "coral as text", [("#F2849A", "#1F1A2B", 4.5), ("#F2849A", "#282236", 4.5)]),
    ("--select", "#6D5FF6", "indigo fill + white text", [("#FFFFFF", "#6D5FF6", 4.5)]),
    ("--link", "#BFA0FA", "links", [("#BFA0FA", "#1F1A2B", 4.5)]),
    ("--tag / --tag-ink", "#2E2547", "lavender tag fill / text #CDB6FB", [("#CDB6FB", "#2E2547", 4.5)]),
    ("--focus", "#A88BFA", "focus ring", [("#A88BFA", "#14101C", 3)]),
    ("--danger", "#FF8FA3", "destructive, ink text", [("#1E1530", "#FF8FA3", 4.5)]),
]


def pairs(rows):
    for tok, hx, role, ps in rows:
        yield tok, hx, role, [(fg, bg, need, ratio(fg, bg)) for fg, bg, need in ps]


def table(rows):
    out = ["| Token | Hex | Role | Contrast (fg on bg) |", "|---|---|---|---|"]
    for tok, hx, role, ps in pairs(rows):
        c = "; ".join(f"{fg} on {bg}: **{r:.2f}:1** {'AA' if r >= need else 'FAIL, so never used'}{' (UI 3:1)' if need == 3 else ''}" for fg, bg, need, r in ps) or "surface"
        out.append(f"| `{tok}` | `{hx}` | {role} | {c} |")
    return "\n".join(out)


if __name__ == "__main__":
    print("### Light\n\n" + table(LIGHT) + "\n\n### Dark\n\n" + table(DARK))
