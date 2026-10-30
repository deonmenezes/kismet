"""Screenshot Kismet screens at phone (390x844 @2x) and desktop (1440x900).

usage: python shoot.py <base-url> <out-dir> [light|dark]
Signed-out screens first; then the App Review demo account "Sam (demo)" (its private-link token in the env var
KISMET_DEMO_TOKEN, from E:/agent-dates-mobile/STORE.md; a review account, no real person's data) for chat, the recommendation card,
the chats sidebar, a match chat and the profile. Nothing is clicked that changes data (no Yes/No, no send).
"""
import os, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip("/")
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
SCHEME = sys.argv[3] if len(sys.argv) > 3 else "light"  # "dark": the device in dark mode
DEMO = os.environ["KISMET_DEMO_TOKEN"]  # the demo's /u/<token> (STORE.md); never committed
SIZES = {"phone": dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True),
         "desktop": dict(viewport={"width": 1440, "height": 900}, device_scale_factor=1)}


def settle(page, wait=2.5):
    try:
        page.wait_for_load_state("networkidle", timeout=8000)
    except Exception:
        pass  # pages that poll never go idle
    time.sleep(wait)


def shot(page, name, size, full=False):
    page.screenshot(path=str(OUT / f"{name}-{size}.png"), full_page=full)
    print("saved", name, size, flush=True)


def safe(fn, label):
    try:
        fn()
    except Exception as e:
        print(label, "skipped:", str(e).splitlines()[0], flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch()
    for size, opts in SIZES.items():
        ctx = browser.new_context(color_scheme=SCHEME, **opts)
        page = ctx.new_page()
        page.goto(f"{BASE}/"); settle(page); shot(page, "01-landing", size)
        page.goto(f"{BASE}/sign-in"); settle(page, 3); shot(page, "02-sign-in", size)
        page.goto(f"{BASE}/waitlist"); settle(page); shot(page, "08-waitlist", size, full=True)
        page.goto(f"{BASE}/privacy"); settle(page); shot(page, "09-privacy", size)
        page.goto(f"{BASE}/join"); settle(page); shot(page, "10-quiz", size, full=True)
        ctx.close()

        ctx = browser.new_context(color_scheme=SCHEME, **opts)
        page = ctx.new_page()
        page.goto(f"{BASE}/u/{DEMO}?next=chat"); settle(page, 4); shot(page, "03-chat", size)

        def rec():
            card = page.get_by_role("button", name="Yes, meet").first.locator("xpath=ancestor::div[contains(@class,'k-card')][1]")
            card.scroll_into_view_if_needed(timeout=4000); time.sleep(0.6)
            card.screenshot(path=str(OUT / f"04-rec-card-{size}.png")); print("saved 04-rec-card", size, flush=True)
            shot(page, "04b-chat-rec", size)
        safe(rec, "rec card")

        found = []
        def menu():
            if size == "phone":
                page.get_by_role("button", name="Open menu").click(timeout=3000); time.sleep(1)
                shot(page, "05-sidebar", size)
            link = page.locator('#kismet-menu a[href^="/chat/"]')
            if link.count():
                found.append(link.first.get_attribute("href"))
        safe(menu, "menu")
        href = found[0] if found else None
        if href:
            page.goto(f"{BASE}{href}"); settle(page, 3); shot(page, "06-match-chat", size)
        page.goto(f"{BASE}/home"); settle(page); shot(page, "07-profile", size, full=True)
        page.goto(f"{BASE}/edit"); settle(page); shot(page, "07b-edit", size, full=True)
        ctx.close()
    browser.close()
