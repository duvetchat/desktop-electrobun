# Duvet — Desktop Client

A Discord-like communication platform for developers. Native desktop app built with **Electrobun** + **SvelteKit**.

## Architecture Overview

Duvet is a monorepo with three services:

```
┌─────────────────────────────────────────────────────────┐
│  Desktop Client (Electrobun + SvelteKit)                │
│  ├── REST API calls ──► api/    (Go/Gin + PostgreSQL)   │
│  └── WebSocket ──────► gateway/ (Go + Pion WebRTC)      │
│                            └── Redis pub/sub            │
└─────────────────────────────────────────────────────────┘
```

| Service      | Stack                                                   | Purpose                                                         |
| ------------ | ------------------------------------------------------- | --------------------------------------------------------------- |
| **api/**     | Go, Gin, PostgreSQL, sqlc, Redis                        | REST API — auth, users, spaces, rooms, roles, invites, messages |
| **gateway/** | Go, Gin, gorilla/websocket, Pion WebRTC, Redis          | Real-time WebSocket events, WebRTC SFU voice chat               |
| **desktop/** | Electrobun, SvelteKit 2, Svelte 5, Tailwind CSS 4, Vite | Native desktop client with custom titlebar and split-pane views |

## Desktop — Project Structure

```
desktop/
├── electrobun.config.ts          # Electrobun app config (icons, build, copy rules)
├── icon.iconset/                 # macOS iconset + Windows .ico
├── src/
│   ├── bun/
│   │   └── index.ts              # Electrobun main process — window creation, RPC, HMR detection
│   └── mainview/                 # SvelteKit app (the entire UI)
│       ├── svelte.config.js      # SvelteKit config (static adapter, prerender)
│       ├── vite.config.ts        # Vite config (Tailwind, proxy rules)
│       └── src/
│           ├── routes/           # SvelteKit pages
│           │   ├── (auth)/       # Auth pages (sign-in, sign-up, forgot-password)
│           │   ├── app/          # Main application view (chat, channels, voice)
│           │   └── invite/       # Invite link handler
│           └── lib/              # Shared modules
│               ├── api/          # REST API client modules
│               │   ├── auth.ts
│               │   ├── spaces.ts
│               │   ├── rooms.ts
│               │   ├── roles.ts
│               │   ├── messages.ts
│               │   ├── invites.ts
│               │   ├── user.ts
│               │   └── ws/
│               │       └── connection.ts   # WebSocket gateway client (events, resume, WebRTC)
│               ├── components/   # Svelte 5 UI components
│               │   ├── Chat/               # Message list, input, embeds
│               │   ├── GuildSidebar/       # Space/server list
│               │   ├── ChannelsSidebar/    # Channel tree per space
│               │   ├── GuildMemberSidebar/ # Member list with roles
│               │   ├── VoiceChat/          # WebRTC voice channel UI
│               │   ├── ServerSettings/     # Space settings modal
│               │   ├── PaneView/           # Split-pane tab layout
│               │   ├── Header/             # App header with drag region
│               │   ├── GifPicker/          # GIF search and picker
│               │   └── ...                 # Invite modals, embeds, avatars
│               ├── types/
│               │   └── index.ts            # TypeScript types (Space, Room, Role, Member, Message, etc.)
│               ├── stores.svelte.ts        # Svelte 5 reactive state (session, spaces, messages, voice)
│               ├── permissions.ts          # Client-side permission resolver (mirrors gateway logic)
│               ├── pane.ts                 # Split-pane tree layout utilities
│               ├── electrobun-rpc.ts       # RPC bridge to native Electrobun layer
│               ├── window-controls.ts      # Custom titlebar window controls
│               └── common/
│                   └── common.ts           # API/WS host URLs
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) >= 1.3
- [Electrobun](https://electrobun.dev/) 2, through the `electrobun` dependency: on its first run it downloads its build
  tool, Hutch, which keeps Electrobun's runtime, Bun and the other tools it needs in `~/.hutch`, and writes the
  Electrobun SDK to `.hutch/devkit` (ignored by git), where the app's `electrobun/*` imports come from

### Install

```bash
cd desktop
bun install
bun run devkit   # electrobun prepare: the Electrobun SDK, in .hutch/devkit
cd src/mainview && bun install && cd ../..
```

`bun start`, `bun run hmr` and `bun run build:canary` prepare the SDK themselves. `bun run lint` and `bun run check`
need it, so a fresh checkout runs `bun run devkit` before `src/mainview`'s install, whose `svelte-kit sync` points
`electrobun/view` at it. The web build (`bun run build` in `src/mainview`, what duvet.chat serves) doesn't need it:
the SDK's only import runs in the app's window.

### Development

**Standard dev** (builds SvelteKit first, then launches Electrobun):

```bash
bun start
```

**HMR dev** (Vite dev server + Electrobun in parallel — live reload on file changes):

```bash
bun run dev:hmr
```

> In HMR mode, the Vite dev server runs on `localhost:5173`. The Electrobun main process detects it automatically and loads the dev URL instead of the static build.

**Electrobun only** (skips SvelteKit build, useful after first build):

```bash
bun run dev
```

It rebuilds when a file changes. On Windows, Electrobun 2 waits for the running app to close before it rebuilds.

### Production Build

```bash
bun run build:canary
```

### Formatting

```bash
bun run format          # auto-fix
bun run format:check    # check only
```

## API Service (`api/`)

Go REST API using Gin, PostgreSQL (pgx + sqlc), and Redis for session/cache.

**Key endpoints:**

| Method | Path               | Description                    |
| ------ | ------------------ | ------------------------------ |
| POST   | `/api/auth/signin` | Register new user              |
| POST   | `/api/auth/login`  | Login (returns session token)  |
| GET    | `/api/users/me`    | Get current authenticated user |

**Database** — 12 tables managed via SQL migrations: users, sessions, spaces, rooms, roles, members, room overwrites, invite links, friends, etc.

## Gateway Service (`gateway/`)

Real-time WebSocket server + WebRTC SFU for voice.

- **WebSocket**: event dispatch (message create/delete, user status, space updates, voice state)
- **WebRTC**: SFU-style voice rooms via [Pion](https://github.com/pion/webrtc) — per-user audio tracks, mute/deafen
- **Permissions**: bitfield-based role permissions with room-level overwrites (mirrors Discord's model)
- **Redis pub/sub**: cross-service event propagation

**Permission flags**: `Administrator`, `ViewChannels`, `SendMessages`, `ManageMessages`, `ManageChannels`, `ChangeNickname`, `JoinVoice`, `SpeakInVoice`, `ManageRoles`, `ManageInvites`, `CreateInvites`

## Notes

- Scripts are now fully Bun-native (`bun --cwd ...`) and no longer depend on `.sh` wrappers.
- The `icon.iconset/` folder contains all macOS icon sizes + a `.ico` for Windows/Linux. Icons are generated from `src/mainview/src/lib/assets/icon.svg` using Sharp.
- The app uses `@sveltejs/adapter-static` to pre-render pages as static HTML that Electrobun loads via `views://` protocol. In HMR mode, it loads directly from the Vite dev server instead.
