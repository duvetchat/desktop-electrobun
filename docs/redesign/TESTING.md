# Testing the redesign

How the desktop redesign (#357) is tested without touching production: a local backend with seeded data, the UI
driven in Chromium against it, and the same two performance measurements taken before and after. The team's scripts
for one machine live outside the repo; this page says what any of them must do, so they can be rebuilt anywhere.

## Rules

- Never point a build at production (`api.duvet.chat`, `ws.duvet.chat`), never sign in with a real account, never post
  in a real chat. Everything below runs on `127.0.0.1`.
- Change no backend to make a test work. The API and the gateway are built from their checkouts and configured through
  their environment only; the desktop's own client keeps its wire behaviour.
- A test that checks behaviour keeps its assertions through the redesign; only its selectors change.

## A local stack

| Part | What it needs |
|---|---|
| PostgreSQL 17 | A fresh database migrated with goose from `api/database/migrations`. **Its time zone must be UTC**, as in production: the API's timestamps are `timestamp without time zone` filled with `NOW()` and read as UTC, so in another zone every new message shows hours old. |
| Redis (or Dragonfly) | One instance shared by the API and the gateway. Plain Redis works for everything the redesign needs (rate limits, pub/sub, caches, read states, call notices); production runs Dragonfly. Read states live only here: keep its snapshots. |
| API | Built from `api` (`go build ./cmd/duvet-api`) and run from an empty folder, so no `.env` is read. Its environment follows the end-to-end harness's (`api/tests/e2e/lib.ts`, `API_ENV`), with: `CORS_ORIGINS` listing every origin a test serves the UI from (and `views://mainview` for the desktop app); `FRONTEND_URL=https://duvet.chat`, so invite and message links stay cards the app draws and the API fetches no preview for them; `EMBEDS_ALLOW_PRIVATE_HOSTS=true` and `BUCKET_ALLOW_PRIVATE_ENDPOINTS=true`, so link previews and Space storage can use the local fakes; `TRUSTED_PROXIES=127.0.0.1`, so scripts can pick a client IP per request (`X-Forwarded-For`) and per-IP limits stay out of their way; `HTTPS_PROXY` pointing nowhere, as the harness does. `DUVET_ENV` stays unset. |
| Gateway | Built from `gateway`. `ADDR=127.0.0.1:<port>`, the same Redis, `ICE_UDP_PORT`, and **`ICE_PUBLIC_IP` unset**: the gateway's media socket listens on the machine's non-loopback addresses and advertises them, which a browser on the same machine reaches. Setting it to `127.0.0.1` breaks voice (nothing listens there). |
| Fake S3 | Path-style, any signature accepted, objects kept on disk (the e2e harness's `fakes.ts` keeps them in memory), CORS headers on every answer (the browser follows the API's presigned redirects there). Spaces need a storage bucket for icons, banners, emoji and stickers: point one at the fake. |
| Fake SMTP | Accepts everything and writes each email to a file. Registration emails carry the verification token: the seed verifies accounts through the API with it. |
| Offline web host | Pages with Open Graph tags and generated images, on loopback, for link previews that work offline. |

The API's own code listens on every interface, and the gateway's media port on every non-loopback address; neither
can be narrowed without changing the backend. Keep the stack on a trusted network.

## The seed

Fill the stack through the API over HTTP and the gateway over its WebSocket, as clients would, so the data is what the
real backend produces. Go around them only where they offer no way, and say so in the seed:

- **Rate limits**: per user, 64 requests a minute per route and place, 50 a second in all. A seed that sends thousands
  of messages either waits or clears the stack's own counters (`duvet:ratelimit:*` in Redis) when refused.
- **Dates**: every message is stamped `NOW()`. For day separators and "yesterday", move older messages' `created_at`
  (and `updated_at`, keeping an edited message's gap) back with SQL, in order. Group them in bursts a few seconds
  apart, or no two messages will group under one header (the app groups an author's messages within 5 minutes).

What it must contain, so every surface is reachable and every item of the parity ledger (`PARITY.md`) checkable:

- At least eight accounts with known passwords: a main account to sign in as, and others around it. Avatars and
  banners on some, none on others; a display name and none; a long name; a bio. A bot (team → application → bot), in
  a Space, with slash commands, posting messages with buttons, a select menu and a components container.
- Friends accepted, an incoming request, an outgoing request. (There is no blocking in the API.)
- More than six chats: DMs, one with a long history (3,000 messages or more, over weeks, with images, replies and voice
  notes, for the scrolling measurement), groups (named, unnamed, one with six people).
- A busy Space the main account owns: categories, many text rooms, voice rooms, a private room, a read-only room, roles
  with gradient colours (hoisted and not), custom emoji, stickers, pins, a webhook with embeds, invites, a banned
  member. A Space where the main account is an ordinary member with few permissions. Quiet Spaces (one muted).
- Messages of every kind the app draws: Markdown (bold, italic, strike, spoilers, quotes, ordered and nested lists,
  tables, inline code, code blocks with and without a language), replies and reply chains (threads), mentions of the
  main account and of others, room links, custom emoji inline and alone, emoji alone, reactions (several people on one,
  a custom one), an edit, a delete, pins (and their notices), attachments of each kind (one image, several, a GIF, a
  video, an audio file, a voice note sent as type 1, a PDF, a text file, a zip), link previews, a link without a preview,
  a masked link, image and video links, stickers, invite links and message links (drawn as cards), webhook messages with
  rich embeds and a video player embed, bot messages with components, call notices (a missed call, an answered call, a
  cancelled group call, made through the gateway's call ops).
- Unread chats and rooms, mentions in several places, a muted chat, a muted room, a muted Space, a Space set to
  mentions only. A pending team invite; a personal storage bucket.

Presence exists only while a client holds a gateway connection: a script that wants people online keeps sockets open
for them. Custom statuses, idle and invisible don't exist in the API (online and do not disturb do).

## Pointing the app at it

The UI reads `VITE_API_URL` and `VITE_WS_URL` from `src/mainview/.env.development.local`, **in development mode
only** (`vite dev`, or `vite build --mode development`), and adds their origins to the CSP's `connect-src`. Production
builds ignore them. Refuse to serve a worktree whose file doesn't point at `127.0.0.1` or `localhost`.

- Vite's dev server on any port works for driving the UI. `app.html`'s redirect from `/` maps to the dev routes only on
  port 5173, so open `/sign-in` or `/app` directly elsewhere.
- For measurements, build with `vite build --mode development` and serve the static output yourself (any static host:
  `/x` answered with `x.html`). That is the production bundle shape, with the dev-mode URLs.
- The desktop app reads the same file when built in development mode. Run it with a separate home directory, so it
  never touches a real session.

Signing in from a script: `POST /api/auth/login` (`{email, password}`) returns `token` and `session_token`; the app
keeps them in `localStorage` as `duvet_session_token` and `duvet_refresh_token`, with `duvet_session_refreshed_at`
(milliseconds). Set them before the app's first script runs. Go through the sign-in page at least once per test run,
and fill it only after the page has hydrated (see BASELINE.md).

Chromium needs `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` and the microphone, camera and
notification permissions for voice and calls. Two headless browsers in one voice room, each receiving the other's audio
(`RTCPeerConnection.getStats`), prove the SFU works.

Outside services the app reaches anyway: emoji images (jsDelivr), Google's STUN server when the gateway hands out no ICE
servers, the GIF picker's KLIPY, and YouTube only when a player is started. Block them in the browser when a test must
be fully offline.

## The two measurements

Both are taken on the same machine, from a static development-mode build of each worktree, against the same seed,
signed in as the main account, in headless Chromium at 1280×800. Each is run twice; the difference between the two
runs is the noise, and a change smaller than it isn't a change.

**Startup.** The app's own marks (`lib/startup-timing.ts`): `app`, `session`, `socket`, `ready`, `spaces`, `shown`, in
milliseconds since the page started, read from the `[startup]` line it logs. With them, the browser's first paint,
first contentful paint, DOMContentLoaded and load, and **messages on screen**: the time until the long DM shows
messages, the page itself opening that chat the moment its row appears (the app starts on Friends). Cold: a fresh
profile per run (empty cache, no saved addresses, so no early socket). Warm: one profile reloaded (cache and
`duvet.start.v1` kept, as every later start of the desktop app). At least 15 of each; median and 90th percentile.

**Scrolling the long chat.** Open the long DM; take the DOM size and the JS heap after a garbage collection; scroll up
with wheel events at a fixed speed (3,000 px/s, Chromium's smooth scrolling off) until the start of the conversation
shows; take them again; scroll down at the same speed to the newest message; take them again. Throughout, in the page:
`requestAnimationFrame` intervals while scrolling (median, 95th percentile, over 33 ms, over 50 ms), long tasks and
long animation frames, each older page's request, its arrival in the DOM and when the list settled (scroll height
unchanged for three frames), and whether the reader's place held: each frame, how far the message in the middle of
the list moved beyond what the scroll moved it. At least five runs.

Headless Chromium paces frames at 30 Hz (33.3 ms), not the display's rate: frame intervals compare only with other
headless runs, and "over 33 ms" means slower than that pace.
