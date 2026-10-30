# Build log

This repository was published with a fresh history. The work was done in a private repository (`agent-dates`, branch `main`): 176 commits from 2026-10-18 to 2026-10-30. Below is every commit subject from that history, oldest first, so the iteration stays visible. The short ids refer to the private repository.


## 2026-10-18 (14 commits)

- `364f4fd` Initial commit from Create Next App
- `6385636` Agent Dates: agents date each other at Edge City India
- `74e4bec` Set Vercel framework to Next.js
- `a7dc12b` Keep the last-turn instruction out of the transcript
- `52a2ab0` Wrap code samples, less hedging in dates, button polish
- `b28df33` Chat-first: agent script, /api/me/summary, chat text on signup/dates/decide
- `dbe4c65` Durable daily date caps, stronger contact filter, private summaries, safer agent script
- `34a9d4c` Turn off adaptive thinking for chat turns so they never come back empty
- `06e6f12` Agent Village mini-app: bridge-ready MCP and partner API
- `60bcee0` Secret double opt-in matching
- `e171213` Optional World ID verified badge (Orb or Selfie Check)
- `42adedd` Token-efficient dates and agent text; report, block and moderation
- `8bb0fb1` Waitlist for people outside Edge City and the app launch
- `06abcc3` Own photos (private, moderated) and direct messages between matches

## 2026-10-19 (18 commits)

- `6a4d1da` Dates and persona cards on GMI Cloud, with a model fallback chain
- `01cfb51` Record everything in the user database: history, consents, channels, activity, agent notes
- `c990bad` Rebrand to Kismet: "Your agent dates. You just say yes."
- `79ee9a2` Kismet by text: sign up and answer recommendations on WhatsApp
- `2b19295` Kismet by text: verifier fixes, and dates start on their own
- `9217bce` MCP server name: kismet
- `e009e85` Kismet by text: verifier fixes D1, D2, D4, match contact buttons
- `059a2e0` Website as a chat with your Kismet agent, with Google and email sign-in
- `0cb6873` Village features from Edge City's Agent Village, private by default
- `96f8efd` Kismet by text: one thread can never own two accounts (verifier D5)
- `903fb58` Kismet as a chat app: neon logo, popups, signals, 3 people a day, open to everyone
- `c63061d` Every agent in its own box: Daytona sandboxes for agent dates (off by default)
- `10d1908` Security pass: fixes from a full review
- `a221244` Credentials that expire, and photos only for established accounts
- `4691e37` Security re-review fixes: no kill switches, link reset revokes sign-ins
- `77ac57d` Final verification fixes: seniority for sign-ins, auth allowlist, no global refusals
- `4d9be8c` Close the leaked-link gap, and the last security verification fixes
- `01e5c7d` Minimal chat: one next step toward a date on every screen

## 2026-10-20 (17 commits)

- `e07ee96` Weekly drop: one person a week, with a full date plan
- `c22efdf` Web: "This week's Kismet" cards with the plan, and the availability question
- `9e5c17e` Docs: the weekly drop for residents' agents, the MCP server and the README
- `22d8012` Weekly drop review fixes: rolling pool, event end, push per release, lean picks
- `6483e70` README: weekly drop pool, event end, crons, run order, and the ship order
- `544b1ed` Weekly drop review round 2: plan deadline, per-side hold and plans, drop_claims
- `73a55c1` README: per-side hold and plans, drop_claims, plan time budget
- `ca926c7` Sign-in: artistic animated sheet, in-app browser help, Google error handling, dark canvas
- `993484a` Sign-in review fixes: lock while finishing, code boxes, timers, safe areas, font, contrast
- `516da64` Lockfile in sync for npm 10 and 11 (npm ci failed on npm 10)
- `2b889b3` Merge remote-tracking branch 'origin/main' into photo-card
- `a3fd9ce` Agents in match chats (opt-in), public profiles on cards, no dashes, docked menu
- `148d346` Ask once before using someone's Google profile picture as their photo
- `2e2908d` One Kismet in match chats, speaking only when it helps; a real chats sidebar
- `1f7c565` Ask once, after 90 minutes of use, to share data for feedback and training
- `85bf889` Chats sidebar on every chat (docked on desktop, drawer on phones) and no page scroll
- `0f6e291` Kismet shares its own opinions and answers every question, with context on open matches

## 2026-10-21 (1 commit)

