# Kismet colour grading (2026-10-28)

Deon's palette (`palette-reference.png`) as Kismet's design tokens. The variables live in `src/app/globals.css` (`:root` and the dark-mode block) and are exposed to Tailwind through `@theme inline` (`bg-bg`, `bg-card`, `text-ink`, `text-muted`, `bg-accent text-on-accent`, `text-accent-ink`, `bg-select text-on-select`, `text-link`, `bg-tag text-tag-ink`, `bg-danger text-on-danger`, `border-line`, `border-line-strong`).

## The four colours

| Colour | Hex | Role |
|---|---|---|
| Coral | `#ED6B83` | Primary action fill (Yes, Send, Sign in) with ink text |
| Blush | `#FBE5F5` | Light canvas: html, body, chat shell, sign-in sheet |
| Lavender | `#A86FF7` | Tags and highlights (as a soft fill), bio quote rule |
| Indigo | `#6D5FF6` | Selected chips, my messages, focus ring; deeper shade for links |

## Rules

- Flat fills only. No gradients, glows, blur, glass or grain. Two shadows: `--shadow-1` (1px lift on cards and the composer) and `--shadow-2` (dialogs, the drawer).
- Coral is a fill with **ink** text. White on coral is 2.99:1 and is never used. For coral as text use `--accent-ink` (#B23250 light, #F2849A dark).
- Indigo means selected / mine / focus. Links use the deeper `--link` (#4F41D9 light, #BFA0FA dark).
- Lavender is a soft fill (`--tag`) with deep violet text (`--tag-ink`), for tags, plan boxes, the agent's messages in a match chat.
- Destructive actions (Delete, Block, Report, Unmatch?) use `--danger`, never coral, so they never look like Yes.
- html, body and the chat shell are always the canvas colour, edge to edge; theme-color follows the scheme (`CANVAS` in `src/lib/theme.ts`).
- Sizes: buttons 48px (44px compact with `min-h-11`), chips 44px, icon buttons 44px. Radius: pills for actions, 16px fields, 24px cards.
- Focus: one 2px indigo outline, offset 2px (`@layer base`), fields and the composer draw their own 1px+1px ring instead.

## Tokens and contrast (WCAG 2.x, computed by `tools/tokens.py`)

AA = 4.5:1 for text, 3:1 for UI boundaries and focus indicators.

### Light (blush canvas)

| Token | Hex | Role | Contrast (fg on bg) |
|---|---|---|---|
| `--bg` | `#FBE5F5` | canvas (blush) | surface |
| `--card` | `#FFFFFF` | raised surfaces | surface |
| `--bg-2` | `#F6D8EC` | sunken fill, hover | #1E1530 on #F6D8EC: **13.24:1** AA |
| `--ink` | `#1E1530` | text | #1E1530 on #FBE5F5: **14.63:1** AA; #1E1530 on #FFFFFF: **17.43:1** AA |
| `--muted` | `#665878` | secondary text | #665878 on #FBE5F5: **5.45:1** AA; #665878 on #FFFFFF: **6.50:1** AA |
| `--line-strong` | `#8E7AA2` | field/control borders | #8E7AA2 on #FFFFFF: **3.85:1** AA (UI 3:1); #8E7AA2 on #FBE5F5: **3.23:1** AA (UI 3:1) |
| `--accent` | `#ED6B83` | coral fill + ink text | #1E1530 on #ED6B83: **5.83:1** AA; #FFFFFF on #ED6B83: **2.99:1** FAIL, so never used |
| `--accent-ink` | `#B23250` | coral as text, wordmark | #B23250 on #FBE5F5: **5.09:1** AA; #B23250 on #FFFFFF: **6.06:1** AA |
| `--select` | `#6D5FF6` | indigo fill + white text | #FFFFFF on #6D5FF6: **4.55:1** AA; #6D5FF6 on #FBE5F5: **3.82:1** AA (UI 3:1) |
| `--link` | `#4F41D9` | links | #4F41D9 on #FBE5F5: **5.70:1** AA; #4F41D9 on #FFFFFF: **6.79:1** AA |
| `--tag / --tag-ink` | `#EFE3FE` | lavender tag fill / text #5B2BB0 | #5B2BB0 on #EFE3FE: **7.07:1** AA |
| `--danger` | `#B4233F` | destructive (Delete, Block, Unmatch?) | #FFFFFF on #B4233F: **6.46:1** AA; #B4233F on #FBE5F5: **5.42:1** AA |

### Dark (indigo-ink canvas, device in dark mode)

| Token | Hex | Role | Contrast (fg on bg) |
|---|---|---|---|
| `--bg` | `#14101C` | canvas (indigo-ink) | surface |
| `--card` | `#1F1A2B` | raised surfaces | surface |
| `--bubble` | `#282236` | their messages | #F8EEF6 on #282236: **13.52:1** AA |
| `--ink` | `#F8EEF6` | text | #F8EEF6 on #14101C: **16.55:1** AA; #F8EEF6 on #1F1A2B: **14.95:1** AA |
| `--muted` | `#B0A4C0` | secondary text | #B0A4C0 on #14101C: **7.96:1** AA; #B0A4C0 on #282236: **6.50:1** AA |
| `--line-strong` | `#7A6B92` | field/control borders | #7A6B92 on #1F1A2B: **3.50:1** AA (UI 3:1) |
| `--accent` | `#ED6B83` | coral fill + ink text | #1E1530 on #ED6B83: **5.83:1** AA |
| `--accent-ink` | `#F2849A` | coral as text | #F2849A on #1F1A2B: **6.88:1** AA; #F2849A on #282236: **6.22:1** AA |
| `--select` | `#6D5FF6` | indigo fill + white text | #FFFFFF on #6D5FF6: **4.55:1** AA |
| `--link` | `#BFA0FA` | links | #BFA0FA on #1F1A2B: **7.76:1** AA |
| `--tag / --tag-ink` | `#2E2547` | lavender tag fill / text #CDB6FB | #CDB6FB on #2E2547: **7.94:1** AA |
| `--focus` | `#A88BFA` | focus ring | #A88BFA on #14101C: **6.91:1** AA (UI 3:1) |
| `--danger` | `#FF8FA3` | destructive, ink text | #1E1530 on #FF8FA3: **8.06:1** AA |

## Files

- `kismet-palette-board.png`: swatches, tokens, contrast chips, before/after phone shots.
- `compare/compare-phone.png`, `compare/compare-desktop.png`: every screen before | after light | after dark (git-ignored, regenerate with the tools).
- `tools/shoot.py <url> <dir> [light|dark]`, `tools/board.py <design-dir>`, `tools/compare.py <design-dir>`, `tools/tokens.py`.
