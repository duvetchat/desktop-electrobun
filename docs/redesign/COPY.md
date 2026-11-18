# The copy of the desktop redesign

What the redesigned desktop app says, and how. Workers take their strings from here; the review checks the finished app against it. Tracking issue: #357. Written in Phase 0 (2026-11-18) against `redesign/desktop` at `c6e514a`, from the app's source, the prototype (`desktop-prototype/`, `BRIEF.md`) and mobile (`mobile/lib`).

- **Sections:** [1 How the app writes](#1-how-the-app-writes-today) · [2 Encryption claims](#2-encryption-claims) · [3 Space and room](#3-space-and-room-wording) · [4 New strings](#4-strings-the-new-layout-needs) · [5 Strings that go or change](#5-strings-that-go-away-or-change) · [6 Shortcuts](#6-shortcut-labels) · [7 The forbidden list](#7-the-forbidden-list) · [8 Open questions](#8-open-questions)
- **Paths:** `lib/…` is `src/mainview/src/lib/…`, `components/…` is `src/mainview/src/lib/components/…`, `routes/…` is `src/mainview/src/routes/…`. Line numbers are those of `c6e514a`.
- **`{name}`** marks a value filled in at run time. `{n} room/rooms` means the singular when n is 1.
- **Status words** in the tables: *keep* (the string exists today and stays as it is), *change* (it exists and is reworded, with the reason), *new* (the redesign needs it), *proposal* (the prototype shows it, but the feature behind it isn't in the app: it doesn't ship; see rule 4 of the brief).

---

## 1. How the app writes today

The app has no translation file: its strings live in the Svelte components and the `.ts` modules. They come from two eras. The newer strings (calls, voice, call history, the Now section, the keyboard sheet, statuses) follow the rules below, as mobile and the prototype do. The older ones (settings, room management, tab menus, the voice bar) use Title Case, "Failed to…" and exclamation marks. **New strings follow the newer voice**, and a surface the redesign redraws brings its old strings into line ([§5](#5-strings-that-go-away-or-change)).

### Case

Sentence case for everything: labels, buttons, menu items, headings, tooltips, `aria-label`s, window titles. Only the first word and proper nouns take a capital.

| Today, sentence case (follow) | Where |
|---|---|
| Join or create a Space | `components/SpaceNav.svelte:623` |
| Mark all as read · Pin to top · Create room | `components/SpaceNav.svelte:192-210` |
| Noise suppression on | `components/UserStatusBar.svelte:287` |
| Keyboard shortcuts | `components/KeyboardLayer.svelte` (the sheet's heading) |
| Pinned messages · Unpin message | `components/PinnedMessages.svelte:147-198` |
| Leave voice room · Turn on camera · Share screen | `components/VoiceChannelView.svelte:555-692` |

| Today, Title Case (don't follow) | Where |
|---|---|
| Close Others · Close to the Left · Close to the Right · Close All | `components/TabBar.svelte:255-273` |
| Space Settings · Create Room · Copy Room ID · Edit Category · Delete Category · Invite People · Delete Room | `components/ChannelsSidebar.svelte:420-652` |
| Room Type · Text Room · Voice Room · Room Name | `components/ChannelsSidebar.svelte:726-755` |
| Voice Connected · Connection Failed · In Call | `components/UserStatusBar.svelte:94-96, 203` |
| Toggle Mute · Toggle Noise Suppression · User Settings (`aria-label`s) | `components/UserStatusBar.svelte:264, 286, 294` |
| Do Not Disturb | `lib/status.ts:17` (the members list already says "Do not disturb", `lib/members.ts:69`) |
| My Account · S3 Buckets · Activity Privacy · Log Out | `components/UserSettings.svelte:119-128, 1250` |
| Master Volume · Join Voice · Leave Voice · Incoming Call · Screen Share On | `components/UserSettings.svelte` (the sounds list) |
| GIF Picker · Copy User ID · Edit Flags & Badges · Space Emojis · Change Avatar | `components/GifPicker.svelte:81`, `components/MessageList.svelte:1786, 1820`, settings |

### Names

| Word | How | Examples |
|---|---|---|
| **Space** | Always a capital S, as a product's name: "a Space", "Spaces", "Space settings". | "Join or create a Space" (`components/SpaceNav.svelte:623`); mobile writes it so in 97 strings to 21 |
| **room** | Lowercase unless it starts a sentence. Kinds: *text room*, *voice room*. A room's name shows with `#` in text: "#general". | "Leave voice room", "No rooms you can see yet" (`components/ChannelsSidebar.svelte:455`) |
| **category** | Lowercase. | |
| **chat** | What a tab or pane shows, room or conversation ("Open chat 1 to 8", `components/KeyboardLayer.svelte:58`; "No chat open"), and, in the redesign, the sidebar's **Chats**: direct messages and groups. | |
| **direct message**, **group** | A chat with one person; a chat with several. "DM" isn't written in the UI. | "Direct message" / "Group" (`components/SpaceNav.svelte:227`) |
| **conversation** | The older word for a DM or group ("No conversations yet", "Start conversation"). New strings say *chat*. | |
| **call** | A call in a DM or group. **voice** is being in a voice room: "in voice", "Join voice", "Leave voice". | "{n} in voice" (`components/ChannelsSidebar.svelte:599`) |
| **voice note** | Not "voice message" (only macOS's microphone prompt says that, `electrobun.config.ts:38`). | "Record voice note" (`components/ChatInput.svelte:1427`) |
| **emoji**, **emojis**; **GIF**, **GIFs**; **sticker** | As written. | |
| **friend**, **friend request**; **member**, **role**; **bot**, **webhook**; **invite** | Lowercase. | |
| **user ID** | Two words, "ID" in capitals. | "Send a request with their user ID." (`components/FriendsView.svelte:639`) |
| **Duvet**, **KLIPY**, **Spotify**, **S3** | Proper nouns. | "GIFs from KLIPY" (`components/GifPicker.svelte:143`) |
| **@everyone** | As written. | |

Never in the UI: server, channel, guild ([§3](#3-space-and-room-wording)), and nothing about encryption ([§2](#2-encryption-claims)).

### Voice and person

- The reader is **you**: "You're not connected to voice" (`components/VoiceChannelView.svelte:69`), "Your camera was disconnected" (`components/VoiceChat.svelte:983`).
- The app names itself **Duvet** when it explains what it can or can't do: "Duvet can't use the microphone: you're listening only" (`components/VoiceChat.svelte:289`), "Duvet isn't allowed to use your camera. Allow it in your system's privacy settings." (`lib/video.ts:45`).
- Plain words, short sentences, active verbs. A consequence follows a **colon** in the same sentence: "You left voice: the connection was lost for a while" (`components/VoiceChat.svelte:184`).
- No exclamation marks in new strings. Old toasts have them ("Space updated!", "Link copied!", "Joined!"); newer ones don't ("Friend request sent", `components/MessageList.svelte:210`; "Nothing unread").

### Punctuation

| Rule | Example |
|---|---|
| No full stop on a label, button, menu item, tooltip, heading, or a toast of one clause. | "Couldn't load your calls" |
| A full stop on each sentence of a description, a body line, an empty state's explanation or a confirmation. | "No messages yet. Send the first message." (`components/MessageList.svelte:920`) |
| The ellipsis character `…`, never `...`: for work in progress and for prompts. | "Loading…", "Calling…" (`components/CallCard.svelte:133`), "Search or jump to…" (`components/SpaceNav.svelte:434`). Old: "Connecting...", "Measuring ping...", "Search emoji..." |
| No `…` on a menu item that opens a window or a dialog. The app writes "Space settings" (`components/SpaceNav.svelte:197`); the prototype's "Settings…", "Room settings…", "Edit profile…" lose it. | |
| A **middle dot with spaces** ` · ` between facts on one line. | "#room · Space" (`lib/mention-notices.ts:46`) |
| A **colon** to explain or to label a value. | "Ping: 24 ms" |
| Curly double quotes around what the user typed. | `Nothing matches “{query}”` (`components/QuickSwitcher.svelte:266`) |
| The straight apostrophe `'` in strings, as the app writes them ("Couldn't", "You'll"); the prototype's curly `’` isn't ported. | |
| An em dash only where the app has one today ("Call in progress — Join", `components/ConversationView.svelte:1129`); new strings use a colon or a middle dot. | |

### Numbers, times and plurals

- Digits, always: "3 mentions", "99+" (`components/DMSidebar.svelte:116`), "1,000+ results" (`components/MessageSearch.svelte:517`).
- Plurals agree: "1 new message" / "{n} new messages" (`components/MessageList.svelte:1560`), "1 room" / "{n} rooms" (`components/NowSection.svelte:478`). Some strings don't yet ("{n} mentions" with n = 1): new strings always agree.
- Times in `en-US`: "12:41 PM", "Today", "Yesterday", a weekday's short name within the week (`lib/call-history.ts:198-210`).
- Durations in words in sentences: "a few seconds", "3 minutes", "1 hour 5 minutes" (`lib/call-notices.ts:48-55`); a clock "1:05" on a playing voice note.
- Units with a space: "24 ms", "2.4 MB". (The voice bar writes "24ms" today, `components/UserStatusBar.svelte:184`; mobile writes "24 ms".)

### Errors

- New errors say **"Couldn't …"**: "Couldn't load your calls" (`components/CallHistory.svelte:107`), "Couldn't rename the group", "Couldn't open your microphone", "Couldn't connect to voice". 86 older strings (in 103 toasts) say "Failed to …" ("Failed to delete room"); leave them unless their surface is redrawn.
- When the API says why, the toast shows the API's text instead (`getApiError`, `lib/api/api.ts:518-524`); the app's own string is the fallback.
- What to do next goes after a colon or into a button: "Try again" (`components/CallHistory.svelte:99`, `components/MessageList.svelte:913`).

### Empty states

A short title that states the fact, and a sentence saying what will show there or what to do; the mascot beside it where the app has one.

- "No calls yet" / "Calls in your direct messages and groups show here." (`components/CallHistory.svelte:121`)
- "No messages yet. Send the first message." (`components/MessageList.svelte:920`)
- "No rooms you can see yet" (`components/ChannelsSidebar.svelte:455`), "No conversations yet" (`components/DMSidebar.svelte:151`)
- `Nothing matches “{query}”` (`components/QuickSwitcher.svelte:266`)

### Confirmations

A question, then what follows, and a button that repeats the verb:

- `Leave "{Space}"? You'll need an invite to join it again.` → **Leave** (`components/SpaceNav.svelte:160`)
- `Remove {name} from your friends?` → **Remove** (`components/FriendsView.svelte:238`)
- `Unban {name}? They can join {Space} again.` (`components/SpaceBans.svelte:50`)

### Tooltips, `aria-label`s and toggles

- A tooltip is a short verb phrase: "Start call", "Close pane", "Pinned messages".
- An `aria-label` names the action and its object wherever the icon alone wouldn't: "Join the call in {name}" (`components/CallHistory.svelte:156`), "Message {name}" (`components/FriendsView.svelte:529`), "Close {title}" (`components/SpaceNav.svelte:515`). Counts read out in full: "3 mentions".
- A toggle's label says what a press does, and swaps: "Mute" / "Unmute", "Deafen" / "Undeafen", "Turn on camera" / "Turn off camera" (`components/VoiceChannelView.svelte:555-682`). A setting that is on or off says its state: "Noise suppression on" / "off" (`components/UserStatusBar.svelte:287`). Never "Toggle …".
- A shortcut in a tooltip: the app writes it in brackets after the label, "Close (Esc)", "Zoom in (+)" (`components/ImagePreview.svelte:140-186`); the redesign's tooltips draw it as keycaps after the label instead ([§6](#6-shortcut-labels)), and the control carries `aria-keyshortcuts` (as `components/SpaceNav.svelte:431` does).

---

## 2. Encryption claims

Duvet isn't end-to-end encrypted. Nothing in the app may say or hint that it is: no words, no lock or shield used as a badge, no copy that promises privacy it doesn't have.

**Result: the app makes no encryption claim.** Every hit is a permission, a technical attribute, an account-security message or code. The prototype has **one privacy claim** that must not be ported. Mobile has none in its UI, but one comment that could lead a port astray.

### The searches, to run again

From the repository's root, then with the paths swapped for `/Users/yuzu/Desktop/duvet/desktop-prototype` (leave out `assets/vendor`, `assets/emoji.js`, `assets/icons.js`) and `/Users/yuzu/Desktop/duvet/mobile/lib`:

```bash
# 1. encryption words
grep -rn -i -E 'encrypt|end[- ]to[- ]end|e2ee|\be2e\b|cipher|crypto|\bkms\b|zero[- ]knowledge' \
  src --exclude-dir=node_modules --exclude-dir=.svelte-kit --exclude-dir=build | grep -v '\.test\.ts:'
# 2. privacy and security words (then drop TypeScript's `private` members and comments by eye)
grep -rn -i -E '\b(secure|securely|security|private|privately|privacy|safe|safely|safety|protected|protection|confidential|trusted|verified|sealed|never sees|only you|nobody else|no one else|can.t (read|see))\b' \
  src --exclude-dir=node_modules --exclude-dir=.svelte-kit --exclude-dir=build | grep -v '\.test\.ts:'
# 3. lock, shield and key icons (lucide imports and their uses)
grep -rn -E 'icons/(lock|shield|key|fingerprint|badge-check|vault|scan-face)|\b(Lock|LockKeyhole|LockOpen|Shield[A-Za-z]*|Key|KeyRound|Fingerprint|BadgeCheck)( as [A-Za-z]+)?,?\s*$|<(Lock|Shield|Key)[A-Za-z]*Icon\b|<Lock\b' \
  src/mainview/src | grep -v '\.test\.ts:'
# in the prototype the icons are named in strings: "'(lock|lock-keyhole|lock-open|shield[a-z-]*|key[a-z-]*|fingerprint|badge-check)'"
# in mobile: 'LucideIcons\.(lock|shield|key|fingerprint|badgeCheck)[A-Za-z0-9]*'
```

Searched: `src/mainview/src` (components, lib, routes, `app.html` and its meta tags, the Open Graph text, the Discord link-preview card `routes/link-preview.json/+server.ts`), `src/mainview/static` (sounds, a badge, the noise worklet), `src/bun` (including `toast.ps1` and `spotify-smtc.ps1`), `electrobun.config.ts` (macOS's microphone and camera prompts). The app has no web manifest. The build (`src/mainview/build`) was searched too; see the end of this section.

### The app

| Where | What | Kind | Do |
|---|---|---|---|
| `components/EmbedCard.svelte:143` | `allow="autoplay; encrypted-media"` on a video embed's iframe | technical | **must stay** (players need it) |
| `components/EmbedCard.svelte:239` | `allow="autoplay; encrypted-media; picture-in-picture"` | technical | **must stay** |
| `components/ChannelsSidebar.svelte:8, 585` | `Lock` badge on a voice room's icon when you can't join it | permission | fine |
| `components/VoiceChannelView.svelte:36, 709` | `Lock` in "Join room" when you can't join; title "You can't join this voice room" (`:704`) | permission | fine |
| `components/UserSettings.svelte:25, 2488` | `Lock` on a private bot; title "Private — only team members can add" (`:2482`) | permission (who may add the bot) | fine |
| `components/ChannelSettings.svelte:5, 361` | `Shield` on the room's Permissions section | permission | fine |
| `components/ServerSettings.svelte:8, 1182` | `Shield` on the Space's Roles section | permission | fine |
| `components/UserSettings.svelte:12, 126, 1260` | `Shield` on the **Security** section (password reset, email) | account security: about signing in, not about messages | fine |
| `components/UserSettings.svelte:1357` | "Verify your email to secure your account." | account security | fine. If the review wants no "secure" anywhere: "Verify your email, so you can always get back into your account." |
| `components/UserSettings.svelte:129, 1260` | "Activity Privacy": whether others see what you play on Spotify | a privacy control, not a promise | fine; sentence case: "Activity privacy" |
| `lib/video.ts:45` | "… Allow it in your system's privacy settings." | technical (the OS's settings) | fine |
| `components/MessageList.svelte:1237` | "Only you can see this" on a bot's ephemeral reply | a fact about who sees one message | fine |
| `lib/stickers/icons.ts:270` | an animated sticker named "padlock" | content a user chooses to send | fine |
| `src/mainview/svelte.config.js`, `src/mainview/package.json` | "Content Security Policy" (comments), `"private": true` | code | not user-facing |
| `lib/**` (`crypto.randomUUID()`), `src/bun/notification-avatars.ts:1` (`node:crypto`) | code | code | not user-facing |

Nothing in `src/bun`, the `.ps1` scripts, `static/`, `app.html`'s meta tags ("A cozy place to talk: spaces with text and voice rooms, direct messages and groups."), the link-preview card or the macOS prompts.

### The prototype (don't port what's flagged)

| Where | What | Kind | Do |
|---|---|---|---|
| `js/overlays.js:363` | "GIFs come through Duvet’s proxy: the GIF service never sees you" (the GIF picker's footer) | **claim**: a privacy guarantee | **don't port.** Keep the app's "GIFs from KLIPY" (`components/GifPicker.svelte:143`) |
| `js/overlays.js:624` | Create room's "Private" toggle, "Only the roles and members you pick see it" | permission | wording fine; the toggle isn't in the app's Create room → proposal |
| `js/windows.js:164-178, 290, 307` | a **Privacy** settings section with a `shield` icon (devices signed in, who can reach you, link previews, read receipts) | privacy controls, not claims | none of these controls is in the app → proposal; don't ship the section |
| `js/windows.js:246` | "Your files are yours: export them, or move them to storage you own, any time." | a promise (export isn't in the app) | don't port |
| `js/windows.js:262` | "Two-step sign-in" toggle | a security feature the app doesn't have | don't port |
| `js/windows.js:412, 450, 529` | `shield` on Space settings' Roles and room Permissions | permission | fine |
| `README.md:42`, `BRIEF.md:41` | the rule itself | docs | not UI |

No lock icon is used in the prototype's surfaces.

### Mobile (`mobile/lib`)

| Where | What | Kind | Do |
|---|---|---|---|
| `widgets/duvet_mascot.dart:12` | a doc comment: the `under_duvet` mascot is for "Privacy, encryption, “only you can see this”" | a comment, but a porting risk | never use a mascot (or anything) to suggest messages are private or encrypted. The prototype uses `under_duvet` for an empty voice room, which is fine |
| `chat/bubble.dart:673` | "Only you can see this" (an ephemeral message) | a fact | fine; the desktop says the same |
| `space_admin.dart:2527` | `lock` on a role above yours ("theirs to see, not to move or change") | permission | fine |
| `app_commands.dart:53`, `chat_view.dart:1713`, `space_admin.dart:318, 1186` | `shield` on roles and permissions | permission | fine |
| `data/duvet_repository.dart:30, 40, 4892` | `secure` (whether the API is on https) | code | not user-facing |

### The build

`grep -rl -i -E 'encrypt|end[- ]to[- ]end|e2ee' src/mainview/build --include='*.js' --include='*.html' --include='*.css'` finds eight files at `c6e514a`, none of them copy: the two `allow` attributes above (`_app/immutable/nodes/9.*.js`), Electrobun's view RPC (`window.__electrobun_encrypt` / `__electrobun_decrypt`, the transport between the webview and the Bun process), and six Shiki language grammars (SQL, Fortran and other keywords such as `ENCRYPT`, `pwdencrypt`). A new hit in any other file needs a look.

---

## 3. Space and room wording

### What `wording.test.ts` enforces, and what it can't see

`src/mainview/src/lib/wording.test.ts` (#57) fails when, in any `.svelte` or `.ts` file under `src/mainview/src` (tests and `components/server-render.ts` aside):

- a quoted string **with a space in it** contains `server(s)` or `channel(s)` (case-insensitive), not counting tokens that hold `{ } $ [ ] / : .`, lines that start a comment, and lines that call `console.`;
- a `title`, `aria-label`, `placeholder` or `alt` attribute written as `="…"` contains the words;
- a run of text between two tags in a component's markup contains them.

It also checks that `lib/permissions.ts` names "View Rooms" and "Manage Rooms". Two strings are allowed because they mean the API: "No answer from the server in time" and "Server did not return a valid token".

It can't see:

1. **`guild(s)`**: it isn't in the pattern.
2. **One-word strings**: `"Servers"`, `label: "Channel"` have no space.
3. **Text beside an interpolation**: `<p>Delete channel {name}</p>` doesn't match `>([^<>{}]+)<`.
4. **Strings over several lines** (template literals, text broken across lines in a `{… ? "…" : "…"}`).
5. **Lines that also call `console.`** or start with `*` or `//`.
6. **Attributes written as expressions**, `aria-label={"…"}`, unless the string itself has a space.
7. **Files outside `src/mainview/src`**: `src/bun` (its notifications and toasts, the `.ps1` scripts), `src/mainview/static`, `electrobun.config.ts` (macOS's prompts).
8. **Text the app shows but doesn't own**: the API's error messages (below).
9. **A lowercase "space"**, which isn't wrong for the test.

### The scan

`wording.test.ts` passes at `c6e514a`. To see past it, every quoted string and every run of markup text in `src/mainview/src` and `src/bun` was listed, one-word strings, text beside `{…}` and `guild` included, then read by hand:

```bash
bun /Users/yuzu/Desktop/duvet/redesign-work/notes/p0-copy/scan-words.ts src/mainview/src src/bun src/mainview/static
# the same, for a lowercase space:
bun /Users/yuzu/Desktop/duvet/redesign-work/notes/p0-copy/scan-words.ts src/mainview/src src/bun '--word=\bspaces?\b' \
  | grep -E '(STR|TXT) "[^"]* [^"]*"' | grep -E '[^A-Za-z_.$/-]spaces?([^A-Za-z_/-]|$)'
```

(`scan-words.ts` sits outside the repository, in the team's work area; it prints `file:line: STR|TXT "string"`.)

### Hits: server, channel, guild

**No visible string in the app says server, channel or guild.** What the scan found:

| Where | What | Do |
|---|---|---|
| `lib/api/api.ts:38` | "No answer from the server in time" (a `NoAnswerError`; `getApiError` passes its text to toasts, `lib/api/api.ts:522`) | allowed (it means the API). Optional: "Duvet didn't answer in time", since a Discord user reads "server" as a Space. Changing it means changing `ABOUT_THE_API` in the test. The lead's call |
| `lib/api/auth.ts:101` | "Server did not return a valid token" (thrown while signing in) | allowed. Optional: "Duvet didn't send back a valid sign-in" |
| the API, shown verbatim by `getApiError` | `api/internal/services/errors.go:21` "internal server error"; `:169` "you don't have permission to view this channel"; `:170` "you don't have permission to send messages in this channel"; `:174` "you don't have permission to manage channels"; `:196` "you don't have permission to manage permissions for this channel" (the gateway has the first three too, `gateway/internal/core/services/errors.go:8-13`) | the API can't change (rule 3). Options for the lead: leave it; or have the desktop show its own fallback for these known texts. That changes no wire behaviour, but it is a change of behaviour |
| identifiers | component files `ServerSettings.svelte`, `ChannelSettings.svelte`, `ChannelsSidebar.svelte`, `GuildMemberSidebar.svelte`, `VoiceChannelView.svelte`, `server-render.ts`; variables `guild`, `channel`; the drag type `"channel"` (`lib/pane.ts:181`, `components/TabBar.svelte:96`); the link path `/channels/…` (`lib/urls.ts:180`); HTML ids `server-name` (`components/AddSpaceModal.svelte:102-119`) | not user-facing; nothing to do. The redesign may rename what it rewrites |
| `src/bun/notification-setup.ts:22-27` | the release **channel** (stable, canary) | the user sees only "Duvet" or "Duvet Canary" |
| `src/bun/index.ts:48, 52, 326` | "Vite dev server …", "[IPC] Failed to start server" | logs, not UI |

Not to port from elsewhere:

- **Mobile:** a room's screen-reader title says "Channel {room}, …, switch channel" (`mobile/lib/chat_view.dart:2534`). Mobile's own errors say "This server can't …" and "The server refused the link" (`mobile/lib/data/duvet_repository.dart:2821, 2883-2884, 3271, 3289`).
- **The prototype:** "Your own WebDAV server" (`js/windows.js:249`) is a storage feature the app doesn't have (proposal). "YouTube · {channel}" (`js/messages.js:262`) is a YouTube channel's name, which belongs to the content. The app's embeds show what YouTube sends.

### Hits: a lowercase "space"

Not a violation of the test, but the app writes **Space** ([§1](#names)). Each of these should take a capital when its surface is touched:

| Where | Today | Ship |
|---|---|---|
| `components/SpaceNav.svelte:337, 365` | Leave space | Leave Space |
| `components/NowSection.svelte:201` | A space | A Space |
| `components/QuickSwitcher.svelte:191` | Jump to a space, room or conversation | Jump to a Space, room or chat |
| `components/QuickSwitcher.svelte:201` | Search spaces, rooms and conversations | Search Spaces, rooms and chats |
| `components/QuickSwitcher.svelte:266-267` | No spaces or conversations yet | No Spaces or chats yet |
| `components/SpaceBans.svelte:104` | Banned users can't join the space until they're unbanned. | Banned people can't join the Space until they're unbanned. |
| `components/BotInviteEmbed.svelte:40` | Add a bot to your space | Add a bot to your Space |
| `components/BotInviteModal.svelte:54, 95, 114, 116` | the space · Select a space: · You're not in any spaces yet. · Adding a bot to a space takes Manage Bots in it. | the Space · Pick a Space · You're not in any Spaces yet. · Adding a bot to a Space takes Manage Bots in it. |
| `components/ServerSettings.svelte:256, 933, 2730` | Failed to delete the space · Delete all attachments in this space? … · No attachments in this space | Couldn't delete the Space · … this Space … · No attachments in this Space |
| `components/UserSettings.svelte:926, 1549, 1654` | … removed from all spaces. · … top of the spaces column … · … the people in your spaces see … | Spaces (each) |
| `lib/permissions.ts:52-86` (six descriptions) | … in this space. · … the space's invites … | this Space · the Space's … |
| `lib/now.ts:86` | `Open ${room} in ${space}, …` | identifiers only; fine |
| `src/mainview/src/app.html:8, 10` | A cozy place to talk: spaces with text and voice rooms, direct messages and groups. | A cozy place to talk: Spaces with text and voice rooms, direct messages and groups. (The Discord card already writes "Spaces", `routes/link-preview.json/+server.ts`) |

---

## 4. Strings the new layout needs

By surface. **Ship** is the string as it should be written; **Today** is the app's string it replaces or keeps, with its file; the last column gives the prototype's wording where this differs, and why. Strings of the prototype marked *proposal* belong to features the app doesn't have: they don't ship (rule 4), and are listed so nobody ports them by accident.

### 4.1 The sidebar

| Ship | Where | Today | Prototype / why |
|---|---|---|---|
| Chats | section heading (under All) | change: "Direct messages" (`components/DMSidebar.svelte:159`, `components/SpaceNav.svelte:545`) | same |
| Spaces | section heading (under All) | new; today only the list's `aria-label` "Spaces and chats" (`components/SpaceNav.svelte:424`) | same |
| Join or create a Space | the **+** beside Spaces: tooltip and `aria-label` | keep: a row today (`components/SpaceNav.svelte:623`) | same |
| Friends | the Friends row at the top of Chats | keep: the Friends page's heading (`components/FriendsView.svelte:401`) | same |
| 1 friend request / {n} friend requests | the row's count: tooltip and `aria-label` | new | "{n} friend requests", no singular |
| 1 more chat / {n} more chats | the fold at the end of Chats, under All | new; like "{n} more rooms" (`components/NowSection.svelte:478`) | "{n} more chats", no singular |
| Show fewer | the same row, open | new; like "Show the busiest only" (`components/NowSection.svelte:478`) | same |
| 1 quiet Space / {n} quiet Spaces | the fold of quiet Spaces | keep (`components/SpaceNav.svelte:600`) | same |
| Fold quiet Spaces | its `aria-label` when open | keep (`components/SpaceNav.svelte:600`) | none |
| Search or jump to… | the search field; its keys ⌘K / Ctrl K beside it ([§6](#6-shortcut-labels)) | keep (`components/SpaceNav.svelte:434`) | same |
| New chat | header button: tooltip and `aria-label` | new; it opens the app's new-group dialog, whose title is "New conversation" or "Create a group" (`components/FriendsView.svelte:701`) | same |
| Call history | header button: tooltip and `aria-label` | change: the list's `aria-label` "Calls" (`components/CallHistory.svelte:123`), a "Calls" tab in Friends today (`components/FriendsView.svelte:89`) | "Calls": changed to say what it opens (`BRIEF.md`: "Call history (a popover)") |
| Hide sidebar / Show sidebar | the sidebar toggle: tooltip and `aria-label` | change: "Hide rooms" / "Show rooms" (`components/PaneView.svelte:1265`) | same |
| Resize the sidebar | the resize edge (`role="separator"`): `aria-label` | new; like "Resize split" (`components/PaneView.svelte:1149`) | none |
| Space menu | a Space row's **…**: tooltip and `aria-label` | keep (`components/ChannelsSidebar.svelte:407`) | same |
| Fold {Space} / Unfold {Space} | a Space row's caret: `aria-label` (with `aria-expanded`) | new | "Fold" / "Unfold": the name added so a screen reader knows which |
| {name} options | a Space row's `aria-label` | keep (`components/SpaceNav.svelte:315`) | none |
| {n} in voice | a voice room's people count | keep (`components/ChannelsSidebar.svelte:599`) | a "Live now" dot: not used, the count says it |
| 1 mention / {n} mentions | a mention count's `aria-label` | change: "{n} mentions" always (`components/DMSidebar.svelte:116`, `components/ChannelsSidebar.svelte:596`) | the plural agrees |
| Unread | a chat's unread mark: `aria-label` | keep (`components/DMSidebar.svelte:119`) | none |
| In a call | a chat row's second line while you're in its call | new; "In Call" in the voice bar today | same |
| {name} is typing… · {a} and {b} are typing… · Several people are typing… | a chat row's second line | keep (`lib/typing.ts:50-52, 67`) | "{first name} is typing" |
| You: {text} · {first name}: {text} · Voice note · Photo · Sent a sticker · Missed call · Call · {duration} | a chat row's preview of its last message | **proposal**: the chats list shows no previews today (`components/DMSidebar.svelte`) | prototype only |
| Group · Direct message | a chat row's kind, for screen readers | keep (`components/SpaceNav.svelte:227`, `components/DMSidebar.svelte:34-41`) | none |

The Space and room menus keep the app's items in sentence case:

| Ship | Where | Today | Prototype / why |
|---|---|---|---|
| Pin to top / Unpin | Space menu | keep (`components/SpaceNav.svelte:192`) | none |
| Mark all as read | Space menu | keep (`components/SpaceNav.svelte:210`) | "Mark as read" |
| Notifications › All messages · Only mentions · Nothing | Space, room and chat menus | keep (`components/NotificationSubmenu.svelte:29, 57`) | "Every message"; "Mute for 1 hour", "Mute until tomorrow": proposal |
| Invite people | Space and room menus | change: "Invite People" (`components/ChannelsSidebar.svelte:623`) | same |
| Members | Space menu (opens the members popover) | new entry | same |
| Space settings | Space menu; ⇧⌘, if adopted ([§6](#6-shortcut-labels)) | keep (`components/SpaceNav.svelte:197`), "Space Settings" (`components/ChannelsSidebar.svelte:420`) | "Space settings…" |
| Emojis and stickers | Space menu (opens Space settings there) | new entry | same |
| Create room | Space menu | keep (`components/SpaceNav.svelte:205`), "Create Room" (`components/ChannelsSidebar.svelte:429`) | same |
| Leave Space | Space menu (danger) | change: "Leave space" (`components/SpaceNav.svelte:337`) | same |
| Open in new tab | chat, room and Friends menus; hint ⌘-click / Ctrl-click | new | same |
| Open beside | chat and room menus; hint ⌥-click / Alt-click | new | "Open in split view": one name for one action, as the drop zone and the palette say "Open beside" |
| Copy room ID | room menu | change: "Copy Room ID" (`components/ChannelsSidebar.svelte:494`) | none |
| Room settings | room menu | change: "Settings" (`components/ChannelsSidebar.svelte:643`) | "Room settings…" |
| Delete room | room menu (danger) | change: "Delete Room" (`components/ChannelsSidebar.svelte:652`) | none |
| Edit category · Delete category | category menu | change: "Edit Category", "Delete Category" (`components/ChannelsSidebar.svelte:504-514`) | none |
| Mark as read · Copy link · Start a call · Close chat | chat and room menus | **proposal**: no such item per chat or room today | prototype only |

### 4.2 The media controls

Outside a call they are one row above the profile; in a call they grow into the call panel (`BRIEF.md`, "Media controls"). Every control the voice bar has today stays.

| Ship | Where | Today | Prototype / why |
|---|---|---|---|
| Mute / Unmute | the microphone button: tooltip and `aria-label`; keys if adopted | change: "Toggle Mute" (`components/UserStatusBar.svelte:264`); "Mute" / "Unmute" (`components/VoiceChannelView.svelte:668`) | same |
| You can't speak in this room | the microphone button, disabled | keep (`components/VoiceChannelView.svelte:668`) | none |
| Choose a microphone | the picker's trigger beside the microphone: tooltip and `aria-label` (right-click on the microphone keeps opening it too) | new; today only a right-click menu | not drawn |
| Microphone | the picker's heading | change: "Input Device" (`components/UserStatusBar.svelte:351`) | not drawn |
| Microphone {n} | a microphone without a name | keep (`components/UserStatusBar.svelte:363`) | not drawn |
| No microphones found | the picker, empty | keep (`components/UserStatusBar.svelte:355`) | not drawn |
| Deafen / Undeafen | the headphones button: tooltip and `aria-label` | change: "Deafen" only (`components/UserStatusBar.svelte:277`); both in `components/VoiceChannelView.svelte:682` | same |
| Noise suppression | the button's `aria-label`, with `aria-pressed` | change: "Toggle Noise Suppression" (`components/UserStatusBar.svelte:286`) | not drawn |
| Noise suppression on / Noise suppression off | its tooltip | keep (`components/UserStatusBar.svelte:287`) | not drawn |
| Voice connected · Connecting… · Reconnecting… · Couldn't connect · Disconnected | the call panel's first line, in a voice room | change: "Voice Connected", "Connecting...", "Reconnecting...", "Connection Failed", "Disconnected" (`components/UserStatusBar.svelte:92-97`) | "Voice connected" |
| In a call · Calling… | the first line, in a DM or group call | change: "In Call" (`components/UserStatusBar.svelte:203`); "Calling…" keep (`components/CallCard.svelte:133`) | same |
| {room} · {Space} | the second line, in a voice room | change: "{Space} / {room}" (`components/UserStatusBar.svelte:206`, `components/NowSection.svelte:592`) | same; the room first, as a mention notice names a place (`lib/mention-notices.ts:46`) |
| {chat name} | the second line, in a call | keep (`components/UserStatusBar.svelte:206`) | same |
| Ping: {n} ms · Measuring the ping… | the signal mark's tooltip; in a call the mark says "In a call" | change: "Ping: 24ms", "Measuring ping..." (`components/UserStatusBar.svelte:184`) | "Connection: excellent · 24 ms": the app grades nothing, it colours the mark (100 and 250 ms) |
| Turn on camera / Turn off camera | camera button | keep (`components/VoiceChannelView.svelte:555`) | same |
| Camera options | the camera's menu | keep (`components/VoiceChannelView.svelte:571`), with its items "No cameras found", "Incoming video", "Off, you receive no one's camera or screen" | not drawn |
| Share screen / Stop sharing | screen-share button | keep (`components/VoiceChannelView.svelte:625`, `components/StreamWindow.svelte:148`) | "Share your screen": the app's shorter label kept |
| Screen only · Screen and audio | the screen share's choices | change: "Screen + Audio" (`components/VoiceChannelView.svelte:644-654`) | not drawn |
| Disconnect | leave the voice room: tooltip and `aria-label` | keep (`components/UserStatusBar.svelte:208`) | same |
| Leave call | leave a DM or group call | keep (`components/NowSection.svelte:601`) | "Hang up" (mobile's too): [§8](#8-open-questions) |
| Pop out | the pop-out button: tooltip (desktop app only, never on the web) | new | not drawn |
| Pop out the voice controls | its `aria-label` | new | not drawn |

**The pop-out window** (desktop only; the call stays in the main window):

| Ship | Where | Prototype / why |
|---|---|---|
| Voice controls | the window's title (the OS shows it in Mission Control, the taskbar, Alt-Tab) | not drawn; [§8](#8-open-questions) |
| Keep on top / Stop keeping on top | the pin: tooltip and `aria-label`, swapping as the other toggles do | not drawn |
| Put back | the button that returns the controls to the sidebar (in the window, and in the slim row) | `BRIEF.md`'s word |
| Put the voice controls back in the sidebar | its `aria-label` | not drawn |
| Voice controls are in their own window | the slim row left in the sidebar | not drawn |
| Show the voice controls | the slim row's `aria-label`: a click brings the window to the front | not drawn |

Every other string in the window is the media controls' own, above.

### 4.3 The profile row and its menu

| Ship | Where | Today | Prototype / why |
|---|---|---|---|
| {name} | the row's first line | keep (`components/UserStatusBar.svelte:324`) | same |
| Online · Do not disturb | the row's second line | change: "Do Not Disturb" (`lib/status.ts:17`) | sentence case, as `lib/members.ts:69` and mobile write it |
| {name}, {status} | the row's `aria-label` (it opens the menu) | change: "Status: {status}" (`components/StatusMenu.svelte:36`) | none |
| {name} · @{username} | the menu's header | new | same |
| Online, "Sounds and calls as usual" | menu item and its hint | keep (`lib/status.ts:16`) | same, no hint |
| Do not disturb, "No sounds, and calls don't ring" | menu item and its hint | change: "Do Not Disturb" (`lib/status.ts:17`) | "No notices, no sounds": the app's hint says what it does (calls don't ring) |
| Edit profile | menu item (Settings at your profile) | new entry | "Edit profile…" |
| Settings | menu item; ⌘, / Ctrl , | change: the gear's "User Settings" (`components/UserStatusBar.svelte:294`) | "Settings…" |
| Sign out | menu item | change: "Log Out" (`components/UserSettings.svelte:1250`) | same; the app says "Sign in" (`routes/(auth)/sign-in`), mobile "Sign out" (`mobile/lib/account.dart:2091`) |
| Set a custom status · Switch account | menu items | **proposal**: no custom status, one account | prototype only |

### 4.4 The All · Chats · Spaces switch

| Ship | Where | Prototype / why |
|---|---|---|
| All · Chats · Spaces | the segments | same |
| Show in the sidebar | the group's `aria-label` | none |
| Chats and Spaces · Chats only · Spaces only | the segments' tooltips | same |
| {segment}, with unread messages | a segment's `aria-label` when its dot shows | the dot has no label in the prototype |

### 4.5 Tabs, panes and the palette

| Ship | Where | Today | Prototype / why |
|---|---|---|---|
| New tab | the **+** after the tabs: tooltip and `aria-label`; keys if adopted | new | same |
| Close tab | a tab's ✕: tooltip and `aria-label` | keep (`components/TabBar.svelte:229`) | same |
| {title} · {title} | a joined pair's tooltip | new | "{a}  \|  {b}" |
| {title} and {title}, side by side | a joined pair's `aria-label` | new | none |
| 1 mention / {n} mentions | a tab's count | change: "{n} mentions" (`components/TabBar.svelte:219`) | a dot |
| Close tab · Close other tabs · Close tabs to the left · Close tabs to the right · Close all tabs | a tab's menu | change: "Close", "Close Others", "Close to the Left", "Close to the Right", "Close All" (`components/TabBar.svelte:250-273`) | "Close tab", "Close other tabs" |
| Split with › {tab} · No other tabs | a tab's menu: join it with another tab | new | same |
| Split with a chat | a tab's menu and the pane's More menu; ⌘\ / Ctrl \ if adopted | new | "Split with a chat…" |
| Separate split view | a pair's menu | new | same |
| Pin tab · Unpin tab · Duplicate | a tab's menu | **proposal** | prototype only |
| Open room | the drop hint while dragging a tab | keep (`components/TabBar.svelte:302`) | none |
| Open here · Open beside | drop zones over a pane while dragging a chat or room | new; "Drag a room here" today (`components/PaneView.svelte:1524`) | same |
| Resize split | the gutter between the two panes | keep (`components/PaneView.svelte:1149`) | none |
| Close pane | a pane's ✕ in a pair, and in its More menu | keep (`components/PaneView.svelte:1346`) | "Close this side": [§8](#8-open-questions) |
| Where to? | an empty pane's title | change: "No chat open" (`components/PaneView.svelte:1220`); the palette's placeholder today (`components/QuickSwitcher.svelte:199`) | same |
| Pick a chat or a room in the sidebar, or press ⌘K | an empty pane's line (Ctrl K on Windows and Linux) | change: "Pick a room to open it here" (`components/SpaceNav.svelte:451`) | same |
| Where to? | the palette's placeholder | keep (`components/QuickSwitcher.svelte:199`) | "Search or jump to…" (the sidebar field keeps that one) |
| Open beside… · Open in a new tab… | the palette's placeholder when it opens beside, or in a new tab | new | same |
| Search Spaces, rooms and chats | the palette's `aria-label` | change ([§3](#3-space-and-room-wording)) | none |
| Space · Friend · Group · Direct message | a result's kind | keep (`components/QuickSwitcher.svelte:96-97, 255`) | group headings "Chats", "Rooms", "People", "Spaces" |
| ↑ ↓ to move · Enter to open · ⌘Enter for a new tab · ⌥Enter to open beside · Esc to close | the palette's footer (Ctrl / Alt elsewhere) | change: "to move · Enter to open · Esc to close" (`components/QuickSwitcher.svelte:272-273`) | "↵ open · ⌘↵ new tab · ⌥↵ beside · tab filter": the app writes Enter |
| Open · Open beside · New tab | the hint on the highlighted result | new | "Open ↵" |
| `Nothing matches “{query}”` · No Spaces or chats yet | the palette, empty | keep / change (`components/QuickSwitcher.svelte:266`) | "Nothing found" |
| All · Messages · People · Spaces; Call someone… | the palette's filters; its call mode | **proposal**: the palette searches no messages and starts no calls today | prototype only |

### 4.6 The pane header

| Ship | Where | Today | Prototype / why |
|---|---|---|---|
| {name} | a DM's title | keep | same |
| Online · Do not disturb · Offline | a DM's status line | new here | same; no custom status (proposal) |
| Playing {game} · Listening to {song} | the status line, after a ` · `, when they share it | new here, in the words of `components/NowSection.svelte:499` | none: the app's activities stand in for the prototype's custom status |
| 1 member · {n} members · {n} online | a group's status line | new | "{n} members · {n} online" |
| {Space} · {room description} | a room's status line | change: the description is a tooltip today (`components/PaneView.svelte:1214`) | same |
| {room} chat | the title of a voice room's chat, beside it | new | same |
| Friends · {n} online | the Friends tab's title and line | new | same |
| Start call | DM and group: tooltip and `aria-label` | keep (`components/ConversationView.svelte:1033`) | "Start a call" |
| Start a video call | DM and group | **proposal**: a call starts without the camera today | prototype only |
| Open the room's chat beside | a voice room: tooltip and `aria-label` | new | same |
| Pinned messages | tooltip and `aria-label` | keep (`components/PinnedMessages.svelte:147`) | same |
| Members | members button: tooltip | keep (`components/ConversationView.svelte:1051`, `components/MembersButton.svelte:61`) | same |
| Members, {n} | its `aria-label` | keep (`components/ConversationView.svelte:1052`) | none |
| Search | the search field's placeholder | change: "Search messages" (`components/MessageSearch.svelte:441`) | same: the field is narrow |
| Search messages | its `aria-label` | keep (`components/MessageSearch.svelte:442`) | none |
| Search this chat | its tooltip; ⌘F / Ctrl F if adopted | new | same |
| More | the **…** button: tooltip and `aria-label` | change: "Group options" (`components/ConversationView.svelte:1066`) | same |
| Notifications · Invite people · Split with a chat · Copy link · Room settings · Space settings · Add people · Rename group · Leave group | the More menu, as each applies | keep (`components/PaneView.svelte:1442`, `components/ConversationView.svelte:1002, 1077, 1082`) | "Mark as read", "Open in new window": proposal |

### 4.7 Messages

| Ship | Where | Today | Prototype / why |
|---|---|---|---|
| React with {emoji name} | a quick reaction on the hover bar: tooltip and `aria-label` | new | "React 😂" |
| Add reaction | hover bar and menu | keep (`components/MessageList.svelte:1274`) | same |
| Reply | hover bar and menu; key r | keep (`components/MessageList.svelte:1309`) | "R": [§6](#6-shortcut-labels) |
| Edit message | hover bar and menu, your own; key e | keep (`components/MessageList.svelte:1394`) | "Edit", "E" |
| More | hover bar: opens the message menu | new | same |
| More reactions | the menu's reaction row | new | same |
| View thread · Copy message link · Pin message / Unpin message · Delete message · Reactions | the message menu (today on the hover bar) | keep (`components/MessageList.svelte:1334-1379, 1687-1700`) | "Copy link", "Pin", "Delete" |
| Copy text · Mark unread | message menu | **proposal** | prototype only |
| Copy user ID · Kick {name} · Ban {name} · Edit flags and badges | an author's menu | change: "Copy User ID", "Edit Flags & Badges" (`components/MessageList.svelte:1786-1820`) | none |
| 1 new message / {n} new messages | the unread line | keep (`components/MessageList.svelte:1560`) | "New messages" |
| Newer messages below | the list's end after a jump | keep (`components/MessageList.svelte:948`) | none |
| Jump to the newest | the jump button: tooltip and `aria-label` | new (the keys say "Newest", `components/KeyboardLayer.svelte:69`) | "Jump to the latest": the app's own word |
| Jump to the newest, {n} new | its `aria-label` with a count | new | the count alone |
| Today · Yesterday · {weekday} · {weekday}, {month} {day} | day separators | keep (`components/MessageList.svelte:282, 719`) | same |
| (edited {when}) | after an edited message's text | keep (`components/MessageList.svelte:1201`) | "(edited)" |
| BOT | a bot's tag | keep (`components/AuthorTag.svelte:12`) | same |
| {name} pinned a message to this room. See all pinned messages | a pin's notice | keep (`components/MessageList.svelte:1003-1009`) | "pinned a message", "See all" |
| the call notices | a call's notice | keep (`lib/call-notices.ts:87-96`) | same sentences |
| Call | the button on a call's notice | new here; the history's "Call" (`components/CallHistory.svelte:157`) | "Call back" |
| Only you can see this · Dismiss message | a bot's ephemeral reply | keep (`components/MessageList.svelte:1237-1242`) | none |
| Message thread · From {name} · Reply in thread · No thread messages found. | the thread, now a popover | keep (`components/MessageList.svelte:1601-1632`, `components/Chat.svelte:958`) | title "Thread", "{n} replies" |
| {name} joined the Space. Say hi! · Wave | a join notice | **proposal** | prototype only |
| Messages · Bubbles · Default · Flat rows | Settings › Appearance, the new setting (`BRIEF.md`: "flat rows are a user setting") | new | same |
| Flat rows fit more on screen; bubbles are easier to follow. | the setting's note | new | "… You can change it any time." dropped: every setting can |

### 4.8 The composer

| Ship | Where | Today | Prototype / why |
|---|---|---|---|
| Message {chat name} · Message #{room} | placeholder | keep (`components/ConversationView.svelte:1154`, `components/Chat.svelte:821`) | "Message {first name}" |
| Message the {room} chat | placeholder in a voice room's chat | new | same |
| Add files and more | the **+**: tooltip and `aria-label` | new: "Attach files" today (`components/ChatInput.svelte:1393`) | "Add files, a sticker or a mention": [§8](#8-open-questions) |
| Attach files · Sticker · GIF | the **+** menu | "Attach files" keep; the sticker and GIF pickers have buttons of their own today (`components/ChatInput.svelte:1456, 1473`) | "Upload a file", "Photos and videos" (one picker on desktop) |
| Mention someone · Use a command | the **+** menu | **proposal**: typing @ or / does it today | prototype only |
| Emoji, GIFs and stickers | the emoji button: tooltip and `aria-label`; ⌘E / Ctrl E if adopted | change: three buttons "Open emoji picker", "Open sticker picker", "Open GIF picker" (`components/ChatInput.svelte:1439-1474`) | same |
| Emoji · GIFs · Stickers | the picker's tabs | new | same |
| Search emoji · Search KLIPY · Search stickers | the picker's search | change: "Search emoji..." (`components/EmojiPicker.svelte:70`), "Search stickers..." (`components/StickerPicker.svelte:42`); "Search KLIPY" keep (`components/GifPicker.svelte:91`) | "Search GIFs": the app names KLIPY |
| GIFs from KLIPY | the GIF tab's footer | keep (`components/GifPicker.svelte:143`) | **not** the prototype's proxy claim ([§2](#2-encryption-claims)) |
| Send | the send button | new label | same |
| Save | the send button while editing | new | same |
| Record voice note | the send button when empty | keep (`components/ChatInput.svelte:1427`) | "Record a voice note" |
| Recording a voice note | the recording bar's line | new | same |
| Pause recording / Resume recording · Cancel recording · Send voice note | recording controls | keep (`components/ChatInput.svelte:1348-1379`) | "Discard" |
| Replying to {name} · Replying to yourself | the reply strip | keep / new (`components/Chat.svelte:856`) | same |
| Cancel reply | its ✕; key Esc | keep (`components/Chat.svelte:879`) | same |
| Mention {name} | the reply's mention toggle | keep (`components/Chat.svelte:870-871`) | none |
| Editing your message | the edit strip | new | same |
| Esc to cancel · Enter to save | the edit strip's hint | change: "escape to cancel • enter to save" (`components/MessageList.svelte:1142-1147`) | same |
| Cancel edit | the strip's ✕ | new | same |
| Members matching · Rooms matching · Commands matching · Emoji matching | suggestion headings | keep (`components/ChatInput.svelte:1158-1293`) | "Members matching @{q}" |
| Drop files to upload | drop target | keep (`components/Chat.svelte:749`) | none |

### 4.9 Notices, toasts, calls and call history

| Ship | Where | Today | Prototype / why |
|---|---|---|---|
| {name} in {place} | a mention or message notice's first line | keep (`lib/mention-notices.ts:20-60`) | same |
| Click to see message | a notice with nothing to show | keep (`components/MentionNotices.svelte:52`, `lib/system-notifications.ts:24`) | none |
| Dismiss | a notice's ✕, a toast's ✕ | keep (`components/MentionNotices.svelte:59`, `components/Toast.svelte:36`) | same |
| Notifications | the notices' region | keep (`components/MentionNotices.svelte:27`) | none |
| Incoming call · Incoming call from {name} | the incoming-call notice | keep (`components/CallCard.svelte:125, 171`) | same |
| Accept · Accept call | its green button: tooltip, `aria-label` | keep (`components/CallCard.svelte:142-143`) | same |
| Decline · Decline call | its red button | keep (`components/CallCard.svelte:151-152`) | same |
| Calling… · Cancel · Cancel call | your call, ringing | keep (`components/CallCard.svelte:133, 161-162`) | none |
| Open the chat | the notice's body | change: "Open the conversation" (`components/CallCard.svelte:107`) | none |
| Calling from another device | a call you started elsewhere | keep (`components/ConversationView.svelte:1120`) | none |
| Call history | the popover's title | new | "Calls" |
| Calls | its list's `aria-label` | keep (`components/CallHistory.svelte:123`) | none |
| Call · Join the call; Call {name} · Join the call in {name} | a row's button: tooltip; `aria-label` | keep (`components/CallHistory.svelte:156-157`) | "Call back" |
| No calls yet · Calls in your direct messages and groups show here. | empty | keep (`components/CallHistory.svelte:121`) | "No missed calls" |
| Couldn't load your calls · Your calls show here once they load. · Couldn't load more calls · Try again · Loading… | errors and loading | keep (`components/CallHistory.svelte:99-179`) | none |
| the call notice's sentence | a row's second line | keep (`components/CallHistory.svelte:146`, `lib/call-notices.ts`) | "Missed", "No answer", "Incoming · 23 min", "Outgoing": the app's sentences say it |
| All · Missed · Start a call | the popover's filter and footer | **proposal** | prototype only |

### 4.10 The Settings and Space settings windows

On the desktop they are windows of their own (Settings with ⌘, / Ctrl ,); on the web, sheets. Every section and control is kept.

| Ship | Where | Today | Prototype / why |
|---|---|---|---|
| Duvet settings | the Settings window's title (the OS shows it) | new: the settings dialog has no title today | "Duvet settings" on Windows and Linux; the title bar shows the section on macOS |
| {section} | the window's toolbar heading | keep: the section's name (`components/UserSettings.svelte:1260`) | same |
| My account · Security · Audio · Appearance · Activity privacy · Attachments · S3 buckets · Developer | the sections | change, to sentence case (`components/UserSettings.svelte:119-128`) | the prototype's Profile, Account, Privacy, Notifications, Sounds, Voice and video, Keyboard, My files: [§8](#8-open-questions) |
| Duvet account | under your name at the top of the window's sidebar | new | same |
| Search | the sections' search field | new | same |
| Theme · System · Light · Dark | Appearance | keep (`components/UserSettings.svelte:1175-1177`) | same |
| Sign out | the foot of the window's sidebar | change: "Log Out" (`components/UserSettings.svelte:1250`), as in [§4.3](#43-the-profile-row-and-its-menu) | none |
| {Space} · Space settings | the Space settings window's title | new | same |
| Space settings | under the Space's name in the window's sidebar | new | same |
| Overview · Roles · Members · Invites · Bans · Emojis · Stickers · Webhooks · Storage · Attachments | its sections | keep (`components/ServerSettings.svelte:1167-1279`) | "Rooms", "Emojis and stickers": [§8](#8-open-questions) |
| People · Apps and data | headings over Members, Invites, Bans; and Webhooks, Storage, Attachments | new | same |
| #{room} · Room settings | the room settings' title | new | none |
| Overview · Permissions · Webhooks | its sections | keep (`components/ChannelSettings.svelte`) | none |
| Room type · Text room · Voice room · Category · Room name · None | Create room | change: "Room Type", "Text Room", "Voice Room", "Room Name" (`components/ChannelsSidebar.svelte:726-755`) | "Create a room", cards "Text room", "Voice room", "Announcements" (no announcements kind today: proposal) |

### 4.11 Friends, members, pins, search, profiles

| Ship | Where | Today | Prototype / why |
|---|---|---|---|
| All · Pending · Sent | the Friends page's switch | keep (`components/FriendsView.svelte:86-88`) | "Online", "All", "Pending {n}", "Sent" |
| Online · Offline | its groups | keep (`components/FriendsView.svelte:118-119`) | "Online — 4" |
| Add friend · Add a friend · Send a request with their user ID. · User ID · Send request · Sending… | adding a friend | keep (`components/FriendsView.svelte:439-662`) | "Add a friend by username or Duvet ID": the app takes a user ID |
| Wants to be friends | a request | keep (`components/NowSection.svelte:370`) | "Wants to be friends · @{handle}" |
| Message · Remove friend · Accept · Decline | a friend's or a request's buttons | keep (`components/FriendsView.svelte:529-594`) | "Block": proposal |
| Members · {n} online | the members popover's title and line | keep (`components/MembersButton.svelte:61-62`) | "{n} online · {total}" |
| Search members | its search | new | same |
| Invite people | its foot | keep wording | same |
| Pinned messages · Jump · Unpin message | the pins popover | keep (`components/PinnedMessages.svelte:164-198`) | "Pinned" |
| This room has no pinned messages yet · This chat has no pinned messages yet | pins, empty | change: "conversation" → "chat" (`components/PinnedMessages.svelte:170`) | "Nothing pinned yet" |
| the search's strings | the search popover | keep (`components/MessageSearch.svelte:80-88, 441-537`) | "Recent" searches: proposal |
| the profile card's strings | the profile popover | keep (`components/MemberProfilePopover.svelte`, `components/MemberProfileCard.svelte`) | "Mention", "Copy username", "Block": only those the card has |

---

## 5. Strings that go away or change

Because their surface changes. Each is in [§4](#4-strings-the-new-layout-needs) with its replacement; this is the list a reviewer greps for once the port is done.

| String | Where | Why |
|---|---|---|
| Collapse rooms panel · Expand rooms panel · Hide rooms · Show rooms | `components/PaneView.svelte:1264-1265` | the rooms panel beside each pane goes: the Space tree is in the sidebar |
| Collapse members panel · Expand members panel · Hide members · Show members | `components/PaneView.svelte:1281-1282` | nothing is docked on the right: members are a popover |
| Close column · Pin as column | `components/MembersButton.svelte:72-75` | the same |
| Split horizontally · Split vertically | `components/PaneView.svelte:1300-1323` | the redesign splits by joining tabs and opening beside. **Whether vertical and deeper splits stay is a parity question** (`PARITY.md`); if they stay, these strings stay |
| No chat open · Drag a room here | `components/PaneView.svelte:1220, 1524` | the empty pane and the drop zones |
| Pick a room to open it here | `components/SpaceNav.svelte:451` | the empty pane |
| Direct messages | `components/DMSidebar.svelte:159`, `components/SpaceNav.svelte:545` | the Chats section |
| Conversations (`aria-label`) · New group · No conversations yet | `components/DMSidebar.svelte:138-165` | Chats, New chat, and "No chats yet" if the list is empty |
| Calls (the Friends page's tab) · Friends and calls | `components/FriendsView.svelte:89, 405` | call history moves to the sidebar's header |
| Voice Connected · Connecting... · Reconnecting... · Connection Failed · In Call · Ping: …ms · Measuring ping... | `components/UserStatusBar.svelte:92-97, 184, 203` | the call panel |
| Toggle Mute · Toggle Noise Suppression · User Settings · Input Device | `components/UserStatusBar.svelte:264, 286, 294, 351` | the media controls; the gear moves into the profile menu |
| Your call · Your voice · Leave voice | `components/NowSection.svelte:571-602` | the Now section's dock repeats the call panel. **Where the Now section lives in the redesign is a parity question**; its other strings stay as they are, in sentence case |
| Status: {status} | `components/StatusMenu.svelte:36` | the profile row's label |
| Do Not Disturb | `lib/status.ts:17` | Do not disturb |
| Open the conversation | `components/CallCard.svelte:107` | Open the chat |
| Group options | `components/ConversationView.svelte:1066` | More |
| Open emoji picker · Open sticker picker · Open GIF picker | `components/ChatInput.svelte:1439-1474` | one button and a picker with tabs |
| escape to cancel • enter to save | `components/MessageList.svelte:1142-1147` | the edit strip |
| Close · Close Others · Close to the Left · Close to the Right · Close All | `components/TabBar.svelte:250-273` | sentence case, "tab" named |
| Log Out | `components/UserSettings.svelte:1250` | Sign out |
| the Title Case labels of §1 | settings, room menus | sentence case as each surface is redrawn |
| the lowercase "space"s of §3 | various | Space |

---

## 6. Shortcut labels

### How to write them (as the app does today)

- **macOS:** the symbols ⌃ ⌥ ⇧ ⌘, then the key, with nothing between: **⌘K**, **⌥⇧↓**. Modifiers in Apple's order, ⌃ ⌥ ⇧ ⌘: **⇧⌘M**, not the prototype's ⌘⇧M (`components/KeyboardLayer.svelte:47-49` puts ⌥ before ⇧).
- **Windows and Linux:** the words **Ctrl**, **Alt**, **Shift**, then the key. In one label, separated by spaces: **Ctrl K** (`components/SpaceNav.svelte:58`, `routes/app/+page.svelte:397`). In the shortcuts sheet, one keycap per key (`components/KeyboardLayer.svelte:47-49`, the `keycaps` snippet at `:255`). The prototype's "Ctrl+K" is [§8](#8-open-questions).
- **Single keys:** lowercase for a plain key, a capital only when Shift is part of it. The sheet tells **j**/**k** (messages) from **J**/**K** (chats), and **G** is newest (`components/KeyboardLayer.svelte:57-71`). So the message menu shows **r** and **e**, not the prototype's R and E.
- **Named keys:** Esc, Enter, Tab, ↑ ↓ ← →, as the app writes them ("Enter to open", `components/QuickSwitcher.svelte:272`). Not ↵.
- **Mouse:** ⌘-click / Ctrl-click, ⌥-click / Alt-click, Middle-click.
- **Screen readers:** `aria-keyshortcuts` in ARIA's syntax, **Meta+K** / **Control+K** (`components/SpaceNav.svelte:431`).
- **On the web**, don't show a shortcut the browser keeps: ⌘T, ⌘W, ⌘N (Ctrl T, W, N). The button stays and its tooltip shows no keys.

### Each shortcut

*Today* exists in the app; *brief* is named by `BRIEF.md`; *prototype* is only in the prototype, and its keys are the lead's call (rule 4) before anyone labels them.

| Action | macOS | Windows and Linux | Status | Notes |
|---|---|---|---|---|
| Search or jump to (the palette) | ⌘K | Ctrl K | today, brief | `keyboard.ts`, `routes/app/+page.svelte:394-406` |
| Open chat 1 to 8, or the last | ⌘1–⌘9 | Ctrl 1–Ctrl 9 | today | with tabs in the title bar: tab 1 to 8, the last |
| Chat after / before | ⌥↓ / ⌥↑ | Alt ↓ / Alt ↑ | today | |
| Next unread chat | ⌥⇧↓ | Alt Shift ↓ | today | |
| Keyboard shortcuts | ⌘/ | Ctrl / | today | the prototype has a Keyboard settings list instead: both can be |
| Reply to the newest / edit your newest (in a chat) | ⌃↑ / ⌃⇧↑ | Ctrl ↑ / Ctrl Shift ↑ | today | `components/Chat.svelte:311-347` reads Ctrl on every platform, so macOS writes ⌃, not ⌘. macOS also gives ⌃↑ to Mission Control |
| Edit your last message (empty box) | ↑ | ↑ | today | `components/ChatInput.svelte:873` |
| Cancel a reply or an edit | Esc | Esc | today | |
| Send / new line | Enter / ⇧Enter | Enter / Shift Enter | today | |
| Close the focused pane's tab | ⌃W | Ctrl W | today | `components/PaneView.svelte:928-934` reads Ctrl on every platform. The prototype's ⌘W (close tab) would change it: lead's call |
| Keyboard navigation's keys | j k J K G u f r e i, Esc | the same | today | single keys, once keyboard navigation is on |
| Settings | ⌘, | Ctrl , | brief | Chrome on macOS keeps ⌘, for its own settings: not verified whether the web build gets it |
| Open in a new tab | ⌘-click, Middle-click | Ctrl-click, Middle-click | brief | |
| Open beside | ⌥-click | Alt-click | prototype | many Linux window managers take Alt-click (and Alt-drag) to move a window |
| Show or hide the sidebar | ⌃⌘S | Ctrl Shift S | prototype | the prototype's own list renders ⌃⌘S as "Ctrl+Ctrl+S" on Windows: a bug, not a spelling |
| New tab | ⌘T | Ctrl T | prototype | the browser's on the web |
| Close tab | ⌘W | Ctrl W | prototype | the browser's on the web; see ⌃W above |
| Next tab / previous tab | ⌃Tab / ⌃⇧Tab | Ctrl Tab / Ctrl Shift Tab | prototype | the browser's on the web |
| New chat | ⌘N | Ctrl N | prototype | the browser's on the web |
| Split with a chat | ⌘\ | Ctrl \ | prototype | |
| Search this chat | ⌘F | Ctrl F | prototype | replaces the browser's find on the web |
| Emoji, GIFs and stickers | ⌘E | Ctrl E | prototype | |
| Mute / unmute | ⇧⌘M | Ctrl Shift M | prototype | Chrome on macOS keeps ⇧⌘M (switch profile) |
| Deafen / undeafen | ⇧⌘D | Ctrl Shift D | prototype | |
| Space settings | ⇧⌘, | Ctrl Shift , | prototype | |
| Attach files | ⌘U | Ctrl U | prototype | |
| Palette: open in a new tab / beside | ⌘Enter / ⌥Enter | Ctrl Enter / Alt Enter | prototype | |
| Palette: switch filter | Tab | Tab | prototype | the filters are a proposal |
| Copy text · Delete message | ⌘C · ⌫ | Ctrl C · Delete | prototype | the menu items are proposals; the app has no key to delete a message |

---

## 7. The forbidden list

[`forbidden-strings.txt`](forbidden-strings.txt) lists, one per line, what of the prototype's sample world must never reach the app: its invented people (full names, surnames, first names, handles), Spaces, groups, rooms, room topics, roles, bios and statuses, distinctive lines of its sample messages, its embeds (the invented site, songs, albums, builds, changelog), the sample devices, storage, bans, webhooks and invites of its settings, the prototype's scaffolding (Tweaks, its labels, its toasts that pretend, the wallpaper classes, the fixed clock, its storage key), and its sample images (`assets/img/`, `picsum`, and each image's name as `av-25.`, which matches `av-25.jpg` and a hashed `av-25.Bx9q.jpg` alike). 375 entries.

Run it on the source and on the build, as fixed strings, case-sensitive:

```bash
grep -rnF -f docs/redesign/forbidden-strings.txt src electrobun.config.ts \
  --exclude-dir=node_modules --exclude-dir=.svelte-kit --exclude-dir=build
(cd src/mainview && bun run build) && \
  grep -rnoF -f docs/redesign/forbidden-strings.txt src/mainview/build --include='*.js' --include='*.html' --include='*.css' --include='*.json'
```

At `c6e514a` both find nothing; on the prototype (`js/`, `styles.css`) the list finds 330 matches. The file has no comments and no blank lines, on purpose: with `-f`, a blank line matches everything and a comment would be a pattern.

**Left out, because they'd match real code or real copy** (tested on the source and the build at `c6e514a`):

- First names that are parts of real words: **Wren** (Lucide's `Wrench`), **Kit** (`SvelteKit`), **Sol** (`Solarized`, in the build), **Ren** (`Render`, `Rename`), the handle **@ren** (Svelte's `{@render}`), and lowercase **wren**, **mara**, **ines**, **sol** (inside other words). The full names and surnames are on the list.
- **Night Owl**: a real code theme (Shiki's, in the build), as the prototype's own code-theme list says.
- Room and category names that are ordinary words, or that a real Space would have: general, welcome, requests, builds, standup, feedback, changelog, announcements, clips, art, starters, routes, finds, scans, News, Community, Talk, Making, Studio, Playtest. (Off the list for the same reason: the role names Host, Producer, Regular, Studio, everyone.)
- The GIF topics and sticker labels: Trending, Reactions, Cats, Dogs, Cozy, Night, Applause, Sleepy, on air, brb, zzz, rain, gg, 10/10. KLIPY's own categories may use some of them.
- The bot buttons' labels: Remind me, Add to calendar, Download, View logs.
- The mascot and logo files (`assets/mascot/…`, `assets/logo/…`): they're mobile's real assets (`BRIEF.md`, "Visual language").
- Times and numbers of the sample (12:41 PM, 9:00, 23 minutes): a real chat shows such things.

---

## 8. Open questions

Each with the options; the choice in **bold** is what this document assumes.

1. **Leaving a call:** **"Leave call"** (the desktop today, `components/NowSection.svelte:601`; leaving a group call doesn't end it for the others) or "Hang up" (the prototype, mobile). In a voice room: "Disconnect", as the brief and the app say.
2. **The pop-out window's title:** **"Voice controls"**, "Duvet voice controls" (clearer in Alt-Tab and the taskbar beside other apps' windows), or "Media controls" (`BRIEF.md`'s heading; nobody else says "media").
3. **The slim row:** **"Voice controls are in their own window" with "Put back"**, or the shorter "In their own window" next to a microphone icon. The sidebar is 232 to 380 px wide.
4. **Windows and Linux shortcuts:** **"Ctrl K"** (the app today), or "Ctrl+K" (the prototype; Microsoft's and GNOME's own style).
5. **The + button's tooltip:** **"Add files and more"**, "Attach files" (today's word, if + holds only files), or "Add files, GIFs and stickers".
6. **Closing one side of a pair:** **"Close pane"** (today), or "Close this side" (the prototype: plainer, but wrong if vertical or deeper splits stay).
7. **Settings' section names:** **the app's sections, in sentence case**, or the prototype's names where a section maps: My account → Account, Audio → Voice and video, Attachments and S3 buckets → My files. Privacy, Notifications, Keyboard and Sounds as separate sections hold controls the app doesn't have (proposals).
8. **Space settings:** **the app's sections**, or the prototype's "Rooms" section (room management, which is in the sidebar and room settings today) and "Emojis and stickers" as one section.
9. **The API's error texts that say "channel" and "server"** ([§3](#3-space-and-room-wording)): **leave them**, or show the app's fallback for those known texts.
10. **The two allowed "server" strings** ([§3](#3-space-and-room-wording)): **leave them**, or "Duvet didn't answer in time" and "Duvet didn't send back a valid sign-in".
11. **"secure" in "Verify your email to secure your account."** ([§2](#2-encryption-claims)): **leave it** (it's about the account), or "Verify your email, so you can always get back into your account."
12. **Ellipses on menu items that open a window:** **none**, as the app writes ("Space settings"), or the macOS habit the prototype follows ("Settings…").
13. **Jump to the newest:** **"Jump to the newest"** (the app's word in the keys, "Newest") or "Jump to the latest" (the prototype; the brief and the issue say "jump to latest").
