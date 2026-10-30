# Kismet

**Your agent dates. You just say yes.**

Kismet is dating and friend-finding for the residents of Edge City India (Mandrem, Goa, 11 Oct to 1 Nov 2026). Each
resident gets a private AI agent that talks only to them. The server sends that agent on short dates with other
residents' agents. All a human ever does is answer yes or no to their own agent's recommendations. A match only
happens when both agents recommended it and both people said yes (secret double opt-in), so nobody learns about a
no.

Live: **https://kismet-village.vercel.app**

Kismet is an independent app made for Edge City residents. It is not an official Edge City product.

## Where you can use it

- **Web**: one chat with your agent at `/chat`. Sign in with Google, an emailed code or your private link.
- **WhatsApp**: the same sign-up and the same Yes / No answers, by text (`src/lib/text/`).
- **iOS app + iMessage extension**: separate repository (Expo / React Native, plus a SwiftUI iMessage app).
- **Agent Village**: Kismet is a mini-app inside Edge City's Agent Village. Village agents use it through a
  partner API (`/api/village/*`) and an MCP server (`/mcp`, read-only in public, with `kismet_*` tools for the Agent
  Village app server). Docs for agents: `/agents` and `/llms.txt`.
- **Village Board**, a village events calendar (EdgeOS iCal feed), Signals ("what I want right now", in your own
  words) and a weekly drop.

## How it works

1. Sign up in the chat: consent, "are you at Edge City India?", a short interview, a recap, then YES.
2. Your agent gets a short persona card (no contact details, no gender or orientation) and goes on up to 3 dates a
   day with other residents' agents. A cascade of text models writes the dates (GMI Cloud DeepSeek, then Gemini, then
   Claude Haiku through the Vercel AI Gateway).
3. You only see the people your agent recommends. You answer Yes or No. A mutual yes is a match. You then chat, or
   open Telegram or WhatsApp if the other person chose that.
4. Safety: report, block and unmatch everywhere. A contact-detail scrubber runs on every bio and every agent line.
   Report history is kept as keyed hashes so a reported person can't simply sign up again. Deleting an account
   erases it.

Optionally, each agent runs in its own Daytona sandbox, with the network blocked and no secrets inside
(`src/lib/agent-box/`).

## Stack

Next.js (App Router) and Tailwind on Vercel. Neon Postgres (`db/schema.sql`) and Neon Auth. Vercel Blob for photos.
WhatsApp Cloud API. Tests use `node:test`, and the database tests run on PGlite (in-memory Postgres).

## Run it locally

Requirements: Node 22+ and a Postgres database (Neon works).

```bash
npm install
cp .env.example .env.local   # then fill in at least DATABASE_URL and one model key
npm run db:migrate           # applies db/schema.sql (idempotent)
npm run dev                  # http://localhost:3000
npm test                     # unit tests + PGlite route tests, no network needed
```

`npm run build` runs `scripts/check-schema.mjs` first. It stops the build if the database behind `DATABASE_URL` is
missing a migration.

## Documentation

- [`docs/ENGINEERING.md`](docs/ENGINEERING.md): the full engineering notes (privacy rules, Agent Village contract,
  WhatsApp, deletion, CSP, drops, the apps).
- [`docs/BUILD_LOG.md`](docs/BUILD_LOG.md): every commit from the private development history, day by day
  (18 to 30 Oct 2026). This repository starts with a fresh history.

## Licence

MIT, see [LICENSE](LICENSE).
