-- Agent Dates schema. Run with: npm run db:migrate
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  name text not null,
  telegram text not null,
  rel_status text not null default 'undisclosed',
  openness text,
  gender text,
  interested_in text,
  looking_for text[] not null,
  interests text[] not null default '{}',
  bio text not null default '',
  agent_profile text not null default '',
  agent_name text not null default '',
  agent_personality text not null default '',
  public_quotes boolean not null default false,
  tags text[] not null default '{}',
  embedding jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists dates (
  id uuid primary key default gen_random_uuid(),
  pair_key text not null unique,
  a_id uuid not null references users(id) on delete cascade,
  b_id uuid not null references users(id) on delete cascade,
  mode text not null check (mode in ('romance', 'friendly')),
  status text not null default 'running',
  transcript jsonb not null default '[]',
  verdict_a jsonb,
  verdict_b jsonb,
  decision_a text,
  decision_b text,
  matched_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists dates_a_idx on dates (a_id, created_at desc);
create index if not exists dates_b_idx on dates (b_id, created_at desc);

create table if not exists rate_limits (
  key text primary key,
  count int not null,
  expires_at timestamptz not null
);

-- One row per started date, no user id: daily global and per-IP caps that survive account deletion.
create table if not exists date_log (
  id bigserial primary key,
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists date_log_created_idx on date_log (created_at);

-- Agent Village partner API: the app server's opaque resident id, stored only as a SHA-256 hash.
-- One Agent Dates user per resident (unique); null for web sign-ups.
alter table users add column if not exists village_resident text unique;

-- World ID: an optional "verified" badge. One World ID (nullifier per action) = one verified account.
-- Deleting the account deletes its row (ON DELETE CASCADE), which frees that World ID again.
alter table users add column if not exists world_verified_at timestamptz;
alter table users add column if not exists world_level text check (world_level in ('orb', 'selfie'));

create table if not exists world_ids (
  nullifier numeric(78, 0) not null,
  action text not null,
  user_id uuid not null unique references users(id) on delete cascade,
  credential text not null check (credential in ('orb', 'selfie')),
  verified_at timestamptz not null default now(),
  unique (nullifier, action)
);

-- One-time /verify links that were used (hash only, no user id). Links expire within 15 minutes.
create table if not exists world_codes_used (
  code_hash text primary key,
  used_at timestamptz not null default now()
);

-- Token efficiency: a short persona card (written once per profile change) is all a date sees, and
-- profile_hash skips the card call and the embedding when the profile text did not change.
alter table users add column if not exists persona_card text not null default '';
alter table users add column if not exists profile_hash text;
-- When a date finished: GET /api/me/summary?since= returns only what is new.
alter table dates add column if not exists finished_at timestamptz;

-- Safety (App Store 1.2 / Play UGC): consent, reports, blocks and moderation.
alter table users add column if not exists terms_accepted_at timestamptz;
-- banned_at: an admin banned them. hidden_at: 3+ distinct reporters, hidden pending review.
-- Either way they are hidden from everyone and cannot go on dates.
alter table users add column if not exists banned_at timestamptz;
alter table users add column if not exists hidden_at timestamptz;

-- One row per blocker -> blocked. A block hides the pair from each other both ways, for good;
-- a report's block (via_report) cannot be undone. The blocked person is never told.
create table if not exists blocks (
  blocker_id uuid not null references users(id) on delete cascade,
  blocked_id uuid not null references users(id) on delete cascade,
  date_id uuid,
  via_report boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);
create index if not exists blocks_blocked_idx on blocks (blocked_id);

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references users(id) on delete set null,
  reported_id uuid references users(id) on delete set null,
  date_id uuid,
  reason text not null check (reason in ('harassment', 'spam', 'fake', 'inappropriate', 'other')),
  note text not null default '',
  status text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  created_at timestamptz not null default now()
);
create index if not exists reports_reported_idx on reports (reported_id);

-- Waitlist (people outside Edge City India, and the iOS/Android launch). Removal is by a one-time link
-- (only its hash is stored). Position = sign-up order minus 3 places per referral, never above #1.
create table if not exists waitlist (
  id bigserial primary key,
  email text not null,
  name text not null default '',
  place text not null default '',
  handle text not null default '',
  interests text[] not null default '{}',
  platforms text[] not null default '{}',
  ref_code text not null unique,
  referred_by text,
  removal_hash text not null unique,
  ip_hash text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists waitlist_email_idx on waitlist (lower(email));
create index if not exists waitlist_referred_idx on waitlist (referred_by);

-- Photos: the person's own (uploaded, or their own X avatar when they linked their handle and opted in).
-- Stored in a PRIVATE Vercel Blob store; served only through /api/photos/<id> to people entitled to see them.
alter table users add column if not exists x_handle text not null default '';
alter table users add column if not exists use_x_photo boolean not null default false;
create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  pathname text not null,
  source text not null check (source in ('upload', 'x')),
  width int not null,
  height int not null,
  created_at timestamptz not null default now()
);
create index if not exists photos_user_idx on photos (user_id, created_at);
alter table reports add column if not exists photo_id uuid;

-- Direct messages, only between matched people. A conversation is its match (the date row).
-- Unmatch, block or report closes it for both; its messages are deleted 30 days after closing.
alter table dates add column if not exists chat_closed_at timestamptz;
alter table dates add column if not exists read_a bigint not null default 0;
alter table dates add column if not exists read_b bigint not null default 0;
create table if not exists messages (
  id bigserial primary key,
  date_id uuid not null references dates(id) on delete cascade,
  sender_id uuid not null references users(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);
create index if not exists messages_date_idx on messages (date_id, id);
-- Both agents in a match chat (lib/match-agents.ts), OPT-IN per match: they read and write only while BOTH people
-- said yes (agents_a / agents_b: null = not asked, true = in, false = no). A line from a person's own agent is
-- stored under their id with kind 'agent'. agents_turn_at: one turn at a time; agents_opened_at: openers once.
alter table messages add column if not exists kind text not null default 'human' check (kind in ('human', 'agent'));
alter table dates add column if not exists agents_a boolean;
alter table dates add column if not exists agents_b boolean;
alter table dates add column if not exists agents_turn_at timestamptz;
alter table dates add column if not exists agents_opened_at timestamptz;
-- For an X avatar: the handle it came from (re-fetched only when the handle changes).
alter table photos add column if not exists origin text not null default '';
-- The profile picture of the person's own Google sign-in, only when they tapped "Use it" (lib/photos.ts addGooglePhoto).
alter table photos drop constraint if exists photos_source_check;
alter table photos add constraint photos_source_check check (source in ('upload', 'x', 'google'));

-- Which model wrote a date (gmi/deepseek-ai/..., gmi/google/..., or the gateway's anthropic/...).
alter table dates add column if not exists model text not null default '';

-- Kismet records (Deon: "record all information and keep it in our user database").
-- Sign-up source: web | ios | imessage | android | village | api (a resident's own agent calling the API).
-- signup_client: the client and version that signed up, e.g. "ios/1.0.0" (X-Kismet-Client header).
-- Accounts from before this column: village if they came through Agent Village, otherwise unknown.
alter table users add column if not exists signup_channel text not null default 'unknown';
alter table users add column if not exists signup_client text not null default '';
update users set signup_channel = 'village' where village_resident is not null and signup_channel = 'unknown';

-- When the person's own agent recommendation was first shown to them (activity_log "recommendation_shown").
alter table dates add column if not exists shown_a_at timestamptz;
alter table dates add column if not exists shown_b_at timestamptz;

-- Consent records: 18+ and the Terms (with the terms version), per sign-up. Deleted with the account.
create table if not exists consents (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('age_18_plus', 'terms')),
  version text not null,
  channel text not null,
  created_at timestamptz not null default now()
);
create index if not exists consents_user_idx on consents (user_id, created_at);
-- Accounts from before this table: their recorded sign-up consent (terms_accepted_at); the Terms then were the 2026-10-18 ones.
insert into consents (user_id, kind, version, channel, created_at)
  select u.id, k.kind, '2026-10-18', u.signup_channel, u.terms_accepted_at
  from users u cross join (values ('age_18_plus'), ('terms')) as k(kind)
  where u.terms_accepted_at is not null and not exists (select 1 from consents c where c.user_id = u.id);

-- Profile edit history: one row per changed field per edit, with the previous and the new value.
create table if not exists profile_history (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  field text not null,
  old_value jsonb,
  new_value jsonb,
  channel text not null,
  created_at timestamptz not null default now()
);
create index if not exists profile_history_user_idx on profile_history (user_id, id);

-- Last seen per channel (and the client version last used on it).
create table if not exists user_channels (
  user_id uuid not null references users(id) on delete cascade,
  channel text not null,
  client text not null default '',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, channel)
);

-- Append-only log of every user action. Small metadata only: ids (dateId, messageId, photoId), never
-- message bodies or profile text. Deleted with the account (one anonymous "delete" row with no user stays).
create table if not exists activity_log (
  id bigserial primary key,
  user_id uuid references users(id) on delete cascade,
  channel text not null,
  client text not null default '',
  action text not null,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists activity_user_idx on activity_log (user_id, id);
create index if not exists activity_created_idx on activity_log (created_at);

-- What the person's agent knows about them: short facts posted by their agent (Agent Village, the hosted
-- agent, the apps) or by themselves. Private to the owner (GET/DELETE /api/me/notes); dates see them only
-- through the persona card. Deleted with the account.
create table if not exists agent_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  text text not null,
  source text not null,
  created_at timestamptz not null default now()
);
create index if not exists agent_notes_user_idx on agent_notes (user_id, created_at);

-- The waitlist's channel and client too (activity_log has no user for waitlist rows).
alter table waitlist add column if not exists channel text not null default 'web';
alter table waitlist add column if not exists client text not null default '';

-- Kismet by text (WhatsApp; more providers behind lib/text adapters). One thread per (channel, phone):
-- the phone (E.164) is the key for people who sign up by text; user_id is set once they sign up or link
-- an app/web account. Deleting the account deletes its threads and their transcripts.
alter table users add column if not exists contact_method text not null default 'telegram';
alter table users add column if not exists contact_phone text;
create table if not exists user_phones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  channel text not null,
  phone text not null,
  state text not null default 'new',
  draft jsonb not null default '{}',
  verified_at timestamptz,
  opted_out_at timestamptz,
  paused_at timestamptz,
  blocked_at timestamptz,
  last_inbound_at timestamptz,
  pending_date_id uuid,
  told_final boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, phone)
);
create index if not exists user_phones_user_idx on user_phones (user_id);
create table if not exists conversation_messages (
  id bigserial primary key,
  phone_id uuid not null references user_phones(id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  text text not null,
  provider_id text,
  created_at timestamptz not null default now()
);
create unique index if not exists conversation_inbound_idx on conversation_messages (provider_id) where direction = 'in';
create index if not exists conversation_phone_idx on conversation_messages (phone_id, id);
-- 6-digit link codes (hash only, 15 minutes, single use): from the app/web (user_id) or from a thread (phone_id).
create table if not exists link_codes (
  code_hash text primary key,
  user_id uuid references users(id) on delete cascade,
  phone_id uuid references user_phones(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
-- Queued notices hold date ids only (re-checked when delivered, never the partner's details); a short lease
-- serializes one number's messages; link requests wait for the other side's approval (app or phone).
alter table user_phones add column if not exists notices jsonb not null default '[]';
alter table user_phones add column if not exists lock_id text;
alter table user_phones add column if not exists lock_until timestamptz;
alter table user_phones drop column if exists pending_notice;
create table if not exists link_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  phone_id uuid not null references user_phones(id) on delete cascade,
  needs text not null check (needs in ('web', 'phone')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes'
);
create index if not exists link_requests_user_idx on link_requests (user_id);
create index if not exists link_requests_phone_idx on link_requests (phone_id);
-- date_log cap keys are hashed now (no thread, user or resident id); older raw keys are dropped.
delete from date_log where ip_hash !~ '^[0-9a-f]{32}$';
-- When a date began generating (lib/engine.ts runDate): stuck-date cleanup goes by this, not by created_at.
alter table dates add column if not exists started_at timestamptz;
-- Text rate-limit keys hold a salted hash of the number now; older keys with the raw number (or prefix) are dropped.
delete from rate_limits where key ~ '^text-[a-z-]+:whatsapp:[0-9]+$';
-- Website sign-in (Neon Auth: Google or an emailed code). One row per signed-in identity that has a Kismet
-- account; an identity without one yet is only a web chat thread ("web:a:<auth user id>") doing the interview.
-- Deleted with the account.
create table if not exists auth_identities (
  auth_user_id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  email text not null default '',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists auth_identities_user_idx on auth_identities (user_id);
-- The account id a text sign-up is fixed to before anything is created (lib/text/agent.ts signup): a retry after
-- a try that died (or a slow try overtaken by the stale retry) finishes that same account, never a second one.
alter table user_phones add column if not exists pending_user_id uuid;
-- Signals (as on Index Network / Agent Village): what someone wants right now, in their own words. Private:
-- they shape only that person's agent card and matching. Deleted with the account.
create table if not exists signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  text text not null check (char_length(text) between 3 and 280),
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists signals_user_idx on signals (user_id, status);
-- Browser sessions: the cookie holds its own random token (hash only here), never the private-link secret. They
-- expire after 30 days and end on sign-out; deleted with the account.
create table if not exists web_sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists web_sessions_user_idx on web_sessions (user_id);
-- When the private link / API token was last used: one unused for 90 days stops working (apps keep it alive).
alter table users add column if not exists token_used_at timestamptz;
update users set token_used_at = now() where token_used_at is null and created_at < now() - interval '1 day';
-- Sign-ins removed from an account (by its owner, or on a link reset) can never be joined to it again.
create table if not exists revoked_identities (
  auth_user_id text not null,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (auth_user_id, user_id)
);
-- Weekly drop (lib/drop.ts, after Ditto): one person per resident per drop (Wednesdays 19:00 Asia/Kolkata, plus extra
-- drop times before the event ends), with a date plan.
-- When someone is usually free for a date and where they stay: only used for the plan's time and venues. Not private.
alter table users add column if not exists availability text not null default 'flexible'
  check (availability in ('weekday_evenings', 'weekends', 'flexible'));
alter table users add column if not exists area text not null default '';
-- held: finished while weekly mode was on, so hidden from both until released to that side (drop_a_at / drop_b_at).
-- plan_a / plan_b: each side's proposed plan (when, where, what, why), written for that side's drop; plan: the confirmed
-- one and plan_confirmed_at, once both said yes. Older dates: not held, no plan. A held date shows to a side once it is
-- released (drop_x_at) or was already shown to that side (shown_x_at, while nothing was held).
alter table dates add column if not exists held boolean not null default false;
alter table dates add column if not exists drop_a_at timestamptz;
alter table dates add column if not exists drop_b_at timestamptz;
alter table dates add column if not exists plan_a jsonb;
alter table dates add column if not exists plan_b jsonb;
alter table dates add column if not exists plan jsonb;
alter table dates add column if not exists plan_confirmed_at timestamptz;
-- One row per person per drop time (drop_at: the weekly drop, or an extra one): the claim that makes a release
-- idempotent (a retry or a double cron fire sends nothing twice). date_id null: no eligible match that time.
-- Deleted with the account, and with its date (below).
-- (Named drop_claims: an earlier draft table "drops" keyed by ISO week, if one exists anywhere, is left alone.)
create table if not exists drop_claims (
  user_id uuid not null references users(id) on delete cascade,
  drop_at timestamptz not null,
  date_id uuid references dates(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, drop_at)
);
create index if not exists drop_claims_drop_at_idx on drop_claims (drop_at);
-- The drop's pool: dates finished in the last 28 days.
create index if not exists dates_finished_idx on dates (finished_at);

-- Time with Kismet open, per channel, in minutes (only the person's own channels count toward the sharing question) (lib/records.ts touchSeen: gaps under 5 minutes count, a longer gap
-- counts as 1). The website chat polls only while its tab is visible, so a tab left in the background doesn't count.
alter table user_channels add column if not exists active_minutes int not null default 0;
-- Sharing for feedback and training (lib/training.ts): null = not asked yet (asked once, after 90 minutes of use),
-- true / false = their current answer, changeable any time in Profile. Every answer is also an activity_log row.
alter table users add column if not exists training_opt_in boolean;
alter table users add column if not exists training_answered_at timestamptz;
alter table consents drop constraint if exists consents_kind_check;
alter table consents add constraint consents_kind_check check (kind in ('age_18_plus', 'terms', 'training_data', 'training_data_withdrawn'));
-- Feedback typed into the sharing question (optional). Deleted with the account.
create table if not exists feedback (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  text text not null,
  channel text not null,
  created_at timestamptz not null default now()
);
create index if not exists feedback_created_idx on feedback (created_at);

-- Demo accounts (lib/demo.ts: App Review's "Sam (demo)" and its partners from agent-dates-mobile tools/demo_review.py):
-- they date, are recommended, dropped, matched and shown only with each other, never with real residents, and stay off
-- the public board and counters. New ones only via /api/signup with the server's demo key. Here, ONCE (only in the run that
-- adds the column; later migrations never flag anyone, so renaming an account to a demo name does nothing): the demo
-- accounts that already exist, by exact handle and "(demo)" name. One line: migrate.mjs splits statements on ";\n".
do $$ begin if not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'users' and column_name = 'is_demo') then alter table users add column is_demo boolean not null default false; update users set is_demo = true where name like '% (demo)' and created_at < '2026-10-29T00:00:00Z' and telegram in ('kismet_review_demo', 'maya_demo_kismet', 'arjun_demo_kismet', 'priya_demo_kismet', 'leo_demo_kismet', 'zara_demo_kismet'); end if; end $$;

-- A drop claim goes with its date (2026-10-28): when the date is deleted before its release (the other side deleted their
-- account), the person is picked again in that drop. It used to become date_id null, which reads as "no match this time".
-- A claim already released is kept as date_id null first (lib/actions.ts keepReleasedClaims): one drop per drop time.
-- Replaces the ON DELETE SET NULL key of tables made before; a no-op once it is a cascade. (One line: migrate.mjs splits on ";\n".)
do $$ declare c record; begin for c in select conname from pg_constraint where conrelid = 'drop_claims'::regclass and contype = 'f' and confrelid = 'dates'::regclass and confdeltype <> 'c' loop execute format('alter table drop_claims drop constraint %I', c.conname); end loop; if not exists (select 1 from pg_constraint where conrelid = 'drop_claims'::regclass and contype = 'f' and confrelid = 'dates'::regclass) then alter table drop_claims add constraint drop_claims_date_id_fkey foreign key (date_id) references dates(id) on delete cascade; end if; end $$;

-- Edge City only (2026-10-28, lib/edge-city.ts): Kismet is dating and friends for Edge City India residents. Self-attested
-- "Are you at Edge City India?": true = member (in the pool), false = said no (waitlist), null = not asked yet (out of the
-- pool until they answer; asked once on their next visit). edge_weeks: which weeks they are there (optional, informational).
-- edge_answered_at: when they answered (null when set by the migration below).
alter table users add column if not exists edge_city boolean;
alter table users add column if not exists edge_weeks text[] not null default '{}';
alter table users add column if not exists edge_answered_at timestamptz;
-- Accounts from before: Agent Village sign-ups are residents by definition. Everyone else is asked on their next visit.
update users set edge_city = true where edge_city is null and (village_resident is not null or signup_channel = 'village');
-- The App Review demo accounts (users.is_demo above, lib/demo.ts): members, so the reviewer sees the full app.
update users set edge_city = true where edge_city is null and is_demo;
-- Sign-ups from the store apps (lib/edge-city.ts signupEdgeCity): App Store build 2 never asks and has nowhere to answer,
-- and the app is listed for Edge City residents, so its accounts are members, like its new sign-ups that leave it out.
update users set edge_city = true where edge_city is null and signup_channel in ('ios', 'imessage', 'android');
create index if not exists users_edge_city_idx on users (edge_city) where edge_city;

-- Reports kept after the reported person deletes their account (Deon, 2026-10-28: "Keep reports + update policy",
-- lib/report-history.ts), so a banned or reported person can't delete and rejoin with a clean record. reported_keys: one-way
-- keyed hashes (HMAC-SHA256, SAFETY_HASH_KEY) of the reported person's Telegram, phones, sign-in emails and resident key,
-- written when the report is filed and refreshed on contact changes and on deletion; never the contacts. reported_gone_at:
-- when the account was deleted (the daily job deletes kept reports 12 months later); reported_banned / reported_hidden: it
-- was banned / hidden then (so the history still counts when reporters later delete their own accounts).
-- users.history_reviewed_at: an admin restored an account hidden by an earlier account's reports (they count no more).
alter table reports add column if not exists reported_keys text[] not null default '{}';
alter table reports add column if not exists reported_gone_at timestamptz;
alter table reports add column if not exists reported_banned boolean not null default false;
alter table reports add column if not exists reported_hidden boolean not null default false;
create index if not exists reports_keys_idx on reports using gin (reported_keys);
create index if not exists reports_kept_idx on reports (reported_gone_at) where reported_id is null;
alter table users add column if not exists history_reviewed_at timestamptz;
-- The report outlives the account: reported_id becomes null (ON DELETE SET NULL) instead of the report being deleted
-- (ON DELETE CASCADE). Replaces the cascade key on reported_id whatever its name; a no-op once it is SET NULL. The code live
-- before this deletes users as before, and their reports are now kept (without hashes or reported_gone_at: the new code's
-- daily job deletes those, as that code did).
-- (One line: migrate.mjs splits on ";\n".)
alter table reports alter column reported_id drop not null;
do $$ declare c record; col smallint; begin select attnum into col from pg_attribute where attrelid = 'reports'::regclass and attname = 'reported_id'; for c in select conname from pg_constraint where conrelid = 'reports'::regclass and contype = 'f' and conkey = array[col] and confdeltype <> 'n' loop execute format('alter table reports drop constraint %I', c.conname); end loop; if not exists (select 1 from pg_constraint where conrelid = 'reports'::regclass and contype = 'f' and conkey = array[col]) then alter table reports add constraint reports_reported_id_fkey foreign key (reported_id) references users(id) on delete set null; end if; end $$;

-- Deletions outside the database that failed when an account or a photo was deleted (lib/deletion-jobs.ts): Vercel Blob
-- photo files, Neon Auth sign-ins, Daytona agent boxes. The daily job retries them with backoff until they are gone.
-- target: a blob pathname, a Neon Auth user id or the deleted account's id (its box name); never a name or a contact.
create table if not exists deletion_jobs (
  id bigserial primary key,
  kind text not null check (kind in ('blob', 'neon_auth', 'agent_box')),
  target text not null,
  attempts int not null default 0,
  next_at timestamptz not null default now(),
  last_error text not null default '',
  last_tried_at timestamptz,
  created_at timestamptz not null default now(),
  unique (kind, target)
);
create index if not exists deletion_jobs_due_idx on deletion_jobs (next_at);

-- The second contact layer (2026-10-29, lib/contact-check.ts): a model reads the free text other people and their agents
-- see (bio, agent profile, agent name and personality, area, interest chips; agent notes) after stripContacts and
-- removes contact clues the patterns can't catch. contacts_checked_at: when that check ran (or the pre-filter found
-- nothing worth a call). Null: never checked (rows from before, or the model was down at write time); the daily job
-- (lib/contact-backfill.ts) checks those, and contacts_check_attempts counts its failed tries (it stops after 5: the row
-- waits for a person). users.contacts_input_hash: a fingerprint of the text as submitted, so the same text sent again
-- reuses its check. Columns only, no backfill here: the code live before ignores them.
alter table users add column if not exists contacts_checked_at timestamptz;
alter table users add column if not exists contacts_input_hash text;
alter table users add column if not exists contacts_check_attempts int not null default 0;
alter table agent_notes add column if not exists contacts_checked_at timestamptz;
alter table agent_notes add column if not exists contacts_check_attempts int not null default 0;
create index if not exists users_contacts_unchecked_idx on users (contacts_check_attempts, created_at) where contacts_checked_at is null;
create index if not exists agent_notes_contacts_unchecked_idx on agent_notes (contacts_check_attempts, created_at) where contacts_checked_at is null;