- `d9944c5` Photos on the web chat's people: cards, the chats sidebar and the chat header

## 2026-10-27 (1 commit)

- `9564184` Less gradient: flat surfaces, one accent, serif display headings

## 2026-10-28 (80 commits)

- `990e8ac` Edge City only: residents-only pool, the sign-up question everywhere, and a migration
- `5aa8ab4` Copy: dating and friends for Edge City India residents, with a private agent each
- `64dab40` Tests for Edge City only, on a real Postgres (PGlite) with db/schema.sql
- `541d0c2` New colour grading: blush, coral, lavender, indigo tokens; flat everywhere
- `614f2d1` Review fixes: only a typed answer to the question counts; stricter parser; drops
- `22cf21f` Edge City answers: "I'm here, not all weeks" is unclear, not a no; "yes please" and emoji count
- `c510780` Palette review fixes: focus ring, disabled states, backdrop scrim, contrast
- `02e48ce` Colour grading board, token table and screenshot tools
- `96d87a1` Test harness: real server modules on PGlite (from kismet-by-text), with Neon transactions
- `6778c84` C1: demo accounts only ever date and see other demo accounts
- `c20abd4` M1: date plans are never scheduled after the event ends
- `ab25359` M2: the Village Board no longer leaks the other agent's score
- `0f18a97` Sign-in sheet: never rests off-screen on iOS, whatever its animations do
- `5f33b06` M3: stripContacts catches handles written without a colon or "is"
- `2390b6f` M4: a drop claim goes with its date (ON DELETE CASCADE)
- `08f9040` M7: block, unblock and report on a stale recommendation or match answer 410 with a text
- `7ede8b9` M6 (backend/web): a match with no Telegram gets no t.me link
- `313b4c6` S1: the date prompt keeps every user-written field inside the data tags
- `d23099d` Low: share images and apple icon in the new palette
- `d11adce` Low: a branded 404 with a way back
- `2a17af6` Low: robots.txt, sitemap.xml and favicon.ico
- `483bb33` Low: 44 px tap targets for footer and legal links and the waitlist checkbox
- `fa9c81d` Low: per-network rate limit on /mcp and /api/public/*
- `82b6ac9` Low: the 3-dates-a-day cap holds under concurrent requests
- `33b1d41` Low: match creation is one statement
- `2191abc` Low: the Friday extra drop pushes everyone waiting at the end of its run
- `6436ca3` Low: the daily digest counts the right dates
- `d6174ff` Low: /join while signed in goes to /home
- `fe17288` Low: Support FAQ covers the app's Delete account and in-app block/report
- `fc0e858` Low: match chat polls /agents only when it can change; the Kismet popup fits small screens
- `8ba7063` Low: npm audit fixes that need no major upgrade
- `c0ba0c1` Village partner API: X-Village-Subject header; ops moved to lib/village-ops.ts
- `e6606ad` MCP: kismet_* tools for Agent Village (app token + X-Village-Subject)
- `918b62f` Tests: partner API and MCP tools end to end on PGlite
- `b7ca274` Docs: X-Village-Subject and the kismet_* MCP tools (README, /llms-full.txt)
- `03c1102` Review fixes: demo sign-up gate, plan and claim edge cases, test clock, contact false positives
- `85fc50e` Verifier fixes: the demo backfill runs once; claim-keep and delete in one transaction
- `458f415` Merge kismet-fixes: demo isolation, M1-M4, M6, M7, S1, lows
- `26d5466` Merge kismet-village-mcp: X-Village-Subject, ops in village-ops.ts, kismet_* MCP tools
- `e83c3e6` Release integration: Agent Village's partner calls skip the per-network /mcp limit; demo isolation and stale ids through the partner doors
- `4ef0a16` Review fixes: partner calls proven uncounted on their network; /mcp limit documented
- `34e5623` how_it_works: residents sign up themselves at /join (no agent sign-up line until Agent Village's actions are live)
- `b283d2f` Merge kismet-by-text (Edge City only) into the release: both filters everywhere
- `8156d11` H3: app sign-ups that leave out Edge City are members; the pending text links /home; Edge parser smalls
- `5e4e38d` M8: prebuild schema check stops a build onto a database without users.edge_city / is_demo
- `9426be3` Edge smalls: counters, check-ins, setEdgeCity no-op, pollers asked, Home card
- `329fb81` Refuse App Review's demo name and handle on every door, not just /api/signup
- `e542b30` README: store-app sign-ups are members, the prebuild schema check, reserved demo names on every door
- `cd6b8c2` Review fixes: unreadable Edge answers refused; both filters in the last gaps; PATCH answers like edge-city
- `bf215de` Second review: blank Edge answers are left out; PATCH keeps the given weeks; bracketed weeks read
- `2a45051` Merge branch 'kismet-release' into kismet-edge-v2
- `cd318c5` Keep reports after account deletion, with hashed contacts, so banned users can't rejoin clean
- `d933487` Neon Auth SDK 0.7.0-beta; better-auth 1.7.7 through overrides (clears GHSA-965c, GHSA-r4xp, GHSA-44jh)
- `94ba810` Review fixes: no Telegram poisoning, bans without reports kept, backfill, purge pre-deploy rows
- `d859faf` Second review: no Telegram from suspended accounts on reports or backfill; reported_hidden only from own reports
- `c2ef801` Merge branch 'kismet-auth-070' into kismet-reports-kept
- `f397bc0` Friday un-hold push: a 4th Hobby cron after the last drop stops holding
- `9e793ac` PATCH /api/me: no Telegram needed when matches reach you on WhatsApp; left-out Telegram unchanged
- `6ba7197` N-H1: drop label from the real next drop (Fri 30 Oct, the last one); no more drops after it
- `26be832` N-M1: control characters stripped from all free text; NUL never a 500; history check before notes
- `f3a3a71` N-M2: a Telegram-only history match never hides anyone; /admin lists it instead
- `3703195` N-L1: placeholder Telegram handles are never hashed; Telegram's real format at sign-up
- `aec8caa` N-L2: a kept report with no reported_gone_at goes 12 months after it was filed, never the next morning
- `7b9e538` N-L3: reserved demo name or handle compared folded, and either one alone is refused
- `a3e0e7e` N-L4: shownPartner checks the demo line, so a leftover demo <-> real date can't be blocked or reported
- `7379347` N-M4: iPhone 390x664 sign-in sheet: the private-link drawer scrolls into view, the close button stays on screen
- `1289778` S3: serve Fraunces as one static italic 400, so WebKit draws the headings at their weight with word gaps
- `a5a44b6` Docs: one sign-up story (N-M5), the support deletion line (N-M6), privacy/support disclosures
- `04084b8` N-H1 follow-up: /agents re-renders every 5 minutes, so its script never freezes the drop label at build time
- `451c504` M3: stripContacts matches on a folded copy (catches all 96 QA2 leak forms); N-L7: stored bios scrubbed at read time
- `2776291` N-L6: Edge City answers: a no next to being here is unclear; first two weeks; digits after a yes; bare "last week"
- `e2fde50` Drop: a newer "none" claim no longer hides an earlier drop still waiting for an answer
- `019b7d4` Home: delete checks the answer (S-3), an "account deleted" notice (N-L11), one cadence (N-L10)
- `ae523c4` N-L9: after sign-up, "Your agent is ready!" opens at the top of the page
- `13fc84a` Tap targets: the listed app controls reach 44 px (QA2 low)
- `e92e3df` Match chat: polling backs off when idle; no layout shift on desktop
- `0170004` S-7: pages on agent-dates.vercel.app redirect (308) to kismet-village.vercel.app
- `90e4ba2` N-L8: install icons and the 48 px favicon in the 28 Oct palette, like the apple icon
- `4012d27` WhatsApp: public "Text Kismet" buttons and links only with KISMET_WHATSAPP_PUBLIC=1
- `2989f6e` Review fixes: contacts mid-sentence and false positives, joiners kept, JSON NUL, small copy and parser fixes

## 2026-10-29 (34 commits)

- `18c8c8d` N3-M1: plain handles mid-sentence, app-name + handle interest chips; S3-1 scrub what reaches a date
- `690c786` N3-L1: icon.svg and /favicon.ico in the 28 Oct brand (ink Fraunces Italic K on coral)
- `8e10b21` N3-L2: the "account deleted" notice only in the tab that just deleted the account
- `e742169` Deletion robustness: failed blob / Neon Auth / Daytona deletions retried; waitlist entry deleted with the account
- `d497f49` CSP: a per-request nonce policy on every page (default-src, script-src 'strict-dynamic'), no-scripts policy elsewhere
- `8a9256a` Review fixes: no plain-handle regressions, linear lookbacks, deletion retries time-boxed, one CSP header per path
- `f9f2a48` Second review: no plain-handle regressions in a 4,080-form sweep, deletion retries never starve, CSP case/`/api` gaps
- `8c10398` Photos: say Saved/Removed after each upload or delete, that they save automatically, and when the 3-photo limit is reached
- `0602117` Photos: no double delete, keep the list if a reply has none, a live status region, a clear too-big message
- `b04808b` Q4-M1: handles next to an app name found word by word, not phrase by phrase
- `be7323b` Q4-M1 review: names stay handles where the text says one follows; second blind set; dash runs linear
- `57440db` Q4-M1 second review: no Hinglish or "handle:" false positives, misspelt app names, repeated handles
- `3f66280` Q4-M1 third review: Hindi names stay handles, brackets before ":", repeats only of the handle
- `ed9d379` Q4-M1 fourth review: a handle alone in brackets before a separator, Hindi name-words in Hindi sentences
- `aa38255` Merge branch 'kismet-photo-saved' into kismet-q4-contacts
- `7d9cd36` Q5-L1: fewer innocent app bios changed by the contact scrubber
- `4b5e708` Q5-L2: admin login answers ?e=key, never 500, to a body that is no form
- `0976f74` Q5-L3: photo limits under Vercel's 4.5 MB request cap; the web client shrinks big photos
- `18f24fa` Q5-L4: an interest chip that held a contact goes whole
- `9e93c9a` Q5-L1 review: no name in the word list, "is my" and "than" keep handles
- `ad4d160` Q5-L3 review: room for MIME base64, smoother downscale, HEIC wording
- `a200db2` Q5-L1 review 2: Indian names really filtered, derived name forms stay names, nouns before "than" stay handles
- `f159c83` A model-based second contact check after stripContacts, on every door, with a cron backfill
- `7757837` Sign-in on phones and iOS is a page, not a dialog sheet
- `aac0122` Website copy: community intros by AI agents (friends, collaborators, co-founders first; romance opt-in), not dating
- `b86fbf7` Merge branch 'kismet-llm-contacts' into kismet-intros-copy
- `b40eea3` Merge branch 'kismet-intros-copy' into kismet-signin-page
- `907b7d2` Neutral /app pages for the store apps: Support, Privacy, Terms, waitlist and invite sign-up without naming Edge City
- `3eb432d` Extra drop tonight, Thu 29 Oct 21:30 IST (Deon: do the drop now); Friday's 19:00 drop stays the last
- `0825e77` Browser Back from /sign-in puts the typed words back on the landing page (QA6 Q6-M1)
- `3ca85c2` No drop or agent-chat count promised to someone outside the Edge City pool (QA6 Q6-L2)
- `7cd4a0d` /app 404s keep the title "Page not found" after hydration (QA6 Q6-L3)
- `e1b5e83` Agent docs say what Support says a match reveals (QA6 Q6-L4)
- `f8c65d0` QA7 LOWs: no "Send my agent" outside the pool, /api/me/drop promises no drop, sign-in fits 360x640

## 2026-10-30 (11 commits)

- `66c986f` Agent Village sign-up is live: say how to install the Kismet mini-app instead of 'comes later'
- `c06b034` Extra drop Fri 30 Oct 16:00 IST (Deon's announcement said 4 pm); 19:00 stays the last
- `835ca04` Shorter sign-up chat: private questions only for romance, taps skip the model, Telegram optional on the web
- `74d099a` Chat sign-up: a step counter, and the landing words wait until sign-up is done
- `71b65eb` Sign-in: email first in any in-app webview; quiz asks private questions only for romance
- `f234e00` Interests: a tapped set keeps its words as shown, and the same interest is kept once whatever its case
- `a1b1812` Easy sign-up review fixes: private answers only with Romance, Telegram at the recap, tighter skip
- `676cea7` Chat sign-up: no "your first message comes back" promise after "No, I'm not at Edge City" (QA8 L1)
- `74601dc` /waitlist/remove: its own tab title, "Leave the waitlist", as the /app twin (QA8 L2)
- `05f1711` One more drop, Saturday 31 Oct at 10:00 India time, for the people who joined after Friday's 7 pm drop
- `529d229` Photo nudge: ask people with no photo to add one, without nagging or blocking
