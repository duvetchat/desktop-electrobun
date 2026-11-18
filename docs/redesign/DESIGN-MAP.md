# The desktop redesign: the design map

Tracking issue: #357. This is the reference the workers porting the redesign build from, and the reviewers check against. It describes the approved prototype (`desktop-prototype/`, signed off 2026-11-18) in words and numbers, so that nobody has to read or port its JavaScript.

**Where it comes from.**
- The prototype: `BRIEF.md`, `README.md`, `index.html`, `styles.css` and every file in `js/`. Each class name and value below was read from them, and each state was reached in Chromium.
- Mobile's `lib/theme.dart` (the design system's source) and `REPORT.md` §3.
- The app as it is on `dev` (`c6e514a`): `src/mainview/src/app.css`, `app.html`, `lib/theme.ts`, `lib/theme.svelte.ts`, `lib/fonts/`, `lib/components/`, `routes/`, `src/bun/`.
- What the app can do today comes from its code. `docs/redesign/PARITY.md` is the contract; where this map and the ledger disagree, the ledger wins.

**How to read it.**
- Sizes are CSS pixels. Colours are as written in `styles.css`.
- "ink" is `--ink`, "ink-2" is `--ink-2`, and so on (§1.1).
- A `.class` is the prototype's class name. It is a name to recognise, not one to copy: the port uses Tailwind (`tailwind-only.test.ts`).
- "⌘" means Ctrl on Windows, Linux and (in the prototype) the web (§5).

**The sections.**
- §1 the tokens and every other constant.
- §2 fonts and assets.
- §3 icons.
- §4 every surface and its states, `S-01` to `S-70`.
- §5 each platform's window.
- §6 what the prototype doesn't draw, and the mobile screen to follow instead.
- §7 scaffolding to drop, and what the prototype shows that the app can't do (proposals, left out).
- §8 behaviour to port carefully.
- §9 every contradiction found.
- §10 the reference screenshots.

**The sample world.** The prototype is filled with invented people, Spaces and messages: a radio show "Night Shift Radio", a group "Sunday Soup Club", "you" are Wren. Steps to reach a state name them, because that's how to click there. None of them ships (§7.1; `docs/redesign/COPY.md` on `redesign/desktop` lists the strings).

**The words the UI may not say.** Rule 2 of the team brief applies to every surface below: no claims about how messages are protected, and no lock badge used as such a claim. The prototype makes none. Its one false claim is about GIFs (S-27), and it is not to be ported.

---

## 1. Tokens

### 1.1 Colour tokens

Every custom property in `styles.css`. The light and dark values sit on `.theme-light` and `.theme-dark`, and `.stage` holds the ones that are the same in both. Alphas are written as `styles.css` has them; theme.dart's ARGB alphas convert to the same values, rounded to three places (`0x14` = .078, `0x0F` = .059, `0x0A` = .039, `0x1F` = .122, `0x24` = .141, `0x4D` = .3, `0x59` = .35, `0x66` = .4, `0x73` = .45, `0x8C` = .55, `0xC7` = .78, `0xCC` = .8).

The **App** column gives the app's current `--duvet-*` token (in `app.css`) that the variable replaces, or "new".
- The app's values change. Today it has a softer palette: `--duvet-bg` is `#14151d` in dark and `#f3f4f9` in light, and `--duvet-accent` is `#7b83f5` in dark and `#5a62de` in light.
- The app's names may stay. Where the meaning shifts, the note says so.

**Base colours**

| Variable | Light | Dark | What for | theme.dart | App |
|---|---|---|---|---|---|
| `--base` | `#F5F7FF` | `#07070A` | Window, panes, the message list's background | `background` | `--duvet-bg` |
| `--ink` | `#15172B` | `#F1F1F6` | Text and icons | `foreground` | `--duvet-ink` |
| `--ink-2` | `#5E6380` | `#9396A8` | Secondary text, idle icons, timestamps | `mutedForeground` | `--duvet-ink2` |
| `--sunken` | `#EAEFFF` | `#000000` | Behind media tiles before they load; the no-banner profile gradient | `secondary`/`muted` ("base-sunken") | `--duvet-sunk` |
| `--card` | `#FFFFFF` | `#111116` | Their bubbles, cards, the active tab, fields, settings cards | `card` ("base-raised") | `--duvet-card` |
| `--hairline` | `rgba(21, 23, 43, .078)` | `rgba(255, 255, 255, .07)` | 1 px lines and rings | `DuvetTokens.hairline` (`0x1415172B` / `0x12FFFFFF`) | `--duvet-line` |
| `--destructive` | `#B0443B` | `#E07A70` | Danger items, muted icons, missed calls | `destructive` | `--duvet-danger` |
| `--destructive-rgb` | `176, 68, 59` | `224, 122, 112` | The same, for `rgba(var(--destructive-rgb), α)` | (derived) | new |

**Accent, azure and the small accents**

| Variable | Light | Dark | What for | theme.dart | App |
|---|---|---|---|---|---|
| `--accent` | `#2F4CFF` | same | Cobalt: primary buttons, Send, unread chips and dots, the BOT tag, focus outlines | `Duvet.accent` | `--duvet-accent` |
| (white on accent) | `#fff` (written inline) | same | Text and icons on cobalt | `primaryForeground` `#FFFFFF` | `--duvet-on-accent` (dark today is `#14151d`: becomes white) |
| `--azure` | `#0B6FE8` | same | Your bubbles by default | `Duvet.azure` | new |
| `--accent-text` | `#2F4CFF` | `#8C9BFF` | The accent as text or an outline, lifted in dark | `accentText` | `--duvet-accent-text` |
| `--accent-tint` | `rgba(47, 76, 255, .10)` | `rgba(140, 155, 255, .141)` | Active rows and tabs' pill, hovered menu items, focus rings (3–4 px), drop zones | `accentTint` | `--duvet-accent-tint` |
| `--azure-tint` | `rgba(28, 140, 255, .122)` | `rgba(92, 178, 255, .141)` | The All · Chats · Spaces switch's pill | `azureTint` | new |
| `--violet` | `#6A58D6` | `#B3A6FF` | Small accents: mention chips, your reactions, typing snippet, picked pills, YAML values | `violetText` | `--duvet-chosen-ink` (closest; today that's light text on a dark chip, so the meaning changes) |
| `--selected-fill` | `#F0EDFF` | `#231E3D` | Under `--violet`: your reaction, mention chip, picked pill, To chips | `selectedFill` | `--duvet-chosen` (today `#22243a`/`#3a3d52`, a dark chip) |
| `--secondary-fill` | `#E3E9FF` | `#1C1E2E` | Secondary buttons, icon tiles, reaction chips, the call panel's buttons | `secondaryFill` | new |
| `--live` | `#2F9E62` | `#4CC38A` | What is live: online, a call, speaking, "Voice connected" | `live` | `--duvet-alive` (today a cyan, `#2a86ab`/`#a8dff0`) |
| `--live-rgb` | `47, 158, 98` | `76, 195, 138` | The same, for alphas (live dot halo, speaking glow) | (derived) | new |
| `--crown` | `#B7791F` | `#FBBF24` | A Space owner's crown | `crown` | new |

**Glass**

| Variable | Light | Dark | What for | theme.dart | App |
|---|---|---|---|---|---|
| `--glass` | `rgba(245, 247, 255, .78)` | `rgba(17, 17, 22, .8)` | Popovers, menus, the hover bar, notices, the composer bar | `glass` | new |
| `--glass-strong` | `rgba(246, 248, 255, .9)` | `rgba(17, 17, 22, .92)` | ⌘K, sheets, the pane header once scrolled | none (prototype only) | new |
| `--glass-edge` | `rgba(21, 23, 43, .059)` | `rgba(255, 255, 255, .078)` | The 1 px inset edge on glass | `glassEdge` | new |

**Shadows**

| Variable | Light | Dark | What for | theme.dart | App |
|---|---|---|---|---|---|
| `--shadow-rest` | `0 1px 2px rgba(21, 23, 43, .039), 0 4px 12px rgba(47, 76, 255, .059)` | `0 1px 2px rgba(0, 0, 0, .3), 0 4px 12px rgba(0, 0, 0, .25)` | Their bubbles, cards, the active tab, settings cards | `shadowRest` | `--duvet-shadow-raised` (the app's resting card shadow; mind the name, §1.7) |
| `--shadow-float` | `0 4px 8px rgba(21, 23, 43, .039), 0 24px 56px rgba(47, 76, 255, .122)` | `0 4px 8px rgba(0, 0, 0, .4), 0 24px 56px rgba(0, 0, 0, .55)` | Glass panels: popovers, menus, sheets, tooltips | `shadowFloat` | `--duvet-shadow-float` |
| `--shadow-control` | `0 1px 2px rgba(21, 23, 43, .059), 0 6px 16px rgba(47, 76, 255, .078)` | `0 1px 2px rgba(0, 0, 0, .35), 0 6px 16px rgba(0, 0, 0, .35)` | Primary controls at rest (primary button, Send on, voice play, segmented thumb) | `shadowControl` | new |
| `--shadow-raised` | `0 2px 4px rgba(21, 23, 43, .039), 0 12px 32px rgba(47, 76, 255, .078)` | `0 2px 4px rgba(0, 0, 0, .35), 0 12px 32px rgba(0, 0, 0, .4)` | Hovered cards, chips, thread chip; the call stage | `shadowRaised` | new |
| `--shadow-pressed` | `inset 0 2px 6px rgba(21, 23, 43, .141), inset 0 1px 2px rgba(21, 23, 43, .078)` | `inset 0 2px 6px rgba(0, 0, 0, .45), inset 0 1px 2px rgba(0, 0, 0, .3)` | A control pushed in (primary button, Send) | `shadowPressed` (drawn inset by `InsetShadow`) | `--duvet-shadow-press` |
| `--shadow-well` | `inset 0 1px 3px rgba(21, 23, 43, .059)` | `inset 0 1px 3px rgba(0, 0, 0, .4)` | The resting recess of fields (composer, inputs) | `shadowWell` | new |

**Prism** (the light a mention of you throws on its bubble, S-13)

Spill alpha = theme.dart's `intensity` (.7) × that light's spill.

| Variable | Light | Dark | theme.dart |
|---|---|---|---|
| `--prism-gem` | `rgba(122, 104, 232, .182)` | `rgba(139, 108, 255, .252)` | `gem` × .7 × `mainSpill` (.26 / .36) |
| `--prism-cool` | `rgba(47, 140, 255, .112)` | `rgba(123, 157, 255, .098)` | `cool` × .7 × `coolSpill` (.16 / .14) |
| `--prism-warm` | `rgba(228, 79, 203, .098)` | `rgba(191, 124, 239, .084)` | `warm` × .7 × `warmSpill` (.14 / .12) |
| `--prism-shadow` | `0 8px 24px -8px rgba(122, 104, 232, .45)` | `0 8px 26px -14px rgba(139, 108, 255, .45)` | `shadowBlur`/`shadowSpread`, `prismShadow()` in `widgets/prism.dart` (alpha .45, offset 0 8) |
| `--rim-0` … `--rim-3` | `rgba(122,104,232,.70)`, `rgba(122,104,232,.20)`, `rgba(47,140,255,.20)`, `rgba(47,140,255,.50)` | `rgba(139,108,255,.8)`, `rgba(255,255,255,.08)`, `rgba(255,255,255,.08)`, `rgba(123,157,255,.35)` | `rim`, stops at 0, .42, .70, 1 |

All of these are new to the app. theme.dart also has `behindName` (`#D3D0FD` / `#413A66`), the colour names on the spill are made readable against. The prototype has no such token (§9).

**Interaction fills**

| Variable | Light | Dark | What for | App |
|---|---|---|---|---|
| `--hover` | `rgba(21, 23, 43, .05)` | `rgba(255, 255, 255, .06)` | Hover on icon buttons, tabs, list rows in popovers | new |
| `--hover-soft` | `rgba(21, 23, 43, .028)` | `rgba(255, 255, 255, .03)` | Hover on flat rows, clickable settings rows | new |
| `--hover-strong` | `rgba(21, 23, 43, .08)` | `rgba(255, 255, 255, .1)` | Pressed icon buttons; Windows and GNOME window buttons | new |
| `--field-bg` | `rgba(21, 23, 43, .045)` | `rgba(255, 255, 255, .06)` | Search fields, inline code, quotes, the closed spoiler | new |
| `--seg-track` | `#E6EBFF` | `#16161D` | Segmented control track | new |
| `--toggle-off` | `#D3D9F0` | `#2A2C3C` | Switch off, slider rest, meter track, storage bar track | new |
| `--kbd-bg` | `rgba(21, 23, 43, .06)` | `rgba(255, 255, 255, .08)` | Keycap chips | new |

**Sidebar** (also the Settings windows' side panel)

| Variable | Light | Dark | What for | App |
|---|---|---|---|---|
| `--sb-bg` | `rgba(236, 240, 253, .8)` | `rgba(26, 26, 34, .76)` | The sidebar's tint over the backdrop (macOS; other platforms override it, §1.2) | new |
| `--sb-filter` | `blur(48px) saturate(1.5)` | `blur(48px) saturate(1.4)` | Its `backdrop-filter` | new |
| `--sb-field` | `rgba(255, 255, 255, .58)` | `rgba(255, 255, 255, .07)` | The search field and the switch's track | new |
| `--sb-hover` | `rgba(21, 23, 43, .05)` | `rgba(255, 255, 255, .06)` | Hover on sidebar rows | new |
| `--sb-ring` | `#E8ECFB` | `#16161E` | The ring round presence dots and stacked icons in the sidebar | new |
| `--sb-card` | `rgba(255, 255, 255, .78)` | `rgba(255, 255, 255, .055)` | The call panel | new |
| `--sb-edge` | `rgba(21, 23, 43, .07)` | `rgba(255, 255, 255, .06)` | The sidebar's edges and guide lines | new |

**Smaller pieces**

| Variable | Light | Dark | What for | App |
|---|---|---|---|---|
| `--pop-ring` | `#F3F5FE` | `#16161C` | The ring round avatars on popovers (the glass's apparent colour) | new |
| `--tip-bg` / `--tip-ink` / `--tip-dim` | `#15172B` / `#FFFFFF` / `rgba(255,255,255,.55)` | `#2B2C3A` / `#FFFFFF` / `rgba(255,255,255,.5)` | Tooltips; their shortcut keys | new |
| `--mark-bg` | `rgba(255, 210, 60, .5)` | `rgba(255, 210, 60, .3)` | Search hits | replaces the app's `::highlight(search-hit)` (`--duvet-warn` 40%) |
| `--scroll-thumb` | `rgba(21, 23, 43, .18)` | `rgba(255, 255, 255, .16)` | Scrollbar thumb (hover: `--ink-2`) | new |
| `--code-bg` | `#EEF2FF` | `#0B0B11` | Code blocks | new (today `--duvet-sunk`) |
| `--tl-inactive` | `#D7D9E1` | `#3D3E48` | Traffic lights in an unfocused window | new |
| `--win-edge` | `rgba(255, 255, 255, .5)` | `rgba(255, 255, 255, .1)` | The window's 1 px inner edge (fake window: §7) | new, likely not needed |
| `--card-soft` | `rgba(255, 255, 255, .7)` | `rgba(255, 255, 255, .04)` | The quoted message at the top of a thread | new |
| `--role-owl` | `#0B7FC0` | `#4DB8F0` | Sample role colour, lifted for contrast | scaffolding (§7.1) |
| `--role-producer`, `--role-regular`, `--role-studio`, `--role-tester`, `--role-team` | (none) | `#A895FF`, `#4CC38A`, `#5CA8FF`, `#4CC38A`, `#8C9BFF` | The same, dark only | scaffolding: the app computes readable role colours (`lib/name-colors.ts`) |

**The same in both themes** (on `.stage`)

| Variable | Value | What for | theme.dart |
|---|---|---|---|
| `--media-ink` | `#F2F1EE` | Text and icons over photos and video | `mediaInk` |
| `--media-scrim` | `rgba(17, 17, 19, .55)` | Chips and labels over media | `mediaScrim` (`0x8C111113`) |
| `--spring` | `cubic-bezier(.3, 1.18, .5, 1)` | Sliding pills and thumbs | `pillSpring` |
| `--overshoot` | `cubic-bezier(.34, 1.12, .64, 1)` | Things that arrive (popovers, sheets, windows, notices) | `overshoot` |
| `--decelerate` | `cubic-bezier(.2, .9, .3, 1)` | Things that move or settle (carets, widths, the flash) | `decelerate` |
| `--serif-sm` / `--serif-md` / `--serif-lg` | `'opsz' 24, 'SOFT' 50, 'WONK' 0` / `'opsz' 36, …` / `'opsz' 72, …` | Fraunces' `font-variation-settings` | `_headline`: opsz 36 (`navTitle`), 72 (`title`). Opsz 24 is new. |
| `--pad-x` | `clamp(16px, 3.2%, 40px)` | The message list's and composer's side padding | none |
| `--ui` / `--content` / `--serif` / `--mono` | `'Inter', 'Twemoji', system-ui, sans-serif` / `'Roboto', 'Twemoji', system-ui, sans-serif` / `'Fraunces', Georgia, serif` / `'Fira Mono', ui-monospace, monospace` | The four families (§1.5) | `DuvetType.family`, `content`, `serif`, `mono` |

The app's `--duvet-warn` (`#9a5f0a` / `#f0c47a`: an unverified email, storage nearly full, idle) has no counterpart in the prototype or theme.dart. **Keep it** at its current values until a designer sets one (§9).

### 1.2 Platform overrides

| Selector | Change |
|---|---|
| `.platform-win.theme-light` | `--sb-bg: rgba(238, 241, 254, .82)` ("Mica is lighter on translucency"); the blur stays |
| `.platform-win.theme-dark` | `--sb-bg: rgba(20, 20, 27, .84)` |
| `.platform-linux.theme-light`, `.platform-web.theme-light` | `--sb-bg: #EDF1FF; --sb-filter: none; --sb-ring: #EDF1FF` (the Ghost tint, solid) |
| `.platform-linux.theme-dark`, `.platform-web.theme-dark` | `--sb-bg: #0D0D12; --sb-filter: none; --sb-ring: #0D0D12` |
| `.theme-dark .seg-thumb`, `.theme-dark .tri-thumb` | background `#262633` (instead of `--card`) |
| `.theme-dark .pill` | background `#1A1A22` (picked: `--selected-fill`) |
| `.theme-dark .scrim` | `rgba(0, 0, 0, .5)` (light: `rgba(7, 7, 10, .3)`) |
| `.theme-dark .vt-bg` | opacity .4 (light .5) |

On macOS the sidebar's blur shows the desktop through the window (vibrancy). In the Electrobun app that needs a transparent window and a native vibrancy view. A CSS `backdrop-filter` over the app's own background blurs nothing. That's an engineering question for the shell (§8.14), not a token.

### 1.3 Variables the prototype sets from script

| Variable | Set on | Value |
|---|---|---|
| `--own-bubble` | `.stage` | the picked bubble colour, else `var(--azure)` |
| `--own-ink` | `.stage` | `#fff`, or `#15172B` when that contrasts better with the picked colour (`D.inkOn`: WCAG relative luminance) |
| `--msg-size` | `.stage` | the text size, 13–19 px, default 15 px: bubbles, flat text, the composer |
| `--composer-h` | each `.pane` | the composer's height, measured live (§8.3); default 80 px |
| `--i`, `--n` | switches, segmented controls, notices | the picked option's index, the option count, the notice's place in the stack |
| `--cols` | `.vr-grid` | voice room grid columns (1, 2 or 3) |
| `--p` | `.slider` | the slider's fill, as a percentage |
| `--mx`, `--my`, `--cx`, `--wx`, `--ps` | a Prism bubble | where its lights sit, and their scale (§8.9) |
| `--fh-rx`, `--fh-ry`, `--fh-blink`, `--fh-delay`, `--fh-s` | a Facehash | its tilt, blink period and delay, size |
| `--ring`, `--header-ring` | avatars | the colour of the ring round a presence dot (the surface behind) |
| `--d`, `--s` | presence dots, face stacks | dot diameter `max(8, round(size × .3))`, face size |

### 1.4 Colours written inline (not tokens)

Port each of these as a token or a theme constant, not a literal.

| Value | Where |
|---|---|
| `#E5484D` | The "Live" pill, the recording dot, Decline on a call notice, Hang up and Leave. A second red beside `--destructive` (§9). |
| `#FF9592` | A muted mic over media (call stage, voice tiles); a call button that's off: `rgba(229, 72, 77, .25)` behind `#FF9592` |
| `#C42B1C` | Windows' Close button on hover |
| `#FF5F57`, `#FEBC2E`, `#28C840` | The traffic lights. Their glyphs are `rgba(0,0,0,.55)`; their ring is `inset 0 0 0 .5px rgba(0,0,0,.2)`, `.1` when inactive. |
| `#0d0d14` | The call stage's background |
| `rgba(255,255,255,.08 / .12 / .14 / .22)` | Tiles, buttons and their hover over the call stage and in the media viewer |
| `rgba(8, 8, 12, .94)` | The media viewer's backdrop |
| `#FF0033`, `#1ED760` | The YouTube play mark, the Spotify mark |
| `#EC4899`, `#F59E0B`, `#3B82F6`, `#F97316`, `#10B981` | Facehash backgrounds (mobile `facehash.dart`) |
| `#5F45B5`, `#2F4CFF`, `#E44FCB`, `#2F9E62`, `#F97316`, `#15172B` | Bubble colour swatches (after the azure default), Settings → Appearance |
| `#7A68E8`, `#E44FCB` | Storage bar segments (besides `--azure`, `--live`) |
| `#5E6380`, `#2F9E62`, `#2F4CFF`, `#E44FCB`, `#F97316`, `#0E8FD6`, `#0B6FE8`, `#15172B`, `#7C5CFF`, `#F59E0B`, `#B0443B` | The Settings and Space settings sidebars' icon tiles (white glyphs) |
| `#D97706`, `#E44FCB`, `#7C5CFF`, `#2F4CFF`, `#0E8FD6`, `#10B981`, `#2F9E62`, `#B0443B`, `#F97316`, `#5E6380` | The role colour picker's swatches |
| `#F5F7FF`/`#E4E9FB`, `#07070A`/`#17171F`, `#22222C` | The theme cards' miniature windows (light/dark base and sidebar, a dark bubble) |
| `#fff`, `#000` | Facehash eyes and initial (`#000`); white on accent, on Decline/Accept, toggle knobs, slider thumbs |
| `#0a0f2c` | The page behind the fake desktop (scaffolding) |

### 1.5 Typography

**Families and their jobs** (theme.dart's rule)

| Family | Files (§2) | Weights used | Used for |
|---|---|---|---|
| Inter | Regular, Medium, SemiBold, Bold | 400, 500, 600, 700 | The interface, and any title that is or holds a number (storage's "412 MB") |
| Roboto | Regular, Medium, Bold | 400 (500 and 700 for bold inside messages) | What people write: bubbles, flat rows, the composer, snippets, embed descriptions, bios, notices' text, search results |
| Fraunces | one variable file | 400, 500, 640 | Small headers: pane titles, Space names and monograms, popover, sheet and window titles, intros, profile names |
| Fira Mono | Regular | 400 (500 in the emoji picker's name) | Code, the invite link, the colour hex field, Facehash's initial |
| Twemoji | one COLR font | n/a | Emoji, by `unicode-range` (§2.3) |

**Fraunces' axes.** The file's defaults are opsz 9, SOFT 0, wght 900 and WONK 1 (Black and wonky). Every use therefore sets `font-variation-settings` to `'opsz' N, 'SOFT' 50, 'WONK' 0`, with N = 24, 36 or 72 by size. It also sets `font-weight`, which the browser maps to wght through the `@font-face`'s `font-weight: 100 900`. theme.dart uses opsz 36 for top-bar titles, 72 for sheet titles and 144 for the wordmark. The prototype adds 24 for its smallest serif text.

**The base.** `.stage` is `400 13px/1.4 Inter`, letter-spacing `-.003em`, antialiased, `user-select: none`. Text is selectable only in message text, bios, inputs, embed descriptions, thread text and code blocks.

**The scale.** Sizes and weights by role, as `font: weight size/line-height family`. "uc" means uppercase.

| Role | Style | Where |
|---|---|---|
| Empty-pane title | `400 24px/1.2` Fraunces opsz 72 | S-12 |
| Chat intro title | `400 22px/1.15` Fraunces opsz 72 | S-13 |
| Profile name | `500 21px/1.15` Fraunces opsz 72, `-.012em` | S-39 |
| Sheet title | `400 21px/1.2` Fraunces opsz 72, `-.01em` | S-44–S-46 |
| Profile editor name | `500 20px/1.2` Fraunces opsz 72 | S-48 |
| Popover title | `500 19px/1.2` Fraunces opsz 36, `-.01em` | S-33, S-37–S-40 |
| Invite card's Space, room editor's name | `500 18px/1.2` Fraunces opsz 36 | S-17, S-61 |
| Settings page title | `500 17px/1.2` Fraunces opsz 36, `-.01em` | S-47 |
| Empty state title | `500 17px/1.2` Fraunces opsz 36 | everywhere a mascot is |
| Pane title | `500 16.5px/1.15` Fraunces opsz 36, `-.012em` | S-11 |
| Join bar's room name | `500 16px/1.2` Fraunces opsz 36 | S-32 |
| Settings window's Space name | `500 15px/1.2` Fraunces opsz 24 | S-58 |
| Space name in the sidebar | `500 14.5px/1.2` Fraunces opsz 24, `-.005em`; unread `640` | S-06 |
| Space monogram | `500` Fraunces opsz 36, size = icon × .46 | Space icons without a picture |
| Storage figure | `600 26px/1.1` Inter, `-.02em` (unit `500 14px` ink-2) | S-56, S-67 |
| ⌘K input | `400 17px/1.2` Inter | S-35 |
| Message text | `400 var(--msg-size)/1.4` Roboto (flat rows `/1.45`); default 15 px | S-13, S-14, S-23 |
| Flat row author | `600 14px/1.2` Inter | S-14 |
| Card titles | `600 14–14.5px/1.3` Inter | S-17 |
| Row names (sidebar, settings, palette) | `500 13.5px` Inter (chat names `/1.25`; unread `700`) | S-05, S-47 |
| People rows (members, calls, pins, new chat) | `600 13.5px/1.2` Inter | S-33, S-38, S-44 |
| Tabs, menu items, buttons | `500 13px` Inter | S-02, S-42 |
| Bios, notices' text, thread text | `400 13.5px/1.35–1.45` Roboto | S-29, S-39, S-40 |
| Embed and pin text, search results | `400 13px/1.4–1.45` Roboto | S-17, S-36, S-37 |
| Sender names over bubbles, call panel title | `600 12.5px/1.2` Inter | S-13, S-08 |
| Reply strip, system rows, composer strips | `400 12.5px/1.3` Inter (snippets in Roboto) | S-18, S-19, S-23 |
| Snippet under a chat name | `400 12.5px/1.3` Roboto | S-05 |
| Secondary lines | `11.5–12px` Inter, ink-2 | throughout |
| Sidebar section heads | `600 11.5px/1` Inter, sentence case | S-05, S-06 |
| Tooltips | `500 12px/1.2` Inter | S-43 |
| Message times | `400 11px/1.3` Inter, tabular figures | S-13 |
| Overlines (categories, popover groups, settings group titles, table heads) | `600 10.5–11px/1` Inter, uc, `.06em` | throughout |
| Chips (unread, mention, count) | `700 10.5px/18px` Inter | S-05 |
| Keycaps | `500 10.5px/1` Inter, `.02em` | S-04, S-35, S-55 |
| BOT tag, Live pill | `700 9px/1` Inter, `.04em` / uc `.05em` | S-13, S-06 |
| Code | `400 12.5px/1.5` Fira Mono (blocks), `.86em` (inline) | S-15 |
| Jumbo emoji | `400 40px/1.15` Twemoji first | S-13 |

Figures are tabular (`font-variant-numeric: tabular-nums`) for times, durations, counts and timers.

### 1.6 Radii

theme.dart has five: chip 8, field 12, button 16, card 20, sheet 24. The prototype keeps 20 and 24 for floating surfaces and tightens the rest for a mouse:

| Radius | Used by |
|---|---|
| 4–6 | BOT tag (4); keycaps, inline code, Live pill, spoiler, GIF badge (5); tab close, room chips, voice speed chip, "Default" tag (6) |
| 7 | Sidebar head buttons, a tab half, Space `…`, role chips, palette glyph tiles, settings icon tiles |
| 8 | Tooltips, small icon buttons (26 px), picker category buttons, voice occupant rows, segmented thumbs |
| 9 | Icon buttons (30 px), small buttons, menu items, pills, room rows, "more chats", settings nav items, the switch's pill |
| 10 | The search field, sidebar rows, tabs, Space rows, call panel buttons, code blocks, quotes, role rows |
| 11 | Buttons (34 px), segmented tracks, search fields, inputs, palette rows, viewer buttons |
| 12 | Chat rows, the profile row, the switch, flat rows, reactions (pill), thread chip, file icon tile, call buttons, popover rows, picker cells, GIFs |
| 14 | The call panel, menus, @ suggestions, Friends rows, the Settings window on macOS |
| 16 | The macOS window, bubbles, photo tiles, cards (file, embeds, settings), type cards, the media viewer's video bar |
| 18 | Voice notes, notices, drop zones, the in-chat search popover, the room's control bar, the YouTube dock |
| 20 | The composer field, the call stage, voice tiles, popovers (profile, members, pins, calls, emoji, thread), ⌘K |
| 24 | Sheets; the Settings sheet on the web |
| 50% | People (avatars, presence, Facehash), play buttons, swatches, the jump button |

Shapes: circles only for people. Bots' avatars and Space icons are rounded squares: a bot's clip has radius 28%; a Space icon's radius is `round(size × .27)`.

Windows: macOS 16, Windows 9, Linux 13, web 0. The Settings windows are 14 on macOS, 9 on Windows and 13 on Linux.

### 1.7 Shadows

The six shadow tokens are in §1.1. Watch the names: the prototype's `--shadow-rest` is what the app calls `--duvet-shadow-raised` today, and the prototype's `--shadow-raised` is a stronger, new one.

Shadows written in place:

| Where | Value |
|---|---|
| The window (scaffolding: the OS draws it) | `0 0 0 .5px rgba(0,0,0,.45), 0 34px 90px -12px rgba(0,0,0,.55), 0 10px 30px rgba(0,0,0,.22)` plus `inset 0 0 0 1px var(--win-edge)` |
| An unfocused Settings window | `0 0 0 .5px rgba(0,0,0,.35), 0 20px 50px -10px rgba(0,0,0,.4)` |
| Glass (`.glass`) | `var(--shadow-float), inset 0 0 0 1px var(--glass-edge)` |
| The active tab | `var(--shadow-rest), 0 0 0 .5px var(--hairline)` |
| Fields at rest | `var(--shadow-well), 0 0 0 1px var(--hairline)` |
| Fields focused | `var(--shadow-well), 0 0 0 1px var(--hairline), 0 0 0 4px var(--accent-tint)` |
| Search fields focused | `0 0 0 3px var(--accent-tint)` |
| The main column's edge against the sidebar | `-1px 0 0 var(--sb-edge)` (none when the sidebar is hidden) |
| The sidebar bottom's top edge | `0 -1px 0 var(--sb-edge)` |
| Speaking tile | `0 0 0 2px var(--live), 0 0 32px -6px rgba(var(--live-rgb), .6)`; its avatar `0 0 0 3px var(--live), 0 0 0 8px rgba(var(--live-rgb), .18)` |
| Hover on a filled control | `inset 0 0 0 100px var(--hover)` (darkens any fill evenly) |

### 1.8 Glass recipes

| Surface | Background | Backdrop filter | Edge and shadow |
|---|---|---|---|
| Glass: popovers, menus, the hover bar, notices, toasts, @ suggestions, the jump button, the room's join and control bars, small buttons over banners | `--glass` | `blur(32px) saturate(1.8)` (theme.dart `blurGlass` 32; saturation 1.8 from `mobile/TODO.md`) | `var(--shadow-float), inset 0 0 0 1px var(--glass-edge)` |
| ⌘K | `--glass-strong` | same | same |
| Sheets (and the Settings sheet on the web) | `--glass-strong` | same | same |
| The composer bar | `--glass` | `blur(20px) saturate(1.8)` (`blurChrome` 20) | `0 -1px 0 var(--hairline)` above it |
| The pane header, once scrolled | `--glass-strong` | `blur(24px) saturate(1.8)` | `0 1px 0 var(--hairline)` under it |
| The sidebar and the Settings windows' side panel | `--sb-bg` | `--sb-filter`: `blur(48px) saturate(1.5)` light, `1.4` dark; none on Linux and the web | `-1px 0 0 var(--sb-edge)` beside it |
| Media chips and labels (play disc, duration, tile labels, tile actions) | `--media-scrim` | `blur(10–14px)` | the play disc: `inset 0 0 0 1px rgba(255,255,255,.12)` |
| The viewer's video bar | `rgba(17, 17, 19, .6)` | `blur(20px)` | none |
| Friends rows' action buttons | `--glass` | `blur(10px)` | none |

### 1.9 Spacing and dimensions

| What | Size |
|---|---|
| Sidebar width | 288 default; 232 to 380 by dragging; remembered |
| Sidebar header, tab strip, pane header | 52 tall (theme.dart `sizeTopBar`) |
| Sidebar header padding | `0 8 0 18`, gap 8 |
| Sidebar search | 32 tall, margin `0 10 8`, padding `0 6 0 10`, radius 10 |
| Sidebar list padding | `0 8 12`; sections 8 apart |
| Sidebar rows | Friends 44 (32 icon), chats 50 (32 avatar; compact 44), Space 34 (22 icon), room 30 (15 icon; compact 27), category 26, voice occupant 26 (20 avatar), "more" 28 |
| Sidebar bottom | padding `8 10 10`, gap 8; call panel padding 8, buttons 30 tall; profile row avatar 30; switch 34 tall |
| Tabs | 34 tall; 200 wide, shrinking to 112; a pair 340 (min 200); pinned 44; gap 4; new-tab button 30 |
| Message list | padding top 60 (14 under a call stage), sides `--pad-x` = `clamp(16px, 3.2%, 40px)`, bottom `--composer-h` + 14 |
| Bubbles | max 65% of the pane's row; padding `8 12` (compact `6 11`); 28 avatars; groups 10 apart (compact 6) |
| Flat rows | 52 gutter, 36 avatars, padding `3 8`; heads 12 apart (compact 8); text max 760; media and cards max 420 |
| Attachments | photo grid 360 wide (one photo max 380 tall); file card and voice note 300; link and YouTube 380; Spotify 360; invite 340; bot 400; sticker 136 |
| Composer | padding `8 --pad-x 14`; field min 42 tall; text grows to 132, then scrolls; buttons 34 |
| Call stage | margin `58 12 0`; 236 tall, 52 shrunk; tiles 180 × 136 (64 avatars); bar 52 |
| Voice room | padding `60 14 90`; gap 10; tiles 84 avatars; screen-share strip 104 tall, tiles up to 150 wide (44 avatars); control buttons 44 × 38 |
| Popovers | profile 320, members 340, pins and calls 360, in-chat search 420, emoji 372 (440 tall), thread 380; lists max `min(560px, 72vh)`; menus 224–320 |
| ⌘K | `min(640px, 100% − 48px)`, 11vh from the top, max 66vh |
| Sheets | `min(520px, 100% − 48px)`, max 84% tall, padding 16, gap 12 |
| Settings windows | Settings 860 × 620, Space settings 940 × 660, each at most viewport − 80 × viewport − 80; side panel 236; toolbar 52; content padding `20 26 40`, page max 640 (Roles 860) |
| Settings on the web | a sheet `min(920px, 100% − 48px)` × `min(660px, 100% − 48px)` |
| Notices | `min(420px, 100% − 32px)` wide, 62 from the top of the main column |
| Toasts | 30 from the bottom of the window, centred |
| Avatars | 16 tabs, quiet stack · 18 face stacks, To chips · 20 voice occupants · 22 Space icons in the sidebar, @ suggestions · 24 palette, thread · 28 messages, pane header, pins, search results · 30 profile row · 32 chats, members, calls, new chat · 34 Settings head · 36 flat rows, notices, profile menu · 40 Friends · 44 invite card Space, small voice tiles · 64 intros, call tiles · 72 Space settings icon · 76 profile card · 84 voice tiles, profile editor |
| Mascots | 88 in empty states, 112 in the empty pane, 120 in an empty voice room |
| Presence dot | `max(8, round(size × .3))`, at the avatar's bottom right (−1 px), with a 2 px ring of the surface's colour |

### 1.10 Motion

**Curves and durations** (theme.dart: presses 120 ms in and 150 ms out; the tab pill 250 ms on the spring; panels 320 ms in and 250 ms out; dropdowns 280 ms in)

| What | Animation | Duration and curve |
|---|---|---|
| The All · Chats · Spaces pill, segmented thumbs, tri-state thumbs | translateX by index | 250 ms `--spring` |
| Switch knob | translateX 16 | 250 ms `--overshoot` |
| Popovers and menus arriving | from opacity 0, scale .97 | opacity 160 ms ease, transform 280 ms `--overshoot`; transform-origin is the side facing the anchor |
| ⌘K, the jump button, the media viewer's image | `pop`: from opacity 0, scale .96 | .28 s / .28 s / .3 s `--overshoot` |
| Sheets, toasts, the unsaved bar, the YouTube dock | `sheetIn`: from opacity 0, translateY 14, scale .98 | .32 s (sheets) or .3 s `--overshoot` |
| Settings windows | `winIn`: from opacity 0, scale .96 | .32 s `--overshoot` |
| A settings page | `fadeUp`: from opacity 0, translateY 6 | .25 s `--decelerate` |
| Scrims | `fade` from 0 | .18 s ease |
| Notices | `noticeIn`: from opacity 0, translate −20 px, scale .96; restacking | .45 s `--overshoot`; stack moves .35 s `--overshoot`, opacity .3 s |
| Hover bar | opacity; translate 4 px → 0 | .12 s; .18 s `--decelerate` |
| Space caret, category chevron, quiet chevron | rotate | .22 s / .2 s `--decelerate` |
| In-chat search field | width 168 → 240 | .22 s `--decelerate` |
| Call stage | height 236 ↔ 52 | .3 s `--decelerate` |
| Photo hover | scale 1.03 | .35 s `--decelerate` |
| Emoji hover (hover bar, picker, menu) | scale 1.12–1.15 | .1–.12 s (`--overshoot` in the menu) |
| Reaction chip | hover translateY −1; press scale .96 | .12 s |
| Send | press scale .94 + pressed shadow | .12 s |
| Hover colours (buttons, rows, tabs) | background, colour | .12–.2 s |
| Flash after a jump | `flash`: 3 px accent ring, held to 35%, fades | 1.6 s `--decelerate` (flat rows: accent-tint background) |
| Prism arriving | `prism-arrive`: opacity 0 → 1 | 900 ms `--decelerate`, after 250 ms |

**Loops.**
- Typing dots: `dot` 1.2 s, the three dots .15 s apart, rising 2 px.
- Ringing dots: the same, in green.
- Recording dot: `pulse` 1.2 s.
- Recording bars: `recbar` .7 s alternate, 6 → 22 px, staggered.
- Spoiler specks: `specks` 3 s linear.
- Facehash: blinks every 3–6 s, by name; talks (`talk`, .9 s) while speaking.
- Speaking avatar: `speak` 1.4 s.
- Accept on an incoming call: `ring` 1.2 s.
- GIFs in the picker: `gifpan` 3.2 s alternate, as placeholders for real GIFs.

**Timing.**
- Tooltips appear after 520 ms of rest.
- A notice leaves after 7 s, except a call, and not while the stack is hovered.
- A toast lasts 2.2 s.
- An open chat is marked read 1.4 s after it's shown.

**There is no exit motion.** Popovers, menus, sheets, notices and windows vanish at once. theme.dart has `panelOut` 250 ms on `decelerate` (§9).

**Reduced motion.** `@media (prefers-reduced-motion: reduce)` cuts every animation and transition to .01 ms and one iteration, and shows Prism's light at once. Appearance in Settings has a "Reduce motion: System · On" control that does nothing in the prototype. The app follows the OS through CSS today; keep that.

### 1.11 Z-layers

| z-index | Layer |
|---|---|
| 1 | The fake menu bar (scaffolding) |
| 3 | The call stage; the voice room's control bars |
| 4 | The composer; the hover bar |
| 5 | The pane header; the jump button |
| 6 | The tab strip |
| 7 | The split gutter |
| 10 | The sidebar's resize handle |
| 20 | Drop zones while dragging |
| 40 | The YouTube dock (scaffolding) |
| 50 | Notices |
| 600 | Settings and Space settings windows |
| 900 | Scrims and sheets (⌘K, sheets, the media viewer; the Settings sheet on the web) |
| 1000 / 1001 | Popovers and menus / submenus |
| 1500 | Tweaks (scaffolding) |
| 2000 | The window's inner edge (scaffolding) |
| 2500 | Toasts |
| 3000 | Tooltips |

Notices, the composer and the header live inside the main column. Popovers, menus, toasts and tooltips are fixed to the page, so nothing clips them. Popovers sit above sheets: a popover opened from inside a sheet shows over it.

---

## 2. Fonts and assets

### 2.1 The font files

`desktop-prototype/assets/fonts/` and `mobile/assets/fonts/` hold the same files, byte for byte (checked with `cmp`):

| File | Size | What it is | License |
|---|---|---|---|
| `Inter-Regular.ttf`, `-Medium`, `-SemiBold`, `-Bold` | 412–420 KB each | Static weights 400, 500, 600, 700; no italics | SIL OFL 1.1, `Inter-OFL.txt` (© 2016 The Inter Project Authors) |
| `Roboto-Regular.ttf`, `-Medium`, `-Bold` | 356–358 KB each | Static 400, 500, 700; no italics | SIL OFL 1.1, `Roboto-OFL.txt` (© 2011 The Roboto Project Authors) |
| `Fraunces.ttf` | 384 KB | One variable font. Axes: `opsz` 9–144 (default 9), `SOFT` 0–100 (0), `wght` 100–900 (900), `WONK` 0–1 (1). Read from its `fvar` table. | SIL OFL 1.1, `Fraunces-OFL.txt` (© 2018 The Fraunces Project Authors) |
| `FiraMono-Regular.ttf` | 175 KB | 400 | SIL OFL 1.1, `FiraMono-OFL.txt` (© 2012–2015 Mozilla Foundation and Telefonica S.A.) |
| `Twemoji.ttf` | 2.0 MB | A colour font: `COLR` version 0 with `CPAL`, 5,443 colour glyphs | Art CC-BY 4.0 (jdecked/twemoji); build code Apache 2.0 (Mozilla); `Twemoji-LICENSE.md` |

The prototype loads each with `font-display: block` (the text waits for the font).

### 2.2 What the app ships, and what changes

**Today.**
- `src/mainview/src/lib/fonts/` holds Fira Sans (400, 400 italic, 500, 500 italic, 600, 700) and Fira Mono (400, 500, 700). They are woff2 files split by script as Google serves them: latin, latin-ext, cyrillic, cyrillic-ext, greek, greek-ext, vietnamese (Sans) and symbols2 (Mono). That makes 63 `@font-face` rules in `fonts.css`, each with a `unicode-range` and `font-display: swap`, 1.2 MB in all, with `OFL-FiraSans.txt` and `OFL-FiraMono.txt`.
- `app.css` sets `--font-sans: "Fira Sans", …` on everything (`* { font-family: var(--font-sans) }`) and `--font-mono: "Fira Mono", …`. It also declares `--font-display: "Cal Sans"` and `--font-alt: "Courier"`, which nothing in `lib/components` uses.

**Guards.**
- `fonts.test.ts` checks three things: `app.css` imports `./lib/fonts/fonts.css`; every `url()` in it names a file that exists; and `fonts.css` declares `font-family: "Fira Sans";` and `"Fira Mono"` without `https:`.
- `csp.test.ts` and the CSP in `svelte.config.js` allow `font-src 'self' data: https:`, so local fonts need nothing new.

**To add.**
- Inter 400/500/600/700, Roboto 400/500/700, Fraunces (variable, declared with `font-weight: 100 900`), Twemoji.
- Convert them to woff2 and split them by `unicode-range` as the Fira files are. TTF for TTF they would add 5.4 MB, Twemoji alone 2 MB.
- Keep `font-display: swap` (the app's choice, against the prototype's `block`). `startup-timing.ts` measures startup, and the faces shouldn't hold back first paint.
- Fraunces needs its variation axes kept when it's converted.

**To keep.** Fira Mono, for code. The prototype uses only its 400 (and 500 once); the app's 500 and 700 cost nothing until used.

**To remove.** Fira Sans and its OFL text, once nothing names it. Drop `--font-display` and `--font-alt` if nothing uses them.

**To change in the guard.** `fonts.test.ts` asserts Fira Sans by name. It pins the old look, so it changes with the fonts: assert Inter, Roboto, Fraunces and Twemoji instead, and keep the no-network and files-exist checks.

**Italics.** Neither mobile nor the prototype ships an italic Inter or Roboto. Browsers slant `*italic*` text synthetically, which matches mobile. The app ships Fira Sans italics today; that's lost by design, not by accident.

### 2.3 Emoji

**The prototype.** Twemoji is a font in every stack, after the face (`'Inter', 'Twemoji', …`, `'Roboto', 'Twemoji', …`).
- Its `@font-face` carries a `unicode-range` limited to emoji code points: `U+00A9, U+00AE, U+203C, U+2049, U+2122, U+2139, U+2194-2199, U+21A9-21AA, U+231A-231B, U+2328, U+23CF, U+23E9-23F3, U+23F8-23FA, U+24C2, U+25AA-25AB, U+25B6, U+25C0, U+25FB-25FE, U+2600-27BF, U+2934-2935, U+2B05-2B07, U+2B1B-2B1C, U+2B50, U+2B55, U+3030, U+303D, U+3297, U+3299, U+FE0F, U+200D, U+1F000-1FAFF, U+E0020-E007F`. Emoji come from it, and the rest of the text from the face.
- Where text is only emoji, Twemoji comes first: jumbo emoji, reactions, the hover bar, the menu's reactions, the picker.
- theme.dart warns that as a fallback Twemoji loses ©️ ™️ ‼️ ❤️ #️⃣ to the face's own glyphs; with Inter and Roboto ahead of it in the stack the same happens on the web. Put Twemoji first on emoji-only runs, as the prototype does.
- Emoji are text: selectable and copyable, sized by the font size.

**The app today.** Emoji are images from a CDN.
- `lib/emoji.ts` points at `https://cdn.jsdelivr.net/gh/jdecked/twemoji@16.0.1/assets` (72 × 72 PNG, or SVG when large).
- They are drawn as `.emoji-img` spans with a `--tw` background image, at 1.375em.
- A message of up to five emoji only is `.emoji-large`, 3 rem (48 px). The prototype's jumbo is 40 px, for up to 24 characters of emoji.
- Custom emoji are images in both.

**What changes.** Moving to the font takes Twemoji off the network, and every emoji then waits on the font. Two checks belong to the port:
- **The webviews.** COLRv0 draws in Chromium (the web, Windows' WebView2, CEF on Linux). On macOS the app runs in WKWebView. WebKit draws COLRv0, but nobody has seen this font there. Mobile notes that Flutter on iOS draws no glyph of it (#265). Check it in the Electrobun build on macOS before relying on it.
- **Attribution.** Twemoji's art is CC-BY 4.0 and needs credit. The app uses the same art from the CDN today; whether it credits it anywhere wasn't checked.

The emoji picker's data is `assets/emoji.js` in the prototype (categories with an icon emoji and `[emoji, ...names]` lists). The app keeps its own data (`lib/emoji-data.ts`, from `emoji-datasource`).

### 2.4 Mascot and logo

**Mascot.** `desktop-prototype/assets/mascot/{light,dark}/{empty,hello,offline,oops,typing,under_duvet}.svg` are copies of `mobile/assets/mascot`.
- The light and dark files differ in their fills: the body is `#dcd6ff` in light and `#c9cbe0` in dark, the shadow `#c9d4ff` against `#262633`, the highlight `#ffffff` against `#f7f6f3`.
- The prototype picks the file by the resolved theme.
- Uses: `hello` 112 in the empty pane (S-12); `empty` 88 for empty pins and calls; `oops` 88 for no search results and nothing found; `under_duvet` 120 for an empty voice room.
- `typing` and `offline` aren't used, as on mobile.
- Mobile's `DuvetMascot` (`widgets/duvet_mascot.dart`) is the same art, drawn in Flutter.

The app draws its mascot today inline in `MascotPeek.svelte` and `AuthScene.svelte`, as "the desktop's icon draws it", not from these files. The port brings the six SVGs into the app, in both themes. The sign-in pages keep `AuthScene` until their mobile-styled redesign (§6) says otherwise.

**Logo.** `assets/logo/` (same as `mobile/assets/logo/`):
- `app-icon-colored.svg`: the sidebar header in dark on Windows, Linux and the web; the favicon; the "Duvet" bot's avatar and Space icon in the sample.
- `app-icon-rounded.svg`: the sidebar header in light.
- `mark-on-light.svg`: unused.

The sidebar header shows the logo at 22 × 22 with radius 6. The app has its own `lib/assets/icon.svg`, `icon.png` and `favicon.svg`; which mark the header uses is the lead's call, as long as it's one of these.

**Sample assets (scaffolding, §7).** `assets/img/` holds 90 photos from picsum.photos (avatars `av-*`, banners `bn-*`, Space icons `ic-*`, photos `ph-*`/`pt-*`/`th-*`, album art `al-*`, GIF stand-ins `gif-*`, wallpapers `wp-*`). `assets/vendor/` holds Preact, its hooks and htm. None of it ships.

---

## 3. Icons

**Sources.**
- The prototype's glyphs come from `assets/icons.js`: 276 Lucide 1.70.0 glyphs as `lucide_icons_flutter` 4.0.3 ships them to mobile. They are filled outlines on a 24 grid, drawn in `currentColor`.
- The app has `@lucide/svelte` **0.577.0** (stroked icon nodes, 2 px).

**The check.**
- I listed every name the prototype passes as an icon: string literals in `js/` that are keys of the icon set, less the words that are only data kinds or class names there (`cat`, `move`, `grip`, `ghost`; `palette` and `file` count only where they're icons).
- I rendered each glyph from both sources at 96 px in Chromium and compared them with pixelmatch.
- The tool is `redesign-work/tools/icon-compare.ts`. Its output is `redesign-work/shots/icon-compare/report.json`, plus `sheet.png` (every pair) and `differs.png` (the three that differ).

**The result.**
- The prototype uses 102 glyphs. Every one exists in 0.577.0 under the same name, except `text`.
- 99 match pixel for pixel (`text` against `TextAlignStart` included).
- Three differ.

| Prototype name | `@lucide/svelte` export | Note |
|---|---|---|
| `text` (Space settings → Rooms → a room's … → "Edit description") | **`TextAlignStart`** | In 0.577.0, `Text` survives only as a deprecated alias of `TextAlignStart` ("will be removed in v1.0"). Import `TextAlignStart`. |
| `smile` (Space settings sidebar: "Emojis and stickers") | `Smile` | **Differs.** In 1.70.0 (mobile) the eyes are short dashes and the mouth is wider. In 0.577.0 the eyes are dots. |
| `smile-plus` (Add reaction, the composer's emoji button, "More reactions", react buttons) | `SmilePlus` | **Differs**, the same way, and the plus sits differently. |
| `circle-check` (a bot's passing build card) | `CircleCheck` | **Differs slightly**: the tick is larger in 1.70.0 (3% of the inked pixels differ). |

To match mobile exactly, either move to an `@lucide/svelte` built from Lucide 1.70 (a dependency change for the lead) or accept these three.

**Every icon the prototype uses**, with its export. Each is imported as `import { Name } from "@lucide/svelte"`.

| Name | Export | Name | Export | Name | Export |
|---|---|---|---|---|---|
| app-window | AppWindow | git-branch | GitBranch | phone-outgoing | PhoneOutgoing |
| arrow-down | ArrowDown | globe | Globe | picture-in-picture-2 | PictureInPicture2 |
| arrow-up | ArrowUp | grip-vertical | GripVertical | pin | Pin |
| at-sign | AtSign | hard-drive | HardDrive | pin-off | PinOff |
| audio-lines | AudioLines | hash | Hash | pipette | Pipette |
| ban | Ban | headphone-off | HeadphoneOff | play | Play |
| bell | Bell | headphones | Headphones | plus | Plus |
| bell-off | BellOff | image | Image | radio | Radio |
| bot | Bot | image-play | ImagePlay | reply | Reply |
| camera | Camera | images | Images | screen-share | ScreenShare |
| check | Check | info | Info | screen-share-off | ScreenShareOff |
| check-check | CheckCheck | keyboard | Keyboard | search | Search |
| chevron-down | ChevronDown | laptop-minimal | LaptopMinimal | server | Server |
| chevron-left | ChevronLeft | layers | Layers | settings | Settings |
| chevron-right | ChevronRight | layout-grid | LayoutGrid | shield | Shield |
| chevron-up | ChevronUp | link | Link | sliders-horizontal | SlidersHorizontal (Tweaks only) |
| chevrons-up-down | ChevronsUpDown | log-out | LogOut | smile | Smile ⚠ |
| circle | Circle | mail | Mail | smile-plus | SmilePlus ⚠ |
| circle-check | CircleCheck ⚠ | maximize | Maximize | square | Square |
| circle-x | CircleX | megaphone | Megaphone | square-pen | SquarePen |
| clock | Clock | message-circle | MessageCircle | square-slash | SquareSlash |
| code | Code | messages-square | MessagesSquare | sticker | Sticker |
| columns-2 | Columns2 | mic | Mic | text | TextAlignStart ⚠ |
| copy | Copy | mic-off | MicOff | trash-2 | Trash2 |
| corner-up-left | CornerUpLeft | palette | Palette | user | User |
| crown | Crown | panel-left | PanelLeft | user-minus | UserMinus |
| database | Database | paperclip | Paperclip | user-pen | UserPen |
| download | Download | pause | Pause | user-plus | UserPlus |
| ellipsis | Ellipsis | pencil | Pencil | users | Users |
| external-link | ExternalLink | phone | Phone | video | Video |
| file | File | phone-call | PhoneCall | video-off | VideoOff |
| file-text | FileText | phone-incoming | PhoneIncoming | volume-2 | Volume2 |
| folder | Folder | phone-missed | PhoneMissed | webhook | Webhook |
| folder-input | FolderInput | phone-off | PhoneOff | x | X |

**Glyphs that are not Lucide.**
- The traffic lights' and Windows' and GNOME's window-control glyphs are small inline SVGs: `M3.5 3.5l5 5M8.5 3.5l-5 5` (close), `M2.8 6h6.4` (minimise), and two filled triangles for zoom. They are 12-unit boxes drawn at 8 px, stroke 1.3.
- The Spotify and YouTube marks are inline paths.
- The status icons in the profile menu are a filled `circle` scaled to .62 in `--live` or `--destructive`.

**Sizes.**
- 16 by default.
- 12–14 in chips, rows and reply strips.
- 15 in sidebar rows and small buttons.
- 18 in the composer, the + menu and the room's control bar.
- 20–22 in file and type tiles and play buttons.
- 28 in the chat intro's glyph tile.

---

## 4. Surfaces

Each surface lists:
- **Drawn by:** the file and function in `desktop-prototype/js/`, and its main classes.
- **Reach:** how to get there.
- **Layout:** measurements.
- **Tokens:** the tokens it uses.
- **Platforms, themes, layouts:** what changes across them.
- **Interactions** and **motion.**
- **Replaces:** the app components it stands in for (paths under `src/mainview/src/lib/components/`), with what the app does there that the prototype doesn't draw. Those must stay (PARITY.md).
- **States**, with their screenshots.

**Screenshot names.** A state's shots are named `<S-id>-<slug>__<platform>-<theme>-<layout>-<size>.png` in `redesign-work/shots/prototype/` (§10).
- "Shots: `S-13-dm-top`" means the detail pair `S-13-dm-top__mac-light-bubbles-1280x800.png` and `…__mac-dark-bubbles-1280x800.png`, plus any platform named after it (light, 1280×800).
- The six **main views** (marked ★) also have the full matrix: macOS, Windows, Linux and web × light and dark × 1024×700, 1280×800 and 1512×945. That's 24 files each.

The prototype always opens on four tabs:
1. a DM with Mara, active;
2. the group "Sunday Soup Club";
3. the room #general of the Space Night Shift Radio;
4. a joined pair: the voice room "On Air" beside its chat.

You're connected to On Air.

### Shell

#### S-01 Window chrome

**Drawn by.**
- `shell.js`: `D.TrafficLights`, `D.WindowControls`.
- `app.js`: `App`.
- Classes: `.window`, `.main-window`, `.traffic`, `.tl`, `.tl-close`/`.tl-min`/`.tl-max`, `.winctl-win`, `.winctl-linux`, `.drag`, `.no-drag`.

**Reach.** Always there. Tweaks → Platform switches it.

**Layout.**

*macOS.*
- The traffic lights sit at the left of the sidebar header: 12 × 12 circles, gap 8, after 18 px of padding.
- The window has radius 16, the window shadow (§1.7) and a 1 px inner edge.
- When the sidebar is hidden, the lights move to the start of the tab strip (`.ts-lead`, gap 12, padding `0 6 0 8`), followed by the Show sidebar button.

*Windows.*
- Minimise, Maximise and Close sit at the far right of the tab strip.
- Each is 46 wide and as tall as the strip (52). The group has margin-right −10, so it touches the window's edge.
- Glyphs are 10 × 10, stroke 1.
- Hover: `--hover-strong`. Close's hover: `#C42B1C` with white glyphs.
- The window has radius 9.

*Linux (GNOME).*
- Three 24 × 24 round buttons, gap 10, margin `0 4 0 10`, on `--hover-strong`. Glyphs are 10 px, stroke 1.4.
- The window has radius 13.

*Web.* No controls. The window is the page: no radius, no shadow, no edge.

On Windows, Linux and the web, the sidebar header shows the logo where macOS has the lights (S-03).

**Drag areas.**
- The sidebar header and the tab strip carry `-webkit-app-region: drag`.
- Buttons and inputs inside them, and the tabs themselves (`.tabs.no-drag`), don't.
- The empty stretch after the tabs (`.ts-fill`) is the main drag handle.

**Inactive window** (another Duvet window, such as Settings, has focus):
- the lights turn `--tl-inactive`, coloured again on hover;
- the whole tab strip drops to 80% opacity.

**Interactions.**
- Hovering the lights shows their glyphs (×, −, and zoom's two triangles).
- Close shows a toast: "Duvet keeps running in the menu bar" (scaffolding: keep the app's behaviour).
- Double-clicking the empty title bar shows a "Zoom" toast. The app maximises today (`lib/window-controls.ts`); keep that.

**Replaces.**
- `Header.svelte`: the app's own 44 px title bar with a "DUVET" label and three Windows-style buttons, shown only in Electrobun. It goes. The controls move into the 52 px line the sidebar header and the tab strip share.
- `lib/window-controls.ts` (the RPC calls for close, minimise and maximise; drags through `startWindowDrag` on Windows) stays.
- `src/bun/window-frame.ts` and `window-snap.ts` stay.

**States.**
- Focused: every main view.
- `S-01-inactive`: Settings open in front.
- `S-01-traffic-hover`.
- `S-01-controls-hover`, also on win and linux (Close hovered).

#### S-02 Title-bar tab strip

**Drawn by.**
- `shell.js`: `D.TabStrip`, `Tab`, `tabMenu`, `D.RefIcon`, `D.refTitle`.
- Classes: `.tabstrip`, `.ts-lead`, `.tabs`, `.tab` (`.active`, `.split`, `.pinned`, `.drop-before`/`.drop-after`/`.drop-join`), `.tab-half` (`.focused`), `.tab-icon`, `.tab-title`, `.tab-hash`, `.tab-dot`, `.tab-split-sep`, `.tab-close`, `.tab-new`, `.ts-fill`.

**Reach.** Always at the top of the main column.

**Layout.** The strip is 52 tall, `display: flex`, gap 6, padding `0 10`, z 6. From the left:
1. `.ts-lead`, only when the sidebar is hidden.
2. `.tabs`: scrolls sideways with its scrollbar hidden; gap 4, padding `4 2`.
3. The New tab button: 30 × 30, radius 9, `plus` 15, ink-2.
4. `.ts-fill` (flex 1, a drag area).
5. The window controls on Windows and Linux.

**A tab.**
- 34 tall, radius 10, padding `0 4 0 10`, gap 4.
- 200 wide at first, shrinking to 112 (`flex: 0 1 auto`).
- Text: `500 13px` Inter, ink-2.
- Its icon (18 × 18 slot): the person's 16 px avatar for a DM; the group's 16 px Facehash; the Space's 16 px icon for a room or voice room; `users` 14 for Friends; `search` 14 for a New tab.
- The title ellipsises. A text room's name has a `#` in ink-2; a voice room's has none.
- An unread dot (6 px, `--accent`) shows when the tab's chat has unread messages, mentions or a room's unread flag, unless it's the focused half of the active tab.
- The close button: 20 × 20, radius 6, `x` 12. It is invisible until the tab is hovered or active. Hover: `--hover-strong`.

**Tab states.**
- Hover: `--hover`, ink.
- Active: `--card`, ink, `var(--shadow-rest), 0 0 0 .5px var(--hairline)`.
- Pinned: 44 wide, icon only, no close button.
- A joined pair (`.split`):
  - 340 wide (min 200), padding-left 4;
  - two halves (`.tab-half`: 26 tall, radius 7, padding `0 6`, gap 7) with a 1 × 16 hairline between them;
  - in the active pair, the focused half has `--hover`;
  - an inactive pair has an inset 1 px hairline ring;
  - its tooltip is "A  |  B".
- Drop indicators while something is dragged over:
  - a 2 px accent line 3 px outside the tab's left or right edge (top and bottom 6 in);
  - a join: `--accent-tint` with an inset 1.5 px accent ring.
  - The tab's left quarter means before, its right quarter after, and the middle join.

**Interactions.**
- Pressing (mousedown, not click) activates a tab. Pressing a half focuses that half.
- Middle-click closes a tab.
- Right-click activates the tab and opens its menu (S-42):
  - a single tab: Split with › (the other single tabs by title, or a disabled "No other tabs"); Split with a chat… (⌘K in its "Open beside" mode); Pin tab or Unpin tab; Duplicate; Close tab (⌘W); Close other tabs (keeps pinned ones).
  - a pair: Separate split view, instead of the first two.
- Drag a tab to reorder it, or drop it on another's middle to join them.
- Drop a sidebar row before or after a tab to open it as a new tab there, or on a tab's middle to open it beside that tab's pane.
- New tab (+) opens ⌘K in its "Open in a new tab…" mode.
- ⌘1–⌘9 go to that tab (or the last). ⌃Tab and ⌃⇧Tab cycle. ⌘W closes the active tab, or the focused Settings window.
- Closing the last tab leaves a "New tab" showing the empty pane (S-12).

**Motion.** Background, colour and shadow change in .15 s.

**Replaces.**
- `TabBar.svelte` and `TabIcon.svelte`. In the app every pane of the pane tree has its own tab bar, and the tabs move between panes. Here one strip serves the window, and a tab holds one pane or a joined pair (§8.6 on the model).
- The app's tab menu also has **Close to the Left, Close to the Right and Close All**. The prototype's lacks them; keep them.
- Typing in a tab (`TypingMark`) and mention badges on tabs are app features the prototype doesn't draw. Keep a mark for them, beside the unread dot.
- `lib/layout-prefs.ts`'s "Open chats: Tabs on top / Vertical list" chooses where open chats show. The redesign puts tabs in the title bar. The vertical-list option needs a decision (§9).

**States.**
- Default, four tabs with a pair: every main view.
- `S-02-single`.
- `S-02-many` (twelve tabs, scrolled).
- `S-02-pinned`.
- `S-02-hover`.
- `S-02-pair-active`.
- `S-02-pair-tooltip`.
- Drop indicators: `S-68-tab-join`, `S-68-tab-before`.

#### S-03 Sidebar header

**Drawn by.**
- `shell.js`: `D.Sidebar`.
- Classes: `.sb-header`, `.sb-brand`, `.sb-header-actions`.

**Layout.**
- 52 tall, padding `0 8 0 18`, gap 8; a drag area.
- Left: the traffic lights (macOS), or the logo, 22 × 22 with radius 6 (`app-icon-rounded.svg` in light, `app-icon-colored.svg` in dark).
- Right: three icon buttons (30 × 30, radius 9, icon 16, gap 1, ink-2; hover `--hover` and ink; pressed `--hover-strong`):
  - **Calls** (`phone`): opens the call history popover (S-33), aligned to its start.
  - **New chat** (`square-pen`, tooltip "New chat ⌘N"): opens the New conversation sheet (S-44).
  - **Hide sidebar** (`panel-left`, tooltip "Hide sidebar ⌃⌘S").

**Replaces.**
- The top of `SpaceNav.svelte`, and `Header.svelte`'s "DUVET" label.
- "New group" in `DMSidebar.svelte` becomes New chat.
- Calls moves from the Friends page's Calls tab (`FriendsView` → `CallHistory.svelte`) to the popover.

**States.**
- Every main view.
- `S-03-new-chat-tip` (also on win: "Ctrl+N").

#### S-04 Sidebar search field

**Drawn by.**
- `shell.js`: `D.Sidebar`.
- Class: `.sb-search`, with its `.kbd`.

**Layout.**
- A button: 32 tall, margin `0 10 8`, padding `0 6 0 10`, radius 10, gap 8.
- Background `--sb-field`, ring `0 0 0 .5px var(--sb-edge)`; text ink-2, 13 px.
- Contents: `search` 15; "Search or jump to…"; a keycap "⌘K" ("Ctrl+K" off the Mac).
- Hover: ink.

**Interaction.** A click opens ⌘K (S-35).

**Replaces.** The app has no field for this today: ⌘K opens `QuickSwitcher.svelte`, and "Search everywhere" sits on the Friends page. The brief's "as today" refers to ⌘K.

**States.**
- Every main view.
- `S-04-hover`.

#### S-05 Chats section

**Drawn by.**
- `shell.js`: `D.Sidebar`, `ChatRow`, `D.snippet`, `chatMenu`, `rowHandlers`, `D.notifyMenu`.
- Classes: `.sb-scroll`, `.sb-section`, `.sb-section-head`, `.sb-row.friends-row`, `.sb-row-icon`, `.chip-count`, `.chat-row` (`.active`, `.unread`, `.muted`), `.cr-main`, `.cr-top`, `.cr-name`, `.cr-time`, `.cr-bottom`, `.cr-snippet` (`.typing`, `.live`, `.missed`), `.chip-mention`, `.chip-unread`, `.sb-more`.

**Layout.**
- The list (`.sb-scroll`) scrolls, padding `0 8 12`; its sections are 8 apart.
- Under **All**, the section opens with a head, "Chats": 30 tall, padding `8 6 2 10`, `600 11.5px` ink-2, sentence case.

**The Friends row** (44 tall, radius 10, padding `0 10 0 8`, gap 10, `500 13.5px`):
- a 32 px circle (`--secondary-fill`, `users` 16 in accent-text);
- "Friends";
- a count chip with incoming friend requests (`--secondary-fill`, ink, `700 10.5px`, 18 tall; tooltip "2 friend requests").
- It is active (`--accent-tint`) while the Friends page is the focused pane.

**A chat row** (50 tall, radius 12, padding `0 10 0 8`, gap 10):
- **Avatar, 32.** A DM shows the person with their presence, ringed in `--sb-ring`. A group shows its name's Facehash, without presence.
- **Top line:**
  - the name, `500 13.5px/1.25`, ellipsised;
  - `bell-off` 11 in ink-2 when muted;
  - the time, 11 px, tabular, ink-2, pushed right. Today shows the clock ("10:41 AM"), yesterday "Yesterday", the last week the weekday ("Mon"), older the date ("18 Nov"). There is no time while in a call.
- **Bottom line**, gap 6:
  - **The snippet**, `400 12.5px/1.3` Roboto, ink-2, ellipsised. Prefixes: "You: " for yours; "Name: " (first name) in a group.
    - A call: `phone` 12 and "Call · 23 minutes" or "Call · no answer"; a missed call from them: `phone-missed` and "Missed call", in `--destructive`.
    - A sticker: "Sent a sticker". A voice note: `audio-lines` and "Voice note". A photo: `image` and "Photo".
    - A code block reads "Code". Markdown is stripped.
  - **Or "Teo is typing"**, with the dots, in violet (Inter 500).
  - **Or "In a call"**, with `phone-call` 12, in `--live` (Inter 600).
  - Then a mention chip ("@1": `--selected-fill`, violet, `700 10.5px`) and an unread chip (`--accent`, white, `700 10.5px`, 18 tall, radius 9).

**Row states.**
- Unread: the name at 700, the snippet in ink.
- Muted: the name in ink-2, with the bell.
- Active (the focused pane's chat): `--accent-tint`.
- Hover: `--sb-hover`.

**The six-latest rule** (BRIEF, settled 2026-11-18):
- Chats are sorted by their last message, newest first.
- **Under All**, the first six show, plus any unread chat and the open one. Then comes a row "N more chats" (`.sb-more`: 28 tall, padding `0 10 0 17`, `chevron-down` 13, `500 12px` ink-2), which shows them all and turns into "Show fewer" (`chevron-up`).
- **Under Chats**, every chat shows, with no head and no "more" row.
- **Under Spaces**, the section is hidden.

**Interactions** (every sidebar row):
- Click opens in the focused pane.
- ⌘-click or a middle click opens a new tab.
- ⌥-click opens beside (split view).
- Right-click opens the row's menu.
- Rows are draggable (onto a tab or a pane).

The **chat menu**:
- Open in new tab ("⌘-click"); Open in split view ("⌥-click");
- Mark as read; Notifications ›; Start a call;
- then Close chat (a DM) or Leave group (a group, danger).
- The Notifications submenu: Every message, Only mentions, Nothing (checked as set); then Mute for 1 hour, Mute until tomorrow.

**Replaces.**
- `DMSidebar.svelte` (DMs and groups with status, the Notifications submenu, "New group").
- SpaceNav's "Direct messages" row and its optional "Open chats" list.
- `NotificationSubmenu.svelte` and `TypingMark.svelte`.
- The app has a **Default** level for Spaces and rooms, and no timed mute (§7.2).

**States.**
- Default (All, "4 more chats"): every main view.
- `S-05-expanded`.
- `S-05-chats-only`.
- `S-05-row-hover`.
- `S-05-in-call`.
- Typing and unread: every main view.
- A muted chat ("Lisbon in March"): every main view.

#### S-06 Spaces tree

**Drawn by.**
- `shell.js`: `SpaceTree`, `RoomRow`, `VoiceMembers`, `roomMenu`, `D.spaceMenu`, `D.roomIcon`.
- Classes: `.space` (`.open`), `.space-row` (`.unread`, `.active-space`), `.space-caret`, `.space-name`, `.space-more`, `.unread-dot`, `.space-body`, `.cat`, `.cat-row` (`.closed`), `.room-row` (`.active`, `.unread`, `.is-voice`, `.connected`), `.room-icon`, `.room-name`, `.room-live`, `.voice-members`, `.vm-row` (`.speaking`), `.vm-name`, `.vm-muted`, `.live-pill`, `.quiet-row` (`.open`), `.quiet-stack`, `.quiet-chev`, `.quiet-list`, `.sb-head-btn`.

**The section head.**
- "Spaces" (under All only), with a + button: 22 × 22, radius 7, invisible until the section is hovered, tooltip "Join or create a Space".
- Under Spaces only, there's no head.

**Busy and quiet.**
- Busy Spaces show as trees.
- Quiet ones collapse into one row, "N quiet Spaces" (`.quiet-row`, 34 tall):
  - up to three 16 px Space icons stacked (−6 overlap, a 1.5 px `--sb-ring` ring) in a 32 px slot;
  - the label;
  - a `chevron-right` 13 that turns 90° when open.
- Opened, it lists the quiet Spaces as folded trees.
- In the prototype "busy" is a sample flag. The app has its own quiet rule (`lib/nav.ts`); keep it.

**A Space row** (34 tall, radius 10, padding `0 6 0 0`, gap 7):
- a caret button (18 × 24; `chevron-down` 12, turned −90° when folded);
- the Space's icon, 22 (a rounded square, radius 6; its picture, or its initial in Fraunces on its tint);
- its name: Fraunces `500 14.5px/1.2`, opsz 24, `-.005em`; 640 when any room is unread;
- a mention chip (the sum of its rooms' mentions), or a 7 px ink unread dot when folded and unread;
- a … button (24 × 24, radius 7, invisible until the row is hovered; tooltip "Space menu").

**Space interactions.**
- Clicking the row opens the Space's last room in the focused pane (⌘-click: a new tab) and unfolds it.
- The caret only folds and unfolds.
- Right-click or … opens the Space menu: Mark as read; Invite people; Notifications › (Only mentions checked); Members; Emojis and stickers; Space settings… (⌘⇧,); Create room; Leave Space (danger).

**The body.**
- Padding `0 0 4 12`.
- A 1 px `--sb-edge` guide line runs down its left (at left 9, from top 2 to bottom 8).

**A category row** (26 tall, padding `8 8 0 12`):
- `600 10.5px`, uppercase, `.06em`, ink-2, with a `chevron-down` 10 after the name that turns −90° when folded;
- hover: ink;
- a click folds it. A folded category still shows the open room.
- Rooms outside any category show at the top, without a head.

**A room row** (30 tall, radius 9, padding `0 8 0 12`, gap 7, `500 13.5px` ink-2):
- its icon, 15, at 75% opacity: `hash` for a text room, `volume-2` for a voice room, `megaphone` for announcements;
- the name, ellipsised;
- a mention chip;
- for a voice room with people in it that you aren't in: a live dot (7 px `--live`, with a 3 px `rgba(var(--live-rgb), .2)` halo; tooltip "Live now").
- States: unread (ink, 600, the icon at full opacity); active (`--accent-tint`, ink); connected, your voice room (`--live` text); hover `--sb-hover`.
- The **room menu**: Open in new tab; Open in split view; Mark as read; Notifications ›; Invite people; Copy link; Room settings… (opens Space settings → Rooms → that room).

**Who's in a voice room** (`.voice-members`: under its row, indented 30):
- Rows 26 tall, radius 8, padding `0 6`, gap 7, `500 12.5px` ink-2:
  - a 20 px avatar;
  - the name;
  - a "Live" pill when they share their screen (`700 9px`, uppercase, `#E5484D`, white, radius 5, padding `3 5`);
  - `video` 12 when their camera is on;
  - `mic-off` 12 in `--destructive` when muted.
- Speaking: the avatar gets a 2 px `--live` ring, and its Facehash mouth talks; the row turns ink.
- A click opens their profile, to the right.
- You appear in the list once connected.

**Replaces.**
- `SpaceNav.svelte`: the spaces column, with its pinned Spaces, the news group and the folded "quiet" group.
- `ChannelsSidebar.svelte`: the room tree, voice occupants, drag to reorder, and the room and category menus.
- `SpaceEdge.svelte` (auto-hide).
- `NotificationSubmenu.svelte`.
- **App features the prototype doesn't draw, which keep a home here:**
  - pinning a Space to the top, and the news group;
  - dragging rooms and categories to reorder;
  - a category's own menu (Edit Category, Delete Category);
  - "Join or create a Space" (`AddSpaceModal`, behind the + in the head);
  - the app's room menu items, such as Settings for `ChannelSettings` (PARITY.md).

**States.**
- Under All: every main view.
- `S-06-spaces-only`.
- `S-06-folded`.
- `S-06-category-folded`.
- `S-06-quiet-open`.
- `S-06-space-hover`.
- `S-06-add-space-hover`.
- Voice occupants (speaking, Live, camera, muted): every main view, under On Air.

#### S-07 Sidebar bottom: profile row and the All · Chats · Spaces switch

**Drawn by.**
- `shell.js`: `ProfileRow`, `D.profileMenu`, `FilterSwitch`.
- Classes: `.sb-bottom`, `.profile-row`, `.pr-text`, `.pr-name`, `.pr-status`, `.pr-chev`, `.filter-switch`, `.fs-pill`, `.fs-opt` (`.on`), `.fs-dot`.

**Layout.**
- `.sb-bottom`: a column, gap 8, padding `8 10 10`, with a `0 -1px 0 var(--sb-edge)` line above. From the top:
  1. the call panel, in a call (S-08);
  2. the profile row;
  3. the switch.
- The brief puts the media controls above the profile at all times. The prototype doesn't draw them outside a call (§6).

**The profile row** (padding `4 6`, radius 12, gap 10):
- a 30 px avatar with presence, ringed in `--sb-ring`;
- the name, `600 13.5px`;
- a status line, 11.5 ink-2: "Do not disturb", else the custom status, else "Online";
- `chevrons-up-down` 14, ink-2;
- hover: `--sb-hover`.

**The profile menu** (a click opens it above the row, aligned to its start, 268 wide):
- a header: 36 px avatar with presence, the name (`600 14px`), "@handle" (12 px);
- **Online**, a green dot, checked when it's yours;
- **Do not disturb**, a red dot, with the hint "No notices, no sounds";
- Set a custom status… (Settings → Profile);
- Edit profile… (Settings → Profile);
- Settings… (⌘,; Settings → Appearance);
- Switch account;
- Sign out.

**The switch** (`.filter-switch`: 34 tall, padding 3, radius 12, `--sb-field`, `0 0 0 .5px var(--sb-edge)` ring):
- Three equal options: All (`layers`), Chats (`message-circle`), Spaces (`layout-grid`), each `500 12px` ink-2 with a 15 px icon.
- The picked one: accent-text, 600.
- A pill (`--azure-tint`, radius 9) slides under the picked option in 250 ms on `--spring`.
- Tooltips, above: "Chats and Spaces", "Chats only", "Spaces only".
- A 5 px accent dot (top 6, right 9) marks Chats when chats are unread and the switch is on Spaces, and Spaces when rooms are unread and the switch is on Chats.
- The choice is remembered.

**Replaces.**
- `UserStatusBar.svelte`: the user bar with avatar and status menu, mic, deafen, noise suppression and a settings gear; and the voice pill. Its controls become the media controls row (§6) and the call panel (S-08). The gear becomes "Settings…" and ⌘,.
- `StatusMenu.svelte` (Online, Do Not Disturb).
- **The app has no custom status and no account switching**, so "Set a custom status…" and "Switch account" are left out (§7.2). "Log Out" in Settings becomes "Sign out" here.
- **`NowSection.svelte`** (joinable calls, requests, transfers, busy voice rooms, online friends, the voice dock) has no place in the prototype (§6).

**States.**
- With the call panel: every main view.
- `S-07-no-call`.
- `S-07-spaces-dot`.
- `S-07-profile-hover`.
- `S-07-dnd`.
- The menu: `S-42-profile`.

#### S-08 Call panel

**Drawn by.**
- `shell.js`: `CallPanel` (a voice room), `DmCallPanel` (a DM or group call).
- Classes: `.call-panel`, `.cp-top`, `.cp-signal`, `.cp-text`, `.cp-title`, `.cp-sub`, `.cp-leave`, `.cp-controls`, `.cp-btn` (`.off`, `.on`).

**Reach.** Join a voice room. The prototype starts joined to On Air.

**Layout.** `.call-panel`: radius 14, `--sb-card`, `--shadow-rest`, padding 8, gap 8.

*The top row*, gap 8:
- **The signal tile**: 30 × 30, radius 10, `rgba(var(--live-rgb), .14)` with `audio-lines` 16 in `--live`. Its tooltip "Connection: excellent · 24 ms" is the ping.
- **The text, a button:**
  - "Voice connected" (`600 12.5px`, `--live`);
  - "On Air · Night Shift Radio" (11.5 px, ink-2, ellipsised).
  - On hover the second line turns ink and underlines. A click opens the voice room.
- **Disconnect**: 32 × 30, radius 10, `--secondary-fill`, `phone-off` 15 in `--destructive`. Hover: `--destructive` background, white.

*The controls*, a 4-column grid, gap 6. Each button is 30 tall, radius 10, `--secondary-fill`, ink, icon 16.
- **Mute** (`mic` / `mic-off`; "Mute ⌘⇧M" / "Unmute").
- **Deafen** (`headphones` / `headphone-off`; "Deafen ⌘⇧D"). Deafening also mutes.
- **Camera** (`video-off` / `video`; "Turn on camera" / "Turn off camera").
- **Share** (`screen-share` / `screen-share-off`; "Share your screen" / "Stop sharing").
- States: `.off` (muted or deafened) is `rgba(var(--destructive-rgb), .13)` with `--destructive`; `.on` (camera or sharing) is `--accent-tint` with accent-text.
- Hover: `filter: brightness(.97)` plus `inset 0 0 0 100px var(--hover)`.

*A DM or group call:*
- `phone-call` in the tile;
- the title "Calling…" while it rings, then "In a call";
- the second line is the chat's name;
- Hang up ends the call, and the chat gets a call row (S-18).

**What the brief adds that the panel doesn't draw.**
- The brief says the controls "grow into the call panel: where you are, the ping, camera, screen share and Disconnect". Outside a call they are mic with the microphone picker, deafen and noise suppression.
- The panel has **no noise suppression and no microphone picker**, and shows the ping only in a tooltip (§9).
- The pop-out button (desktop only) isn't drawn either (§6).
- The app's pill shows "Ping: N ms" in words. Mobile's VoiceBar shows " · N ms" and turns red at 250 ms or more.

**Replaces.**
- `UserStatusBar.svelte`'s voice pill (room, ping, Disconnect) and its mic, deafen and noise suppression buttons.
- `NowSection.svelte`'s voice dock (Leave).
- The right-click "Input Device" on the mic.

**States.**
- Voice connected: every main view.
- `S-08-muted-deafened`.
- `S-08-camera-share`.
- `S-08-hover-where`.
- `S-08-dm-calling`.
- `S-08-dm-in-call`.

#### S-09 Sidebar resize and hide

**Drawn by.**
- `shell.js`: `D.Sidebar` (`onResize`), `D.TabStrip`.
- Classes: `.sb-resize`, `.main-window.no-sidebar`, `body.resizing`.

**Resize.**
- A 6 px handle runs down the sidebar's right edge (right −3, z 10, `col-resize`).
- Dragging sets the width to the start width plus the drag, held between 232 and 380.
- While dragging, `body.resizing` forces the `col-resize` cursor everywhere and stops text selection.
- The width is remembered (default 288). There's no double-click reset.

**Hide.**
- The header's Hide sidebar button, or ⌃⌘S on macOS.
- The main column then loses its left edge line. The tab strip opens with:
  - on macOS, the traffic lights and a Show sidebar button (`panel-left`, "Show sidebar ⌃⌘S");
  - on Windows, Linux and the web, the Show sidebar button alone, whose tooltip says "Ctrl+Shift+S". The prototype doesn't handle that key (§9).

**Replaces.**
- The app's spaces column is a fixed 280 px.
- Its "Spaces column: Fixed / Auto-hide" preference, with `SpaceEdge.svelte`'s 60 px edge that reveals the column on hover, has no counterpart in the prototype. It needs a home or a decision (§9).
- The pane bar's "Hide rooms" toggle.

**States.**
- `S-09-narrowest`.
- `S-09-widest`.
- `S-09-hidden`, also on win, linux and web.

### Panes

#### S-10 Panes and split view

**Drawn by.**
- `pane.js`: `D.Panes`, `Pane`.
- `app.js`: `D.openRef`, `D.openInSplit`, `D.openInNewTab`, `D.replacePane`, `D.closePane`, `D.unsplit`, `D.joinTabs`.
- Classes: `.panes`, `.pane-slot`, `.pane` (`.in-split`, `.focused`), `.gutter`, `.drop-zones` (`.here`, `.split`), `.dz`, `.dz-here`, `.dz-split`.

**Reach.**
- ⌥-click a sidebar row.
- A row's "Open in split view".
- ⌘\ ("Open beside…").
- A tab's "Split with ›".
- Drop a row on a pane's right side.

**Layout.**
- A tab shows one pane, or two side by side.
- Between two panes runs a **gutter**: a 9 px hit area (margin `0 -4`, z 7, `col-resize`) with a 1 px hairline. On hover the line becomes 3 px of `--accent-tint` (.15 s).
- **The split's ratio** belongs to the tab:
  - 0.5 by default; a voice room and its chat open at 0.6;
  - dragging holds it between 0.28 and 0.72;
  - a double-click resets it to 0.5.
- **A pane** is a column on `--base` with `container-type: inline-size`, so its header compacts by container queries (S-11), and `overflow: hidden`.

**Focus.**
- Pressing anywhere in a pane focuses it.
- In a split, the unfocused pane's header title, avatar and Space icon fade to 55%.

**Opening rules.**
- A click replaces the focused pane.
- "Beside" on a single pane adds a right pane and focuses it. On a split, it replaces the other pane.
- The same chat twice in a split collapses to one pane.
- "Close this side" (the header's × or More) leaves one pane.
- The tab's "Separate split view" makes two tabs.

**Drop zones** (dragging a sidebar row over a pane):
- They cover the pane below its header (`inset: 52px 0 0`, padding 10, gap 10).
- Each zone: radius 18, `--accent-tint`, 35% opacity. The one under the pointer is at 100% with an inset 2 px accent ring.
- Each carries a chip (`--card`, `--shadow-float`, radius 12, `600 13px` accent-text): `app-window` with "Open here", or `columns-2` with "Open beside".
- On a single pane, the right 40% means beside. On a split, there's only "Open here".

**Replaces.**
- `PaneView.svelte` and `lib/pane.ts`. The app's pane tree splits **horizontally and vertically**, nests, holds tabs in each pane, has drop zones on four sides ("← Split left"…), and is saved in localStorage (`duvet.openRooms.v1`).
- The prototype has one level: two panes side by side, per tab.
- That loses vertical splits and more than two panes, both of which the app has. Make room for them, or report the loss (§8.6, §9).

**States.**
- ★ `S-10-split` (a DM beside a group, the right one focused).
- `S-10-gutter-hover`.
- `S-10-narrow-left`.
- Drop zones: `S-68-pane-beside`, `S-68-pane-here`.

#### S-11 Pane header

**Drawn by.**
- `pane.js`: `PaneHeader`, `HeaderTitle`.
- Classes: `.pane-header` (`.scrolled`, `.unfocused`), `.ph-title-btn` (`.static`), `.ph-text`, `.ph-title`, `.ph-room-icon`, `.ph-title-dim`, `.ph-sub`, `.ph-glyph`, `.ph-actions`, `.ph-members`, `.ph-search` (`.has-text`), `.ph-close-split`.

**Layout.**
- The header lies over the top of the pane: absolute, 52 tall, z 5, padding `0 10 0 12`, gap 10.
- At rest it is clear, at the top of a list. Once the list scrolls more than 4 px it turns `--glass-strong` with `blur(24px) saturate(1.8)` and a hairline under it (.2 s).
- A voice room's header, and a DM's during a call, are always in that scrolled look.

**The title** is a button, padding `4 10 4 4`, radius 12, gap 10, hover `--hover`:
- **A DM.**
  - Their 28 px avatar with presence (ring `--header-ring`).
  - The name: Fraunces `500 16.5px/1.15`, opsz 36, `-.012em`.
  - Under it (`400 11.5px` ink-2): "Online", "Do not disturb" or "Offline", then " · " and their custom status.
  - A click opens their profile (S-39).
- **A group.**
  - Its 28 px Facehash, the name, and "5 members · 4 online".
  - A click opens the members popover (S-38).
- **A room.**
  - The Space's 28 px icon.
  - The title: the room's icon (15, ink-2) and its name.
  - Under it: "Night Shift Radio · Tonight: rain on the window" (the Space · the topic).
  - A click opens the Space menu.
- **A voice room's chat** (a room pane on a voice room): the title has `message-circle`, the name, and " chat" in ink-2.
- **Friends.** A static title: a 28 px circle (`--secondary-fill`, `users` 16), "Friends", and "9 online".

**The actions** (icon buttons 30 × 30, gap 2), from the left:
- **A DM or group:** Start a call (`phone`); Start a video call (`video`).
- **A voice room:** "Open the room's chat beside" (`message-circle`), active while the chat is open beside it.
- **Not Friends, not voice:** Pinned messages (`pin`) → S-37.
- **A group or a room:** the members button (`.ph-members`):
  - 30 tall, padding `0 9 0 7`, radius 9, `500 12.5px` ink-2;
  - up to three 18 px faces overlapping, then the count ("214"; over 999: "18.4k");
  - → S-38.
- **Not Friends, not voice:** the search field (`.ph-search`):
  - 168 × 30, padding `0 10`, margin `0 4`, radius 9, `--field-bg`, `search` 14, placeholder "Search";
  - focused or holding text: 240 wide, `--card`, `0 0 0 3px var(--accent-tint), 0 0 0 1px var(--hairline)` (.22 s);
  - → S-36.
- **More** (`ellipsis`) → the pane's menu (S-42):
  - Notifications ›; Mark as read;
  - in a room, Invite people;
  - Split with a chat… (⌘\), or in a split Close this side;
  - Open in new window; Copy link;
  - in a room, Room settings…;
  - in a group, Leave group (danger).
- **In a split:** Close this side (`x`).

**Compaction** (container queries on the pane):
- ≤ 620 px: the search field becomes a 30 px icon button (190 wide once focused), and the members button drops its count.
- ≤ 480 px: the members button goes.

**Replaces.**
- The pane bar in `PaneView.svelte`: the tab bar or a title; pins; search; members faces; Hide rooms and Hide members toggles; Split horizontally and Split vertically; Close pane.
- `ConversationView.svelte`'s header: Start call; **Add member**; Members; pins; search; group options (**Rename group**, Leave group).
- `MembersButton.svelte`, `PinnedMessages.svelte`'s button, `MessageSearch.svelte`'s box.
- **To keep a home for:** Add member and Rename group (the group's More); vertical split; the Hide rooms and Hide members toggles. The members column goes (S-38), so those toggles may go too: a decision (§9).
- "Start a video call" starts a call with the camera on. The app starts calls voice-first and turns the camera on in the call. A separate button is a proposal (§7.2).
- "Open in new window" opens a chat in a second OS window, which the app can't do (§7.2).

**States.**
- DM: ★ `S-13-dm`.
- `S-11-group`.
- `S-11-room`.
- `S-11-voice` (voice room and its chat).
- `S-11-at-rest` (clear, at the top).
- Friends: ★ `S-34-online`.
- Unfocused and split: ★ `S-10-split`.
- Compact: `S-10-narrow-left`.
- Search focused: `S-36-focused`.

#### S-12 Empty pane

**Drawn by.**
- `pane.js`: `EmptyPane`.
- Classes: `.empty-pane`, `.ep-title`, `.ep-sub`, `.ep-recents`, `.chip`.

**Reach.** Close every tab; a "New tab" remains.

**Layout.** A centred column, gap 8, padding 40:
- the `hello` mascot at 112;
- "Where to?" (Fraunces `400 24px/1.2`, opsz 72; margin-top 6);
- "Pick a chat or a room in the sidebar, or press ⌘K" (13 px ink-2, with a keycap);
- recent chats as chips, margin-top 14, gap 8, wrapping:
  - each 34 tall, padding `0 12 0 8`, radius 12, `--card`, `--shadow-rest`, `500 13px`;
  - with an 18 px icon;
  - hover: `--shadow-raised`.

**Replaces.** `PaneView.svelte`'s empty state, "Drag a room here".

**States.** ★ `S-12-empty`.

### Messages

#### S-13 Messages in bubbles

**Drawn by.**
- `messages.js`: `D.MessageList`, `Message`, `D.renderText`, `usePrism`, `D.updatePrism`.
- `pane.js`: `ConversationView`, `Intro`.
- Classes: `.msg-scroll`, `.msg-inner`, `.chat-intro`, `.ci-title`, `.ci-sub`, `.ci-glyph`, `.day-sep`, `.new-sep`, `.msg-row` (`.mine`, `.theirs`, `.first`, `.last`, `.with-avatar`, `.has-react`, `.has-thread`, `.flash`), `.msg-avatar`, `.msg-col`, `.msg-author`, `.bot-tag`, `.bubble` (`.their`, `.own`, `.prism`, `.editing`), `.bubble-text`, `.edited`, `.msg-time`, `.jumbo`, `.sticker`, `.prism-light`, `.prism-rim`.

**Reach.** Open any chat with Messages: Bubbles (the default; Settings → Appearance → Messages).

**The list.**
- `.msg-scroll` scrolls (`overscroll-behavior: contain`).
- Its inner column is at least as tall as the pane and stacks to the bottom (`justify-content: flex-end`), so a short chat sits above the composer.
- Padding: 60 at the top (14 under a call stage), `--pad-x` at the sides (`clamp(16px, 3.2%, 40px)`), `--composer-h` + 14 at the bottom.

**The intro**, at the top of every chat (centred, gap 6, margin `24 0 18`):
- a DM: their 64 px avatar; their name (Fraunces `400 22px/1.15`, opsz 72); "This is the start of your chat with Mara." (12.5 px ink-2);
- a group: its 64 px Facehash; its name; "The start of the group.";
- a room: a 56 × 56 tile (radius 18, `--secondary-fill`, the room's icon 28 in ink-2); "Welcome to #general"; its topic, or "The start of this room.".

**Day separators.**
- Each day opens with a centred label: `600 11.5px` ink-2, margin `18 0 8`.
- The label reads "Today", "Yesterday", a weekday within the week, else "Monday, 10 November".
- They stay in place in the list: they don't stick (BRIEF).

**"New messages".**
- Before the first unread message (`500 11.5px` ink, margin `16 0 8`): the label between two hairlines, gap 12.

**Rows and groups.**
- A row is `display: flex`, aligned to the bottom, gap 8, padding `1 0`. Yours are reversed, to the right.
- A message joins the one before it when it is from the same person, less than 5 minutes later, on the same day, and not across the "New messages" line. A system row (S-18) breaks a group.
- A group's first row has margin-top 10 (compact 6).

**Avatars and names** (groups and rooms only, never in a DM, never yours):
- **The avatar** (28 px) sits beside a group's **last** bubble, as on mobile. It lines up with the bubble's foot, above the time.
  - Its margin-bottom: 18 normally; 47 with reactions; 49 with a thread chip; 78 with both.
- **The sender's name** sits above the group's first bubble:
  - `600 12.5px/1.2` Inter in ink-2, or the top role's colour (a gradient fills the text for a gradient role);
  - followed by a BOT tag for bots (`700 9px`, `--accent`, white, radius 4, padding `3 4`);
  - hover underlines it; a click opens the profile, to the right.

**The column** is a column, gap 4, at most **65%** of the row. Yours align right.

**A bubble.**
- Padding `8 12` (compact `6 11`), radius 16.
- Text: Roboto `400 var(--msg-size)/1.4`, 15 px by default; long words wrap anywhere.
- Theirs: `--card` with `--shadow-rest`. Yours: `--own-bubble` (azure, or your colour) in `--own-ink`, with `--shadow-rest`.
- Being edited: a 2 px accent ring.
- "(edited)" follows the text, `400 11px` Inter at 60%.
- A double-click starts a reply.

**The time** (`400 11px/1.3` ink-2, tabular, padding `0 4`) shows under a group's last bubble only. The others' times show in the hover bar (S-20).

**Jumbo emoji.**
- A message of emoji only (up to 24 characters, no digits, `#` or `*`) has no bubble.
- It is set in Twemoji at 40 px (line height 1.15).

**A sticker.** 136 × 136, contained, no bubble; its name as a tooltip. The mascot stickers follow the theme.

**Prism** (a mention of you in someone else's bubble; bubbles only):
- The bubble turns `--card` with `--shadow-rest, --prism-shadow`.
- **Its light** (`.prism-light`) is three soft radial ellipses:
  - 170 × 80 at the mention's centre (`--mx`, `--my`), in `--prism-gem`;
  - 120 × 50 at (`--cx`, 70%), in `--prism-cool`;
  - 90 × 40 at (`--wx`, 100%), in `--prism-warm`.
  - All three scale by `--ps`. The side lights slide as the bubble moves up the list (§8.9).
- **The rim** (`.prism-rim`): a 1 px border drawn as a 135° gradient through `--rim-0` … `--rim-3`, cut to the edge with a mask (`mask-composite: exclude`).
- The light fades in over 900 ms after 250 ms (reduced motion: shown at once).
- The mention of you is bold (`.mention.me`).

**The flash.** A message jumped to (from a reply strip, a pin, a search result or a notice) flashes: a 3 px accent ring that holds, then fades over 1.6 s. It applies to bubbles, photo grids, cards, voice notes and stickers.

**Replaces.**
- `MessageList.svelte`: grouping, the "N new messages" divider, "Newer messages below" after a jump, the hover bar, pin and call notices, the author's menu, the thread modal.
- `MessageText.svelte` ("(edited)", message-link chips, invite buttons).
- `AuthorTag.svelte` (BOT **and WEBHOOK** tags: keep WEBHOOK).
- `ChatIntro.svelte`. The app's intro has an invite action; keep it.
- **The app has no bubbles today: every message is a flat row.** Bubbles by default is the brief's change.
- **Keep the app's scroll anchoring and on-screen rendering.** The prototype renders the whole list; the app doesn't (`scroll-anchoring`, `on-screen`; §8.2).

**States.**
- ★ `S-13-dm` (DM, at the bottom).
- `S-13-dm-top` (the intro, a day separator, two photos with a reaction).
- `S-13-dm-prism` (a mention of you, a quote, a reply, the jump button).
- `S-13-group` (avatars, names, the New messages line, typing).
- `S-13-group-middle`.
- `S-13-room` (role colours, a gradient name, a bot, a thread).
- `S-13-room-prism`.
- `S-13-long-text` (a long message capped at 65%).
- Compact: `S-69-compact`. Another bubble colour and text size: `S-69-bubble-colour`.
- The flash: `S-19-jump-flash`.

#### S-14 Messages in flat rows

**Drawn by.**
- `messages.js`: `Message` (its `layout === 'flat'` branch).
- Classes: `.layout-flat`, `.flat-row` (`.head`, `.mentioned`, `.flash`), `.flat-gutter`, `.flat-hover-time`, `.flat-body`, `.flat-head`, `.author`, `.flat-time`, `.flat-text`.

**Reach.** Settings → Appearance → Messages → Flat rows (or Tweaks → Messages).

**Layout.**
- The list's side padding is `--pad-x` − 8.
- A row is a grid, `52px 1fr`, padding `3 8`, radius 12. Hover: `--hover-soft`.

**A head row** (margin-top 12, padding-top 6; compact: margin 8) starts:
- when the author changes;
- after a system row;
- after a gap of more than 7 minutes;
- on any reply.

Its gutter holds the 36 px avatar (a click opens the profile). Its head line, aligned on the baseline, gap 8:
- the name, `600 14px/1.2` Inter, in the role's colour;
- a BOT tag;
- the time, `400 11.5px` ink-2: "Today at 9:14 AM" for today, else the time alone.

**A continuation row's** gutter shows its time without AM/PM (`400 10.5px` ink-2, padding-top 5), on hover only.

**The body.**
- A column, gap 4.
- Text: Roboto `400 var(--msg-size)/1.45`, at most 760 wide.
- Photos, cards, voice notes and files at most 420.

**Differences from bubbles.**
- DMs show names and avatars.
- A mention of you washes the whole row: `radial-gradient(420px 80px at 60px 50%, var(--prism-gem), transparent)` and `radial-gradient(260px 60px at 220px 80%, var(--prism-cool), transparent)`. There's no rim and no animation.
- The flash is an `--accent-tint` background that fades over 1.6 s.
- The hover bar sits along the row's top edge (S-20).

**Replaces.** `MessageList.svelte`'s rows, the app's only layout today.

**States.**
- ★ `S-14-room` (a room).
- `S-14-dm`.
- `S-14-hover` (a continuation row hovered).
- `S-14-mention`.

#### S-15 Message text

**Drawn by.**
- `messages.js`: `D.renderText`, `inline`, `highlight`, `Spoiler`.
- Classes: `.line`, `.mention` (`.me`), `.room-mention`, `.link`, `.code-inline`, `.code-block`, `.code-lang`, `.tok-key`, `.tok-val`, `blockquote`, `.spoiler` (`.open`).

**Inline:**
- `` `code` ``: Fira Mono `.86em`, padding `2 5`, radius 5, `--field-bg`; in your bubble `rgba(255,255,255,.18)`.
- `**bold**`, `__underline__`, `*italic*`, `~~strike~~`.
- `||spoiler||`:
  - **closed**, the text is transparent on a drift of specks: two radial-dot patterns, 4 px and 5 px, in `--speck` (ink-2; in your bubble `rgba(255,255,255,.85)`) over `--field-bg`, moving (`specks` 3 s linear); radius 5, padding `0 2`;
  - a click opens it: `--field-bg` with the text showing.
- **Links** show without their scheme, in accent-text, no underline (underlined on hover). In your bubble they inherit the colour and underline.
- **@mentions** are bold, in the person's role colour within a Space. A click opens the profile. The mention of you is `.mention.me` (Prism's anchor).
- **#rooms** are chips:
  - inline-flex, padding `0 5 0 3`, radius 6, `--accent-tint`, accent-text, 500, with `hash` 12;
  - in your bubble: `rgba(255,255,255,.2)`, inheriting the colour;
  - a click opens the room.

**Blocks:**
- **A fenced code block:**
  - margin `4 0 2`, padding `10 12`, radius 10, `--code-bg`, Fira Mono `12.5px/1.5`, `white-space: pre`, scrolling sideways;
  - in your bubble: `rgba(0,0,0,.18)`;
  - its language in the top right corner (`500 10px` uppercase `.06em` ink-2, at top 6, right 8);
  - YAML-ish keys in accent-text, values in violet (in your bubble: inherited).
- **`> quote` lines** become one block: margin `2 0 4`, padding `6 10`, radius 10, `--field-bg` (yours `rgba(255,255,255,.16)`).
- **Lines** are one block each (`min-height: 1em`); an empty line keeps its height.

**Replaces.**
- `lib/markdown.ts` and `MessageText.svelte`.
- **The app does more.**
  - Markdown: headings (`#`, `##`, `###`), `-#` subtext, lists, tables, `>>>` quotes, message-link chips.
  - Code: Shiki highlighting in a light and a dark theme, line numbers, a copy button on hover (`lib/code-copy.ts`), and a custom code theme by URL.
- Keep all of it, drawn in the prototype's language: code on `--code-bg` with radius 10; chips like room chips.
- The spoiler's specks replace the app's flat grey cover.

**States.**
- `S-15-code-spoiler`.
- `S-15-spoiler-open`.
- `S-15-bold-quote-rooms`.
- `S-15-inline-code`.

#### S-16 Attachments

**Drawn by.**
- `messages.js`: `Attachments`, `VoiceNote`.
- `pane.js`: the recording composer, for your own notes.
- Classes: `.tiles`, `.tiles-1`/`-2`/`-3`, `.tile`, `.tile-play`, `.tile-dur`, `.file-card`, `.file-icon`, `.file-meta`, `.file-name`, `.file-size`, `.voice` (`.mine`), `.voice-play`, `.voice-wave`, `.voice-time`, `.voice-speed`.

**Photos and videos** (`.tiles`: a grid, gap 3, radius 16, clipped, 360 wide, `--shadow-rest`):
- **One:** at its own aspect ratio, at most 380 tall.
- **Two:** side by side, the grid at `2 / 1.15`.
- **Three:** `2fr 1fr` over two rows, the first spanning both, the grid at `3 / 2.1`.
- **Four or more:** not designed (§9).
- Each tile: `--sunken` behind it, cover-cropped. Hover scales the image to 1.03 (.35 s).
- **A video** has:
  - a play disc: 52, `--media-scrim`, `blur(12px)`, `--media-ink`, `play` 22, inset 1 px `rgba(255,255,255,.12)`;
  - its length in a chip at bottom left: `--media-scrim`, `600 11px`, radius 8, padding `3 7`.
- A click opens the media viewer (S-41).

**A file** (`.file-card`: padding 10, radius 16, `--card`, `--shadow-rest`, 300 wide, gap 10):
- a 40 × 40 tile (radius 12, `--secondary-fill`, `file-text` 20 in accent-text);
- the name (`600 13.5px`, ellipsised);
- "2.4 MB · PDF" (11.5 px ink-2);
- a Download icon button.

**A voice note** (`.voice`: padding `7 10 7 7`, radius 18, `--card`, `--shadow-rest`, 300 wide, gap 10):
- **Play:** a 34 px circle in `--accent` with a white `play` or `pause` 16, `--shadow-control`. On yours, a white circle with the icon in your bubble colour.
- **The waveform:** 44 bars, 2.5 wide, gap 2, 4 + 20 × level tall. They are `currentColor` at 30%; played bars are at 100%, in accent-text on theirs. A click on it seeks.
- **The time:** `500 11.5px` tabular. It shows the length at rest and the position while playing.
- **The speed chip:** "1×", `700 10px`, padding `4 6`, radius 6, `--field-bg`.
- **Yours:** `--own-bubble` with `--own-ink`.

**Replaces.**
- `MessageAttachments.svelte`, `VoiceNotePlayer.svelte`, `AudioFilePlayer.svelte`, `SpoilerCover.svelte`.
- **Not drawn: audio files, spoilered files, and more than three photos.** Draw them in the same language (§6).
- **Videos play inline in the app today** (`<video>`). The prototype's video tile opens the viewer instead. Which one stays is a decision; the current behaviour stays until it's made (§7.2).
- The voice-note **playback bar** isn't drawn (§6).

**States.**
- Two photos: `S-13-dm-top`.
- `S-16-three-photos`.
- `S-16-portrait`.
- A video: ★ `S-13-dm`.
- `S-16-file-card`.
- `S-16-voice-note`.
- `S-16-voice-playing`.
- `S-16-voice-own`.

#### S-17 Embeds

**Drawn by.**
- `messages.js`: `Embed`.
- Classes: `.card`, `.embed-link`, `.embed-site`, `.embed-title`, `.embed-desc`, `.embed-image`, `.embed-spotify`, `.sp-*`, `.embed-yt`, `.yt-thumb`, `.yt-play`, `.yt-meta`, `.yt-title`, `.embed-invite`, `.inv-*`, `.dot-live`, `.embed-bot`, `.bot-head`, `.bot-status` (`.ok`, `.fail`), `.bot-title`, `.bot-fields`, `.bf-k`, `.bf-v`, `.bot-buttons`.

All cards are `--card`, radius 16, `--shadow-rest`. A message that is only a link with a preview hides the link's text.

**A link** (380 wide, padding `12 14 14`, gap 4):
- the site (`500 11.5px` ink-2);
- the title (`600 14.5px/1.3` ink; underlined on hover);
- the description (Roboto `400 13px/1.45` ink-2, three lines at most);
- a 16:9 image, radius 12, margin-top 8.

**Spotify** (360 wide, padding `10 12 10 10`, gap 12):
- 64 px art, radius 10;
- "Spotify" with its green mark (`500 11px` ink-2);
- the title (`600 14px`);
- "Artist · Album" (12.5 px ink-2);
- a 34 px Play circle (`--secondary-fill`; "Play preview").

**YouTube** (380 wide, clipped):
- a 16:9 thumbnail (hover: scale 1.03) with the YouTube mark at 44 px, centred (`#FF0033`, drop shadow);
- the length in a chip;
- under it (padding `10 14 12`): "YouTube · Channel" and the title (`600 14px/1.3`).
- In the prototype a click opens a floating player (S-70, scaffolding). **On desktop, embeds play inside their message, as they do today** (`EmbedPlayer.svelte`).

**A Space invite** (340 wide, clipped):
- a 96 px banner (cover; `--secondary-fill` without one);
- then, with padding `0 14 14` and gap 3:
  - the Space's 44 px icon, raised 22 over the banner, with a 3 px `--card` ring;
  - "INVITE TO A SPACE" (`600 10.5px`, `.06em`, ink-2);
  - the name (Fraunces `500 18px`, opsz 36);
  - a live dot and "77 online · 1,290 members" (12.5 px ink-2);
  - the description (Roboto 13 px ink-2, two lines);
  - a full-width primary **Join**. Once joined it's a secondary **Open**, and a toast.

**A bot's embed** (400 wide, padding `12 14`, gap 6):
- a head: a status icon (`circle-check` in `--live`, or `circle-x` in `--destructive`, 16) and the title (`600 14px/1.3`);
- the description;
- fields in two columns, gap 8: the key `600 10.5px`, uppercase `.05em` ink-2; the value Roboto 13 px;
- small buttons, primary or secondary, gap 6.

**Replaces.**
- `EmbedCard.svelte`: author, title, description, fields, footer, thumbnail, image or video, and a solid or gradient border colour. Keep the border colour.
- `EmbedPlayer.svelte` (YouTube and TikTok inline).
- `InviteEmbed.svelte` ("Join Space").
- `BotInviteEmbed.svelte` ("Add to Space").
- `MessageLinkEmbed.svelte`.
- `MessageComponents.svelte` and `ComponentSelect.svelte` (bot components: containers, sections, selects, galleries, files, separators).
- `DeferredResponse.svelte` (a bot "thinking…").
- **The app has no Spotify card:** a Spotify link is a generic link preview (§7.2).

**States.**
- `S-17-link-spotify`.
- `S-17-youtube-invite`.
- `S-17-invite-joined`.
- `S-17-bot-fields`.
- `S-17-bot-status`.

#### S-18 System rows

**Drawn by.**
- `messages.js`: `SystemRow`.
- Classes: `.sys-row` (`.missed`), `.sys-time`, `.link-btn`, `.wave-btn`.

**Layout.** Centred, wrapping, gap 6, margin `12 0`, `400 12.5px/1.3` Inter ink-2:
- an icon, 14:
  - `phone` for a call;
  - `phone-missed` in `--destructive` for a missed one;
  - `pin` for a pin;
  - `user-plus` for someone joining or being added;
- the text: "Mara started a call that lasted 23 minutes", "You started a call. No one answered.", "Felix pinned a message", "Lior joined the Space. Say hi!", "Sol added Felix to the group", "Missed call from Ines";
- the time (11 px, 75%);
- an action:
  - a pin: "See all" (`500` accent-text), which opens Pins;
  - a join: "👋 Wave" (24 tall, padding `0 9`, radius 8, `--secondary-fill`, `500 12px`);
  - a call: "Call back".

**Replaces.**
- `MessageList.svelte`'s pin and call notices. The app's message types are Text, Voice, PinNotice and Call (`lib/types`).
- **The app has no join or "added" messages, no Wave, and no Call back** (§7.2).

**States.**
- `S-18-calls`.
- `S-18-added-pinned`.
- `S-18-joined-wave`.
- `S-18-missed`.

#### S-19 Replies, reactions, threads

**Drawn by.**
- `messages.js`: `ReplyStrip`, `Reactions`, the thread chip in `Message`.
- Classes: `.reply-strip`, `.reply-name`, `.reply-text`, `.reactions`, `.react` (`.mine`), `.react-e`, `.react-add`, `.thread-chip`.

**A reply strip** sits above the reply:
- `corner-up-left` 12, then "@Mara" (`600`, ink, in the role colour; "@you" for yours), then the quoted text (Roboto, ellipsised); `400 12.5px/1.3` ink-2, padding `0 4`.
- With no text, it reads Photo, Voice note, File, the link's title, or Sticker.
- Hover: ink.
- A click jumps to the original, which flashes (S-13).

**Reactions** (below the bubble; wrapping, gap 4; yours are right-aligned):
- A chip: 24 tall, padding `0 8`, radius 12, `--secondary-fill`, ink-2, `600 11.5px`; the emoji in Twemoji at 14.
- Yours: `--selected-fill`, violet.
- Hover: up 1 px. Press: scale .96 (.12 s).
- The tooltip names who reacted: "you, Sol, Felix", "… and 3 more", or "9 people".
- A click toggles yours.
- An Add reaction chip (`smile-plus` 14) appears when the row is hovered.

**A thread chip:**
- padding `6 10`, radius 12, `--card`, `--shadow-rest`;
- `messages-square` 14; "3 replies" (`600` accent-text); the last reply (12.5 px ink-2, ellipsised);
- hover: `--shadow-raised`;
- a click opens the thread (S-40).

**Replaces.**
- `MessageReference.svelte`: the replied-to quote, or who used a bot command. Keep the bot-command form.
- `MessageReactions.svelte`. Its right-click lists who reacted (`ReactionsDialog.svelte`); keep that.
- `ReactionCount.svelte` (the rolling count) and `ReactionEmoji.svelte`.

**States.**
- Replies and reactions: `S-13-dm-prism`, `S-13-group-middle`.
- `S-19-reaction-tip`.
- `S-19-reacted`.
- `S-19-jump-flash`.
- `S-19-thread-chip`.

#### S-20 Hover bar

**Drawn by.**
- `messages.js`: `HoverBar`.
- Classes: `.hoverbar`, `.hb-time`, `.hb-emoji`, `.hb-sep`.

**Layout.** Glass, padding 3, radius 12, gap 1. From the left:
1. The time (`500 11px` ink-2, tabular, padding `0 6`) and a separator. Only on a bubble that isn't its group's last.
2. Three quick reactions, 😂 ❤️ 👍: each 28 × 28, radius 8, Twemoji 16; hover `--hover` and scale 1.12; tooltip "React 😂".
3. A separator (1 × 18 hairline, margin `0 3`).
4. Add reaction (`smile-plus`).
5. Reply ("Reply R").
6. Edit, on your own text only ("Edit E").
7. More (`ellipsis`): the message menu (S-21), aligned to its start for yours and its end for theirs.

The buttons are 26 × 26, radius 8, icon 15.

**Placement** (BRIEF: "beside the bubble; on a flat row, along its top edge"):
- **Theirs:** centred on the column's height, 8 px to the right of the column.
- **Yours:** 8 px to its left, the buttons in reverse order.
- **A group's last bubble:** 10 px higher, clear of the time.
- **A flat row:** 16 px above the row's top, 14 px from its right.

**Motion.**
- It shows on row hover: opacity in .12 s, sliding 4 px in .18 s on `--decelerate`.
- It takes pointer events only while shown.

**Replaces.** `MessageList.svelte`'s hover action bar. In the app it holds Add reaction, Reply, Copy message link, View thread, Pin/Unpin, Edit, Reactions and Delete. The prototype moves most of them into More. Each stays one click or two away.

**States.**
- `S-20-theirs`.
- `S-20-mine`.
- `S-20-mid-group`.
- A flat row: `S-14-hover`.

#### S-21 Message menu

**Drawn by.**
- `messages.js`: `D.messageMenu`.
- `overlays.js`: `Menu`, its `.menu-reactions` row.

**Reach.** Right-click a message, or More in its hover bar.

**Contents.**
1. A row of reactions (😀 🙂 🤭 👍 ❤️): 36 × 36, radius 10, Twemoji 22; hover scale 1.15 on `--overshoot`. Then More reactions (`smile-plus`), pushed right. The row has padding `2 2 6` and a hairline under it.
2. Reply (R).
3. View thread, if it has one.
4. Copy text (⌘C), if it has text.
5. Copy link.
6. Mark unread.
7. Edit (E), your own text only.
8. Pin, or Unpin.
9. A separator, then **Delete** (⌫, danger), your own only.

A right-click opens the menu at the pointer.

**Replaces.**
- There is **no message menu in the app**. Every action is in the hover bar, plus the author's menu (Send Friend Request, Copy User ID, Kick, Ban, and the staff-only Edit Flags & Badges).
- **Copy text and Mark unread don't exist** (§7.2).
- Keep everything the app has: delete for moderators, who reacted, Reactions, Copy message link, and the author's menu (S-39).

**States.**
- `S-21-theirs`.
- `S-21-mine`.
- `S-21-thread`.

#### S-22 Jump to latest

**Drawn by.** `pane.js`, `ConversationView`. Class: `.jump-latest`, `.jl-count`.

**Layout.**
- A 40 × 40 glass circle with `arrow-down` 16, in ink.
- It sits at right `--pad-x` + 2, bottom `--composer-h` + 12, z 5.
- It pops in (`pop`, .28 s `--overshoot`) once the list is more than 320 px from its bottom.
- A count chip at its top right (−4, −4; `--accent`, white, `700 10.5px`, 18 tall) shows unread and mentions.
- A click scrolls smoothly to the bottom.

**Replaces.** The app has no button: "Newer messages below" after a jump, sending a message, and the `G` key take you to the present. The button is new UI for an existing move.

**States.**
- `S-22-count`.
- Without a count: `S-13-dm-prism`.

### Composer

#### S-23 Composer and its strips

**Drawn by.**
- `pane.js`: `Composer`, `placeholder`.
- Classes: `.composer` (`.over`), `.composer-field` (`.recording`), `.cf-btn` (`.danger`), `.send` (`.on`), `.composer-strip` (`.editing`), `.cs-snip`, `.typing-line`, `.typing-dots`, `.rec`, `.rec-dot`, `.rec-time`, `.rec-wave`, `.rec-hint`.

**The bar.**
- Absolute at the pane's foot, z 4, padding `8 --pad-x 14`.
- `--glass` with `blur(20px) saturate(1.8)` and a hairline above it.
- The list scrolls under it.

**The field.**
- Min 42 tall, padding `0 4`, radius 20, `--card`, `var(--shadow-well), 0 0 0 1px var(--hairline)`.
- Focused, it adds a 4 px `--accent-tint` ring (.15 s).
- Its items align to the bottom. From the left:
  1. **+** (`plus` 18) → S-24.
  2. **The text**: Roboto `400 var(--msg-size)/1.4`, padding `10 6`. It grows with what's typed, up to 132 px, then scrolls. Its placeholder:
     - "Message Mara" (a DM, the first name);
     - "Message Sunday Soup Club" (a group);
     - "Message #general" (a room);
     - "Message the On Air chat" (a voice room's chat);
     - "Edit your message" (while editing).
  3. **Emoji** (`smile-plus` 18; "Emoji, GIFs and stickers ⌘E") → S-26.
  4. **Send** (34 × 34, radius 12):
     - empty, it's a microphone ("Record a voice note") in ink-2;
     - with text, a cobalt square with a white `arrow-up` and `--shadow-control` ("Send Enter");
     - editing, `check` ("Save Enter");
     - press: scale .94 with `--shadow-pressed`.
- Buttons are 34 × 34 with a 4 px vertical margin, radius 12, ink-2; hover `--hover` and ink.

**The strips above the field** (padding `0 6 8`, `400 12.5px` ink-2):
- **Replying:** `reply` 14; "Replying to **Mara**" ("yourself" for yours); the quoted text (Roboto, ellipsised); a 26 px × ("Cancel Esc").
- **Editing**, in accent-text: `pencil` 14; "Editing your message"; "Esc to cancel · Enter to save"; ×. The bubble being edited gets a 2 px accent ring.
- **Someone typing** (padding `0 6 7`, `400 12px` ink-2): their 16 px faces; "**Teo** is typing"; the dots.

**Keys.**
- Enter sends (not during IME composition). Shift+Enter breaks a line.
- ↑ in an empty composer edits your last text message.
- Esc cancels a reply or an edit.
- @ opens suggestions (S-25).

**Recording a voice note** (the field centres its items):
- Discard (`trash-2`, `--destructive`);
- a 9 px `#E5484D` dot pulsing (1.2 s);
- the time (`600 12.5px`, tabular);
- 36 bars in accent-text, 2.5 wide, moving between 6 and 22 px (.7 s alternate, staggered);
- "Recording a voice note" (12 px ink-2);
- Send ("Send voice note").

**Its height** sets the pane's `--composer-h`, which the list's bottom padding and the jump button follow (§8.3).

**Replaces.**
- `ChatInput.svelte`: a contenteditable box with suggestions for @mentions, **#rooms, :emoji: and / commands**; attach files; **record with pause**, cancel and send; emoji, sticker and GIF pickers; a reply bar; ↑ to edit.
- `TypingIndicator.svelte` ("is typing" **or recording**).
- `CommandOptions.svelte` (a slash command's options).
- **The app edits a message in place**: the bubble or row turns into an edit box (`MessageList` → `ChatInput`). The prototype edits in the composer, with a strip. That's a change the brief doesn't make (§9); keep the app's way until it's decided.
- **Not drawn:** files waiting to be sent, and their upload progress; the # and : suggestions; command options; pause while recording (§6).

**States.**
- Empty: ★ `S-13-dm`.
- `S-23-text`.
- `S-23-multiline`.
- `S-23-reply`.
- `S-23-edit`.
- `S-23-recording`.
- `S-23-typing`.

#### S-24 The + menu

**Drawn by.** `pane.js`, `plusMenu`; `overlays.js`, `Menu`.

**Layout.** A menu above the + button, aligned to its start:
- Upload a file (`paperclip`, ⌘U);
- Photos and videos (`images`);
- Sticker (`sticker`) → the picker on Stickers;
- GIF (`image-play`) → the picker on GIFs;
- Mention someone (`at-sign`), which inserts "@";
- in a room only, Use a command (`square-slash`), which inserts "/".

**Replaces.** ChatInput's attach button, and its sticker and GIF buttons.

**States.**
- `S-24-dm`.
- `S-24-room`.

#### S-25 @ suggestions

**Drawn by.**
- `pane.js`: `Composer` (`suggest`).
- Classes: `.suggest`, `.suggest-head`, `.suggest-row` (`.on`), `.sg-name`, `.sg-handle`.

**Layout.**
- Glass, absolute: left `--pad-x`, its foot 4 px into the composer; 320 wide, padding 6, radius 14.
- A head: "MEMBERS MATCHING @K" (`600 10.5px`, uppercase).
- Up to six rows (34 tall, radius 9, padding `0 8`, gap 8):
  - a 22 px avatar with presence;
  - the name (`600 13px`, in the role colour);
  - "@handle" (12 px ink-2), pushed right.
- The picked row is `--accent-tint`.
- Members match on the start of their handle or anywhere in their name. You aren't listed.

**Interactions.**
- ↑/↓ move.
- Enter or Tab picks.
- Esc closes.
- Pressing a row picks it.
- Blur closes the list after 120 ms.

**Replaces.** ChatInput's @ suggestions. Keep its # rooms, :emoji: and / commands in the same panel.

**States.**
- `S-25-group`.
- `S-25-room-filtered`.

#### S-26 Emoji picker

**Drawn by.**
- `overlays.js`: `EmojiPicker`.
- Classes: `.pop-emoji`, `.picker`, `.pk-tabs`, `.field-search`, `.pk-cats`, `.emo`, `.pk-grid`, `.pk-sec`, `.pk-emojis`, `.pk-e` (`.custom`), `.pk-foot`, `.pk-big`, `.pk-name`, `.pk-hint`.

**Reach.**
- The composer's emoji button (⌘E), opening above it, aligned to its end.
- Add reaction in the hover bar, or on a reaction row.
- More reactions in the message menu.

**Layout.** A popover 372 wide, radius 20. Inside, a column 440 tall:
- **Tabs** (from the composer only): a small segmented control, full width, padding `10 10 8`: Emoji · GIFs · Stickers.
- **Search** (`.field-search`): 34 tall, margin `0 12 8`, padding `0 10`, radius 11, `--field-bg`, `search` 14; focused, a 3 px `--accent-tint` ring. Placeholder "Search emoji".
- **Categories** (padding `0 10 6`, a hairline under them):
  - `clock` for Recent, then one button per category (30 × 28, radius 8) showing its emoji in grey at 70%, in colour on hover.
  - A click scrolls the grid there.
- **The grid** (scrolling, padding `2 8 8`), in sections. Section heads are `600 10.5px`, uppercase, `.06em`, ink-2, padding `12 4 6`.
  - Recent (12).
  - In a Space, the Space's own emoji, under its name.
  - Then each category, nine columns.
  - Cells are 36 tall, radius 9, Twemoji 22; hover `--hover` and scale 1.12.
- **The foot** (40 tall, a hairline above, 12 px ink-2):
  - the hovered emoji at 22, with ":name:" in Fira Mono `500 12px` ink;
  - or a hint: "Shift-click to pick several" (from the composer) or "Pick a reaction" (for a reaction).
- **Searching** replaces the grid with Results (up to 120).
- **For a reaction** there are no tabs, and a pick closes the picker.

**Replaces.** `EmojiPicker.svelte` (search, category tabs, custom emoji first). "Shift-click to pick several" isn't implemented in the prototype, and the app has no multi-pick. Drop the hint unless it's built (§7.2).

**States.**
- `S-26-compose`.
- `S-26-search`.
- `S-26-hover`.
- `S-26-react`.

#### S-27 GIF picker

**Drawn by.**
- `overlays.js`: `EmojiPicker`, its GIFs tab.
- Classes: `.pk-topics`, `.pill` (`.on`), `.gif-grid`, `.gif`, `.gif-badge`.

**Layout.** The same popover and search, then:
- **Topic pills** in one scrolling row (padding `0 10 8`): Trending, Reactions, Cats, Dogs, Cozy, Night, Applause, Sleepy.
  - Pills are 28 tall, padding `0 11`, radius 9, `--card`, `--shadow-rest`, `500 12.5px`.
  - The picked one is `--selected-fill`, violet, no shadow. In dark, pills are `#1A1A22`.
- **The grid:** two columns, gap 6, padding `2 10 10`.
  - Tiles at 4:3, radius 12.
  - The image slowly pans; that's the prototype standing in for a moving GIF.
  - Hover: a 2 px accent ring.
  - A "GIF" badge at bottom left (`700 9px`, `--media-scrim`, white, radius 5).
- A click sends.
- **The foot:** "GIFs come through Duvet's proxy: the GIF service never sees you".

**That foot is false for the app. Do not port it.** The app's `GifPicker.svelte` and `lib/gifs.ts` call KLIPY directly (`api.klipy.com`, with an app key). Write nothing about privacy there, or write what's true (§9).

**Replaces.** `GifPicker.svelte` (KLIPY trending and search). The topic pills are new. Use KLIPY's categories if the API has them, otherwise drop them (§7.2).

**States.**
- `S-27-trending`.
- `S-27-topic`.

#### S-28 Sticker picker

**Drawn by.**
- `overlays.js`: `EmojiPicker`, its Stickers tab.
- Classes: `.pk-stickers`, `.pk-sticker`, `.pk-by`.

**Layout.** Sections by pack:
- "PACK NAME" with "by Someone" in normal case beside it;
- four columns, gap 4;
- cells square, radius 12, padding 6; hover `--hover`; the name as a tooltip.
- A click sends.

**Replaces.** `StickerPicker.svelte`: the current Space's stickers, with search. The app has no packs. Group stickers by Space, with the Space's name as the head (§7.2).

**States.** `S-28-packs`.

### Notices

#### S-29 Notices

**Drawn by.**
- `overlays.js`: `D.NoticeStack`.
- `app.js`: `D.pushNotice`, `D.arrive`.
- Classes: `.notices` (`.expanded`), `.notice` (`.call`), `.nt-text`, `.nt-head`, `.nt-time`, `.nt-body`, `.nt-close`, `.nt-call`, `.nt-decline`, `.nt-accept`.

**Reach.**
- A message or a mention arrives in a chat that isn't on screen.
- In the prototype: Tweaks → Simulate → Message, Mention or Incoming call. The prototype also fakes one of each 6.5 and 9 s after it opens (scaffolding).

**Layout.**
- `.notices` sits in the main column: absolute, 62 from its top, centred, `min(420px, 100% − 32px)` wide, z 50. Notices stack on one grid cell.
- A notice: glass, radius 18, padding `12 12 12 14`, gap 12. It holds:
  - the sender's 36 px avatar;
  - a head (12 px ink-2): "**Ren Takahashi** in #art-dump · Night Shift Radio", and "now" pushed right (11 px);
  - the text (Roboto `400 13.5px/1.35`, two lines at most);
  - a 24 px × (`x` 13; invisible until hovered).
- **A call:**
  - the text reads `phone-incoming` 13 (in `--live`) and "Incoming call";
  - the × gives way to Decline and Accept, each 40 × 36, radius 12, white icons 16:
    - Decline: `#E5484D`, `phone-off`;
    - Accept: `--live`, `phone`, ringing (`ring`: a 6 px `rgba(var(--live-rgb), .2)` halo pulsing every 1.2 s).

**The stack.**
- Up to three show, the newest in front.
- Behind it each one sits `i × 10px` lower, at scale `1 − i × .045` and opacity `1 − i × .3`.
- Hovering the stack fans them out (`i × 74px`, full opacity) in .35 s on `--overshoot`.
- A notice arrives in .45 s (`noticeIn`).

**Behaviour.**
- A notice leaves after 7 s, unless it's a call, and the timer waits while the stack is hovered.
- A click opens the chat and jumps to the message.
- Accept opens the chat with the call connected.
- In Do not disturb only calls show.

**Replaces.**
- `MentionNotices.svelte` (top centre, under the title bar, for chats not on screen; click opens; × dismisses). This is the same place, in the new look.
- `CallCard.svelte`: incoming and outgoing calls, bottom right, with Accept, Decline and Cancel. The prototype moves the incoming call to the top centre; the brief doesn't say so (§9). The outgoing card ("Calling…", Cancel) becomes the call stage (S-31) and the call panel (S-08).

**States.**
- `S-29-message`.
- `S-29-mention`.
- `S-29-incoming-call`.
- `S-29-stack`.
- `S-29-stack-open`.

#### S-30 Toasts

**Drawn by.** `overlays.js`, `D.toast`, `D.Toasts`. Classes: `.toasts`, `.toast`.

**Layout.**
- Fixed, 30 from the bottom of the window, centred; a column, gap 6; z 2500; no pointer events.
- A toast: glass, padding `9 14`, radius 12, `500 12.5px`.
- It arrives with `sheetIn` (.3 s) and lasts 2.2 s.

**Replaces.** `Toast.svelte`: bottom right, with an error variant. The prototype has no error look. Keep errors distinguishable, for example with a `--destructive` icon (§6).

**States.** `S-30-toast`.

### Calls

#### S-31 A call in a DM or group

**Drawn by.**
- `pane.js`: `CallStage`.
- `app.js`: `D.startCall`, `D.endDmCall`.
- Classes: `.call-stage` (`.small`), `.cs-bg`, `.cs-tiles`, `.cs-tile` (`.speaking`), `.cs-name`, `.cs-bar`, `.cs-status`, `.ring-dots`, `.cs-controls`, `.cs-btn` (`.off`, `.hangup`), `.cs-size`.

**Reach.** Start a call (`phone`) in a DM's or group's header, or from a profile, the Friends page or the call history.

**Layout.**
- The call shows in place, above the conversation (BRIEF).
- `.call-stage`: margin `58 12 0`, 236 tall, radius 20, clipped, `#0d0d14`, `--media-ink`, `--shadow-raised`, z 3. The list's top padding drops to 14 under it.
- **Behind it:** the other person's banner, blurred `34px`, at brightness .5 and saturation 1.3 (inset −40).
- **The tiles** (centred, gap 14, padding-top 10):
  - each 180 × 136, radius 18, `rgba(255,255,255,.08)` with an inset `rgba(255,255,255,.08)` ring;
  - a 64 px avatar over the first name (`600 12.5px`); yours is "You", with `mic-off` 12 when muted;
  - speaking: an inset 2 px `--live` ring and a `0 0 30px -6px` `--live` glow, and the face's mouth talks.
  - A group shows up to three of them, and you.
- **The bar** (52 tall, padding `0 12 0 16`):
  - **The status** (min 140 wide, `600 12.5px`): ringing, three green dots and "Calling Mara…"; connected, a live dot and the timer ("0:42").
  - **The controls**, centred, gap 8. Each is 42 × 36, radius 12, `rgba(255,255,255,.14)`, hover `.22`, icon 17:
    - Mute (off: `rgba(229,72,77,.25)` and `#FF9592`);
    - Camera;
    - Share;
    - Hang up (52 wide, `#E5484D`, white).
  - **Shrink or Grow** (`chevron-up`/`-down` 15; 32 × 32, radius 10), at the right.
- **Shrunk**, the stage is 52 tall: the bar alone, height animating in .3 s.

**Behaviour.**
- The sidebar shows the call panel (S-08), and the chat's row shows "In a call" (S-05).
- Hanging up adds a call row to the chat (S-18).
- The prototype answers by itself after 2.6 s (scaffolding).

**Replaces.**
- `ConversationView.svelte`'s call stage, which is `VoiceChannelView.svelte` inside a conversation.
- The call banners: "Call in progress — Join" and "Calling from another device". They aren't drawn (§6).
- `CallCard.svelte`'s outgoing card.

**States.**
- `S-31-ringing`.
- `S-31-connected`.
- `S-31-muted`.
- `S-31-small`.
- `S-31-group`.

#### S-32 Voice room

**Drawn by.**
- `pane.js`: `VoiceRoom`, `VoiceTile`, `RunSheet` (sample screen content).
- Classes: `.voice-room`, `.vr-grid`, `.vt` (`.speaking`, `.screen`, `.video`, `.small`), `.vt-bg`, `.vt-face`, `.vt-video`, `.vt-label`, `.vt-muted`, `.role-dot`, `.vt-actions`, `.vr-spot`, `.vr-stage`, `.vr-strip`, `.vr-bar`, `.vr-btn` (`.off`, `.on`, `.leave`), `.vr-sep`, `.vr-join`, `.vrj-title`, `.vrj-sub`, `.vr-empty`.

**Reach.** Click a voice room in the sidebar, or the call panel's text. Join voice, or be joined already.

**Layout.**
- `.voice-room`: a column filling the pane, padding `60 14 90`.
- Its header is always in the scrolled, glass look.
- The chat button (control bar or header) puts the room's chat beside it as a split pane, ratio 0.6 (BRIEF), and takes it away again. Opening the room from the sidebar shows the room alone; the sample's fourth tab starts with the pair.

**The grid** (no one sharing):
- 1 column for one person, 2 for up to four, 3 for more; rows share the height; gap 10.
- **A tile** (`.vt`): radius 20, `--card`, `--shadow-rest`.
  - Behind the face: the person's banner, blurred `22px`, saturation 1.2, at 50% (40% in dark).
  - The face: an 84 px avatar with a `0 8px 24px rgba(0,0,0,.18)` shadow.
  - Speaking: `0 0 0 2px var(--live), 0 0 32px -6px rgba(var(--live-rgb), .6)` on the tile. The avatar gets a 3 px `--live` ring and an 8 px halo that breathes (`speak` 1.4 s), and its mouth talks.
  - With their camera on, the video fills the tile (cover).
  - **The label**, at bottom left (10 in):
    - `--media-scrim`, `blur(14px)`, radius 10, padding `5 10`, `600 12.5px`, `--media-ink`;
    - `mic-off` 13 (`#FF9592`) when muted;
    - their top role's 7 px dot;
    - the first name, or "You".
  - **On hover, top right:** Pop out (`picture-in-picture-2`) and Full screen (`maximize`), small icon buttons on `--media-scrim`.
  - A double-click "focuses" a tile (a toast in the prototype).

**A screen share** (BRIEF, settled):
- The sharer's screen takes the stage (`.vr-stage`, flex 1). Its label reads "Sol's screen" with a Live pill.
- A strip under it (104 tall, centred, gap 8) holds every person's small tile: each up to 150 wide, radius 16, a 44 px avatar, a smaller label (padding `4 7`, 11.5 px, radius 8), and no actions.

**The control bar** (joined): glass, centred 16 from the bottom, padding 6, gap 6, radius 18, z 3.
- Buttons are 44 × 38, radius 12, `--secondary-fill`, icon 18:
  - Mute (`.off`: `rgba(var(--destructive-rgb), .14)` with `--destructive`);
  - Deafen;
  - Camera (`.on`: `--accent-tint` with accent-text);
  - Share;
  - a separator (1 × 22 hairline);
  - the room's chat beside (on while it's open);
  - Invite people (`user-plus`) → S-45;
  - a separator;
  - Leave (54 wide, `#E5484D`, white, `phone-off`).
- Hover: `inset 0 0 0 100px var(--hover)`.

**The join bar** (not joined): glass, the same place, padding `8 8 8 16`, gap 16, radius 18:
- the room's name (Fraunces `500 16px`, opsz 36);
- "4 in the room · " with up to four 18 px faces (12 px ink-2), or "Empty";
- a primary **Join voice** (`phone`).

**Empty:** the `under_duvet` mascot at 120 and "Nobody's here yet", centred in ink-2.

**Replaces.**
- `VoiceChannelView.svelte`: a tile per person and per screen share; a click focuses a tile (big, above the others); "Watch stream"; Camera with its options menu (camera list, "Incoming video"); Share screen with "Screen only" or "Screen + Audio"; Mute, Deafen, Leave, Join.
- `StreamViewers.svelte` (the viewer count on a share).
- `StreamWindow.svelte` (a floating in-app window for a stream whose view is off screen).
- **Keep:** Watch stream (opting in to see a share), the camera options, the share-audio choice, the viewer count, and click-to-focus. The prototype draws none of them (§6).
- Pop out on a tile matches `StreamWindow` in spirit. Full screen is new (§7.2).
- **The room's chat beside it.** In the app a voice room's tab shows `VoiceChannelView` alone, with no chat (`PaneView.svelte`). If the API takes messages in a voice room, the chat beside is layout; if not, it's a feature and is left out (§7.2, §9.4). Check before porting.

**States.**
- ★ `S-32-share-chat`.
- `S-32-share`.
- `S-32-grid` (five people, three columns; reached by editing the sample in the page, since no click stops the sample share).
- `S-32-tile-hover`.
- `S-32-controls-on`.
- `S-32-not-joined`.
- `S-32-empty`.

#### S-33 Call history popover

**Drawn by.**
- `overlays.js`: `CallsPopover`.
- Classes: `.pop-calls`, `.list-pop`, `.calls-pop`, `.pop-head`, `.pop-title`, `.lp-list`, `.call-row` (`.missed`), `.call-text`, `.call-name`, `.call-sub`, `.call-when`, `.pop-foot`.

**Reach.** Calls (`phone`) in the sidebar header.

**Layout.** A popover 360 wide, radius 20, at most `min(560px, 72vh)` tall.
- **The head** (padding `14 16 10`, the two ends apart): "Calls" (Fraunces `500 19px`, opsz 36) and a small segmented control, All · Missed.
- **Rows** (padding `6 6 6 8`, radius 12, gap 10; hover `--hover`):
  - a 32 px avatar (a group's Facehash);
  - the name (`600 13.5px`);
  - under it (11.5 px ink-2) an icon 12 and what happened:
    - `phone-incoming` "Incoming · 23 min";
    - `phone-outgoing` "Outgoing · 5 min" ("1 h 12 min" past an hour);
    - "No answer";
    - `phone-missed` "Missed";
    - a missed call's name and line are `--destructive`;
  - when (11.5 px ink-2: "9:58 AM", "Yesterday", "Mon");
  - a Call back icon button.
- **Empty:** the `empty` mascot, "No missed calls", "Calls you miss show here."
- **The foot** (padding `10 12 12`, a hairline above): a full-width secondary **Start a call** (`phone`). It opens ⌘K as "Call someone…".

**Replaces.** `CallHistory.svelte`, the Friends page's Calls tab (missed calls bold with a red phone; **Call or Join** on each row; `lib/call-history.ts`). Keep Join for a call still going.

**States.**
- `S-33-all`.
- `S-33-missed`.

### Pages and popovers

#### S-34 Friends

**Drawn by.**
- `pane.js`: `FriendsPage`.
- Classes: `.friends`, `.fr-top`, `.seg`, `.fr-add`, `.fr-head`, `.fr-list`, `.fr-row`, `.fr-banner`, `.fr-text`, `.fr-name`, `.fr-sub`, `.fr-actions`.

**Reach.** The Friends row at the top of the sidebar's Chats. It opens in the focused pane, as a tab can (BRIEF).

**Layout.**
- The page scrolls, padding `66 --pad-x 30`.
- The header is the static Friends title (S-11).
- **The top row** (gap 12, wrapping, margin-bottom 18):
  - a segmented control: Online · All · Pending 2 · Sent;
  - the add field (flex 1, min 300, 40 tall, padding `0 4 0 12`, radius 12, `--card`, well and hairline; focused, the 4 px ring):
    - `user-plus` 16 in ink-2;
    - an input (13.5 px) "Add a friend by username or Duvet ID";
    - a small primary **Send request**, disabled until something is typed.
- **The head:** "ONLINE — 9" (`600 10.5px`, uppercase, `.06em`, ink-2, padding `6 12 8`). Also "All friends", "Waiting for you", "Sent".
- **Rows** (gap 2; each padding `10 12`, radius 12–14, gap 12, clipped):
  - their banner on the right 46%, faded in from the left (`mask-image: linear-gradient(90deg, transparent, #000 90%)`), at 40% (55% on hover);
  - a 40 px avatar with presence;
  - the name (`600 14px`);
  - a line (12.5 px ink-2): "Online · on air at 9", "Wants to be friends · @otto", "Request sent · @priya";
  - actions, as glass icon buttons:
    - a friend: Message, Call, More (Profile; Remove friend and Block, both danger);
    - a request: Accept (small primary, `check`) and Decline;
    - a sent request: Cancel request.
- Hover: `--card` with `--shadow-rest`.
- A click on a row opens the profile, to the right of its avatar.

**Replaces.** `FriendsView.svelte`:
- tabs All, Pending, Sent and **Calls**;
- "**Search everywhere**";
- Add friend **by user ID**;
- the **New group** modal;
- it can also show a conversation.

The redesign moves things:
- Calls goes to the popover (S-33).
- Search everywhere goes to ⌘K's Messages filter (S-35).
- New group goes to New chat (S-44).
- An **Online** tab filters what All shows today (online first). It's layout, not a feature.

**The add field's words** must say what the app takes. Today that's a user ID, not a username, and Duvet has no "Duvet ID" (§7.2).

**States.**
- ★ `S-34-online`.
- `S-34-all`.
- `S-34-pending`.
- `S-34-sent`.
- `S-34-add-typed`.
- `S-34-row-hover`.
- `S-34-row-menu`.

#### S-35 ⌘K palette

**Drawn by.**
- `overlays.js`: `Palette`, `paletteItems`.
- Classes: `.scrim-palette`, `.palette`, `.pal-input`, `.pal-filters`, `.pal-results`, `.pal-group`, `.pal-item` (`.on`), `.pal-title`, `.pal-sub`, `.pal-hint`, `.pal-glyph`, `.pal-foot`, `.dim`.

**Reach.**
- ⌘K, or the sidebar's search field.
- New tab (+) or ⌘T: "Open in a new tab…".
- ⌘\, or a pane's or tab's "Split with a chat…": "Open beside…".
- The call history's Start a call: "Call someone…".

**Layout.**
- A scrim over the window. Light: `rgba(7, 7, 10, .16)`. Dark: `.theme-dark .scrim`'s `rgba(0, 0, 0, .5)` wins.
- The palette hangs 11vh from the top: `min(640px, 100% − 48px)`, radius 20, at most 66vh, glass on `--glass-strong`. It pops in (.28 s).
- **The input row** (padding `14 16`, gap 12, a hairline under it):
  - `search` 18 in ink-2;
  - the input (`400 17px/1.2` ink), placeholder "Search or jump to…" or its mode's words;
  - an "esc" keycap.
- **Filters:** pills, padding `10 14 4`: All · Messages · People · Spaces.
- **Results** (padding `4 8 8`, scrolling):
  - Group heads (`600 10.5px` uppercase `.06em`, padding `12 10 6`): RECENT, CHATS, ROOMS, PEOPLE, SPACES, MESSAGES.
  - Rows are 40 tall, padding `0 10`, radius 11, gap 10:
    - a 24 px icon: a chat's avatar or Facehash; a room's 24 px glyph tile (radius 7, `--secondary-fill`, the room's icon 15); a person with presence; a Space's icon; a message's author;
    - the title (`500 13.5px`, at most 60%; a room's `#` dim; a message's words marked);
    - a line (12 px ink-2): "@handle", "5 members", the Space, "Name · #room";
    - on the picked row (`--accent-tint`), a hint in accent-text (`500 11.5px`): "Open ↵", "New tab ↵", "Open beside ↵", "Call ↵", "Jump ↵".
- **What it lists:**
  - with nothing typed, under All: Recent (four chats and three rooms);
  - typed: Chats, Rooms (up to 6), People (up to 4; 20 under People), Spaces, and from two characters Messages;
  - 40 rows at most.
- **Empty:** the `oops` mascot, "Nothing found", "Try another name, or search messages."
- **The foot** (padding `9 16`, a hairline above, 11.5 px ink-2, gap 14): "↑ ↓ move · ↵ open · ⌘↵ new tab · ⌥↵ beside · tab filter".

**Keys.**
- ↑/↓ move. Enter opens. ⌘Enter opens in a new tab. ⌥Enter opens beside.
- Tab and Shift+Tab cycle the filters.
- Esc closes. ⌘K closes it again.
- Moving the mouse picks; a click opens, with the same modifiers.

**Replaces.** `QuickSwitcher.svelte` ("Where to?"): Spaces, rooms, conversations and friends (picking a friend starts a DM); news first when empty; Ctrl+N and Ctrl+P to move. Keep Ctrl+N/P.
- **Messages** can use the app's search everywhere.
- **People** can only mean friends: the app can't search people it doesn't know (§7.2).
- **Call someone…** starts a DM call, which exists.

**States.**
- `S-35-open` (also on win).
- `S-35-query`.
- `S-35-messages`.
- `S-35-people`.
- `S-35-spaces`.
- `S-35-nothing`.
- `S-35-new-tab`.
- `S-35-beside`.
- `S-35-call`.

#### S-36 In-chat search

**Drawn by.**
- `overlays.js`: `SearchPopover`, `runSearch`, `mark`.
- `pane.js`: the header's `.ph-search`.
- Classes: `.pop-search`, `.search-pop`, `.sp-section`, `.pills`, `.pill`, `.sp-recent`, `.sp-person`, `.sp-count`, `.sp-results`, `.sp-result`, `.spr-text`, `.spr-head`, `.spr-body`, `mark`.

**Reach.** Click the header's Search, or ⌘F (focuses the focused pane's field).

**Layout.** A popover 420 wide, radius 18, under the field and aligned to its end. Inside, padding `12 12 10`, at most `min(560px, 72vh)` tall. Clicks in the field don't close it.
- **Nothing typed:**
  - "FILTERS": pills Pinned (with `pin`; inserts `pinned:yes `), `from:`, `mentions:`, `has:`, `before:`, `after:`, `during:`;
  - "RECENT": rows 32 tall, with `clock` and a past search.
- **After `has:`:** "HAS" pills: link, embed, file, image, video, sound, sticker.
- **After `from:` or `mentions:`:** people rows (22 px avatar, name, "@handle"), up to six, by the typed start.
- **A query:**
  - "4 results in #general" (12 px ink-2);
  - results, newest first. Each row: padding 8, radius 12, gap 10; a 28 px avatar; "**Name**  Today at 9:14 AM" (12.5 / 11.5 px); the text (Roboto 13 px, two lines) with each word marked (`--mark-bg`, radius 3).
  - A click closes the popover, jumps and flashes.
- **No results:** the `oops` mascot, "No results", "Try fewer words, or another filter."
- **Esc** clears and closes.

**Replaces.** `MessageSearch.svelte` and `lib/search.ts`:
- a box with filter chips and suggestions;
- results in a **side panel** on the pane's right. The brief docks nothing there, so a popover.
- **Keep the app's `in:` filter and `pinned:false`.** The prototype lists only `pinned:yes`.

**States.**
- `S-36-focused`.
- `S-36-has`.
- `S-36-from`.
- `S-36-results`.
- `S-36-none`.

#### S-37 Pins

**Drawn by.**
- `overlays.js`: `PinsPopover`, `msgSummary`.
- Classes: `.pop-pins`, `.list-pop`, `.pin-row`, `.pin-text`, `.pin-head`, `.pin-body`, `.pin-jump`.

**Reach.** Pinned messages (`pin`) in the header, or "See all" in a pin row.

**Layout.** A popover 360 wide, radius 20:
- the head "Pinned" with the count;
- rows (padding 8, radius 12, gap 10, aligned to the top; hover `--hover`):
  - a 28 px avatar;
  - "**Name**  Today" (12.5 / 11.5 px);
  - the text (Roboto 13 px, two lines). Code reads "[code]", a file "📄 name", a voice note "Voice note", photos "2 photos", a link its title, a sticker "Sticker"; @handles become names;
  - "Jump" (`500 11.5px` accent-text), on hover.
- **Empty:** the `empty` mascot, "Nothing pinned yet", "Pin a message from its menu to keep it here."

**Replaces.** `PinnedMessages.svelte`: a popover with Jump **and Unpin**. Keep Unpin.

**States.**
- `S-37-list`.
- `S-37-empty`.

#### S-38 Members

**Drawn by.**
- `overlays.js`: `MembersPopover`, `memberGroups`.
- Classes: `.pop-members`, `.members-pop`, `.mp-list`, `.mp-group`, `.mp-row` (`.offline`), `.mp-banner`, `.mp-text`, `.mp-name`, `.mp-sub`, `.crown-ico`.

**Reach.**
- The header's members button (a room or group).
- A group's title.
- A Space's menu → Members.

**Layout.** A popover 340 wide, radius 20, at most `min(560px, 72vh)` tall:
- **The head:**
  - a Space: "Members" and "38 online · 214";
  - a group: its name and "4 online · 5".
- **Search members** (focused when it opens).
- **Groups**, each headed "PRODUCER — 3" (`600 10.5px` uppercase):
  - a Space: each role shown separately, in order, with its online members (each person once, under their top role); then Online; then Offline;
  - a group: Online, Offline.
- **Rows** (padding `6 8`, radius 12, gap 10; hover `--hover`):
  - their banner on the right 55%, faded in, at 32%;
  - a 32 px avatar with presence (ring `--pop-ring`);
  - the name (`600 13.5px`, in the role colour unless offline), the owner's crown (13 px, `--crown`), a BOT tag;
  - a line (11.5 px ink-2): "You", their custom status or "Online", "Do not disturb" or "Offline", then " · @handle";
  - offline rows at 62%.
- A click shows their profile in the popover, with a Back button (glass, 30 × 30, radius 10, over the banner's top left).
- **The foot** (a Space): a secondary **Invite people** (`user-plus`).

**Replaces.**
- `GuildMemberSidebar.svelte`: the paginated members **column**, with a preference of Auto, Shown or Hidden.
- `MembersButton.svelte` (faces that open a popover, which **can be pinned open as the column**).
- `MemberList.svelte` (hoisted roles, online and offline, the owner's crown, **activity, mic**).
- `MemberBanner.svelte`.
- **"Nothing is docked on the right" (BRIEF).** The column and its preference go; that's a decision for the lead to confirm (§9).
- Large Spaces still need paging or virtualisation in the popover.
- Keep the activity line and the mic mark.

**States.**
- `S-38-space`.
- `S-38-group`.
- `S-38-search`.
- `S-38-profile`.

#### S-39 Profiles

**Drawn by.**
- `overlays.js`: `ProfileCard`.
- Classes: `.pop-profile`, `.profile-card`, `.pc-banner`, `.pc-back`, `.pc-head`, `.pc-badges`, `.pc-badge.crown`, `.pc-body`, `.pc-name`, `.pc-handle`, `.pc-status`, `.presence-inline`, `.pc-bio`, `.pc-roles`, `.role-chip`, `.role-dot`, `.pc-meta`, `.pc-actions`.

**Reach.** Any name or avatar: over messages, in mentions, in members, voice occupants and Friends, or a DM's title.

**Layout.** A popover 320 wide, radius 20.
- **The banner**, 112 tall: their picture, cover; or a 135° gradient from `--sunken` to `--secondary-fill`.
- **The head** (padding `0 16`, raised 40 over the banner, its ends apart):
  - the 76 px avatar with presence and a 4 px `--pop-ring` ring;
  - badges: the owner's crown (26 × 26, radius 8, `--secondary-fill`, `crown` 14 in `--crown`; "Owns this Space") and a BOT tag.
- **The body** (padding `10 16 16`, gap 6):
  - the name: Fraunces `500 21px/1.15`, opsz 72, `-.012em`, in the role's colour or gradient within a Space;
  - "@handle · pronouns" (12.5 px ink-2);
  - the status: an 8 px presence dot, "Online", "Do not disturb" or "Offline", then " · custom status";
  - the bio (Roboto `400 13.5px/1.45`, selectable);
  - role chips (22 tall, padding `0 8`, radius 7, `--secondary-fill`, `500 11.5px`, each with a 9 px dot);
  - a meta line (11.5 px ink-2): "On Duvet since March 2025 · 2 mutual Spaces" (not for bots);
  - actions:
    - someone else: primary **Message** (`message-circle`; fills the row); Call (not for bots); Mention (`at-sign`: puts "@handle" in the focused composer); More (Copy username; Remove friend or Add friend; Block (danger));
    - you: secondary **Edit profile** (`user-pen`) → Settings → Profile.

**Replaces.**
- `MemberProfilePopover.svelte`: banner, bio, **activities**, friend actions, **Assign Roles**, permissions, **Kick, Ban, Remove from group**.
- `MentionProfile.svelte`, `ProfileBio.svelte` (markdown), `ActivityList.svelte` (Spotify included).
- The author's menu in `MessageList.svelte`: **Send Friend Request, Copy User ID, Kick, Ban**, and the staff-only Edit Flags & Badges.
- **Keep:** activities, Assign Roles, Kick, Ban, Remove from group, Copy User ID, and the staff dialog, under More.
- Pronouns, "mutual Spaces", "On Duvet since" and Block: check each against PARITY.md (§7.2).

**States.**
- `S-39-dm`.
- `S-39-space-member`.
- `S-39-own`.
- `S-39-bot`.
- `S-39-no-banner`.
- `S-39-more`.

#### S-40 Thread popover

**Drawn by.**
- `overlays.js`: `ThreadPopover`.
- Classes: `.pop-thread`, `.thread-pop`, `.th-origin`, `.th-list`, `.th-row`, `.th-text`, `.th-compose`.

**Reach.** A thread chip, or "View thread" in the message menu.

**Layout.** A popover 380 wide, radius 20, at most `min(560px, 72vh)` tall:
- "Thread" with "3 replies";
- **the message it hangs from** (margin `0 14 8`, padding 10, radius 12, `--card-soft` with an inset hairline): a 24 px avatar, the name (`600 12.5px`) and the text, on one line;
- **replies** (padding `4 14`, gap 12): a 24 px avatar, the name (in the role colour) and the text (Roboto `13.5px/1.4`);
- **a reply field** (margin `10 12 12`, padding `3 3 3 12`, radius 14, `--card` with well and hairline): "Reply in thread" and a 30 × 30 send (radius 10). Enter sends.

**Replaces.** The "Message thread" modal in `MessageList.svelte`: the reply chain with its own reply box (`lib/threads.ts`).

**States.** `S-40-thread`.

#### S-41 Media viewer

**Drawn by.**
- `overlays.js`: `Viewer`.
- Classes: `.scrim-viewer`, `.viewer` (`.bare`), `.viewer-img`, `.viewer-top`, `.vt-who`, `.viewer-actions`, `.vbtn`, `.viewer-nav` (`.prev`, `.next`), `.viewer-thumbs`, `.viewer-video`, `.vv-play`, `.vv-scrub`, `.vv-time`.

**Reach.** Click a photo or a video.

**Layout.** A modal: `rgba(8, 8, 12, .94)` over the window.
- **The picture**, centred, at most (100% − 180) × (100% − 170): radius 8, `0 20px 60px rgba(0,0,0,.5)`, popping in (.3 s).
- **The top bar** (64 tall, a black 45% gradient down to clear, padding `0 16`, gap 10):
  - the sender's 32 px avatar;
  - their name (`600 13.5px` `--media-ink`) over "Today at 10:31 AM" (12 px, `--media-ink` at 70%);
  - at the right, 36 × 36 buttons (radius 11, `rgba(255,255,255,.08)`, hover `.16`, icon 18): Reply, Download, Open in browser, Close ("Close Esc").
- **Several pictures:**
  - prev and next (44 px circles, `rgba(255,255,255,.1)`, 22 in from the sides, 25% when there's nowhere to go);
  - thumbnails 18 from the bottom (52 × 38, radius 8, 50%; the current one full, with a 2 px white ring).
- **A video:** a bar 70 from the bottom, `min(560px, 80%)` wide, radius 16, `rgba(17,17,19,.6)` with `blur(20px)`, padding `8 14 8 8`, gap 12:
  - play (36 px circle, `rgba(255,255,255,.15)`);
  - a 4 px track (`rgba(255,255,255,.22)`, filled white);
  - "0:05 / 0:24" (`500 12px` tabular).
- **Bare:** a click on the dark hides all of that, .2 s.
- **Keys:** ← and → move; Esc closes.

**Replaces.** `ImagePreview.svelte`: images only, with **zoom in and out, rotate and reset**, and close. Keep zoom and rotate.
- Prev and next, thumbnails, Download, Open in browser, Reply from the viewer, and videos in the viewer are new (§7.2).
- Videos play inline today.

**States.**
- `S-41-gallery`.
- `S-41-video`.
- `S-41-single`.
- `S-41-bare`.

#### S-42 Context menus

**Drawn by.**
- `overlays.js`: `Menu`, `D.MenuLayer`.
- `core.js`: `D.openMenu`, `D.Floating`, `D.place`.
- Classes: `.pop-menu` (`.submenu`), `.menu`, `.menu-item` (`.hi`, `.open`, `.danger`, `.disabled`), `.mi-icon`, `.mi-label`, `.mi-hint`, `.mi-key`, `.mi-check`, `.mi-sub`, `.menu-sep`, `.menu-header`, `.menu-profile`, `.menu-reactions`, `.status-ico`.

**Layout.**
- A menu is glass: 224 to 320 wide, padding 6, radius 14.
- **Items** are at least 32 tall, padding `6 10 6 8`, radius 9, gap 10, `500 13px/1.2` ink:
  - an 18 px icon slot (icon 16, ink-2; inherited on danger items);
  - the label, with an optional hint under it (`400 11px` ink-2);
  - a check (`check` 15, accent-text) when an item with an icon is checked; a checked item without one shows the check in its icon slot;
  - a shortcut (`400 11.5px` ink-2, `.02em`, padding-left 12), written ⌘ on the Mac and Ctrl+ elsewhere;
  - `chevron-right` 14 for a submenu.
- Hovered or picked by keyboard: `--accent-tint`. Danger: `--destructive`. Disabled: 45%.
- Separators are a 1 px hairline, margin `5 8`. A header slot has padding `6 8 8`.
- **Submenus** open on hover to the right (gap 2), their first item level with their parent (5 px up). They flip left at the window's edge.
- **Placement:**
  - at the pointer for a right-click (gap 2, aligned to its start);
  - else against the button (gap 6), below if it fits, else above, aligned to the nearer edge (§8.1).

**Keys.** ↑/↓ move over the actionable items; Enter runs one; Esc closes. A mousedown or right-click outside closes it.

**Every menu in the prototype:**
- **A DM's or group's row** (S-05).
- **A room's row** and **a Space's** (S-06). A Space's menu also opens from its … button and a room's header title.
- **A tab** and **a pair** (S-02).
- **The profile row** (S-07).
- **A message** (S-21).
- **The +** (S-24).
- **A pane's More** (S-11).
- **A friend's More:** Profile; Remove friend; Block.
- **A profile's More:** Copy username; Remove friend or Add friend; Block.
- **Space settings, a room's …:** Rename; Edit description; Invite people; Move to…; Permissions; Delete.
- **Space settings, a member's …:** Roles…; Change nickname; Kick; Ban.

**Replaces.** The app's bits-ui menus: DMSidebar, ChannelsSidebar (rooms, categories), SpaceNav (a Space's ⋯ and right-click), TabBar, the author's menu, NotificationSubmenu. Keep every item they have (PARITY.md), in this look.

**States.**
- `S-42-chat-row` (also on win: "Ctrl+-click", "Alt+-click").
- `S-42-group-row`.
- `S-42-notifications`.
- `S-42-room-row`.
- `S-42-space-row`.
- `S-42-tab`.
- `S-42-tab-pair`.
- `S-42-profile`.
- `S-42-header-dm`.
- `S-42-header-room`.
- `S-42-header-split`.
- Also `S-21-*`, `S-24-*`, `S-34-row-menu`, `S-39-more`, `S-61-room-menu`, `S-63-row-menu`.

#### S-43 Tooltips

**Drawn by.**
- `core.js`: `D.TooltipLayer`, `TipBox`.
- Classes: `.tooltip`, `.tooltip-keys`.

**Behaviour.**
- One tooltip serves every element with a `data-tip`, after 520 ms of rest.
- A mousedown anywhere, or the window losing focus, hides it.
- It is fixed, z 3000, without pointer events.

**Layout.**
- Padding `5 8`, radius 8, `--tip-bg`, `--tip-ink`, `500 12px/1.2`, `--shadow-float`, at most 320 wide, on one line.
- A tip written "Label|keys" shows the keys after the label, in `--tip-dim`, with ⌘ → "Ctrl+", ⌥ → "Alt+", ⇧ → "Shift+" and ⌃ → "Ctrl+" off the Mac.
- It sits below the element, centred, 6 away, and flips when there's no room. Some ask to sit above (the switch's) or left (Tweaks').
- It fades in .12 s.

**Replaces.** The app's `title` attributes and bits-ui tooltips.

**States.**
- `S-43-shortcut` (also on win).
- `S-43-plain`.
- Others: `S-02-pair-tooltip`, `S-03-new-chat-tip`, `S-06-add-space-hover`, `S-19-reaction-tip`.

### Sheets

All sheets share one frame:
- **The scrim**: absolute over the window, z 900, centring its sheet; light `rgba(7, 7, 10, .3)`, dark `rgba(0, 0, 0, .5)`; fades in .18 s. A press on the scrim closes the sheet. Esc closes it, unless a menu or popover is open.
- **The sheet** (`.sheet`): `min(520px, 100% − 48px)` wide, at most 84% tall; a column, gap 12, padding 16, radius 24; `--glass-strong` with `blur(32px) saturate(1.8)`, `--shadow-float` and the glass edge. It arrives with `sheetIn` (.32 s, `--overshoot`).
- **The head**: the title (Fraunces `400 21px/1.2`, opsz 72, `-.01em`) and a close button.
- **A sub line**: 13 px ink-2.
- **The foot**: gap 8, its first item pushed left.

#### S-44 New conversation sheet

**Drawn by.**
- `overlays.js`: `NewChat`.
- Classes: `.sheet.newchat`, `.to-field`, `.to-label`, `.to-chip`, `.field`, `.field-label`, `.nc-list`, `.nc-row` (`.on`), `.check-circle`, `.sheet-note`.

**Reach.** New chat in the sidebar header, or ⌘N.

**Layout.**
- **"New conversation"** as the title.
- **The To field** (min 42 tall, padding `5 10`, radius 12, `--card`, well and hairline; focused, the 4 px ring; wrapping, gap 6):
  - "To" (13 px ink-2);
  - a chip per pick (26 tall, padding `0 4 0 3`, radius 9, `--selected-fill`, violet, `500 12.5px`): an 18 px avatar, the first name, an 18 px ×;
  - the input "Name or username". Backspace on an empty input removes the last chip.
- **"Group name"**, with two or more picked:
  - a field (label `500 12px` ink-2; input 38 tall, radius 11, `--card`, well and hairline);
  - "Optional, e.g. Lisbon in March".
- **The list** (at most 340 tall): "FRIENDS", then rows (padding `6 8`, radius 12, gap 10):
  - a 32 px avatar with presence;
  - the name and "@handle";
  - a 22 px check circle (`--secondary-fill`; picked: `--accent` with a white `check` 13).
- **The foot:**
  - `users` 12 and "One person for a chat, more for a group" (11.5 px ink-2);
  - Cancel;
  - primary **Start chat** or **Create group** (disabled until one is picked).

**Replaces.**
- The New group modal in `FriendsView.svelte` (pick friends and a name; one friend gives "Start conversation"), and "New group" in `DMSidebar.svelte`.
- **Add member** to an existing group (`ConversationView.svelte`) isn't drawn (§6).

**States.**
- `S-44-empty`.
- `S-44-one`.
- `S-44-group`.

#### S-45 Invite people sheet

**Drawn by.**
- `overlays.js`: `Invite`.
- Classes: `.sheet.invite`, `.nc-list.short`, `.link-field`, `.pills`.

**Reach.**
- A Space's or room's menu → Invite people.
- The voice room's Invite.
- A pane's More (in a room).
- The members popover's foot.
- Space settings → Invites → Create invite.

**Layout.**
- "Invite people to Night Shift Radio".
- From a room, "They land in **#general**".
- "Search friends".
- Up to five friends not in the Space (at most 220 tall), each with a small primary **Invite** that turns into a secondary **Sent**.
- "Or send a link".
- A link field (padding `5 5 5 12`, radius 12, `--card` with well and hairline, Fira Mono 13 px) holding the link, with a small primary **Copy** (`copy`).
- "Expires after": pills 30 minutes · 1 hour · 1 day · 7 days · Never.

**Replaces.** `InviteModal.svelte`:
- a room's invite link;
- expiry 30 minutes, 1 hour, **6 hours, 12 hours**, 1 day, 7 days (the default) or Never.
- **Keep 6 and 12 hours.**
- Inviting friends directly is new (§7.2).

**States.**
- `S-45-space`.
- `S-45-room-sent`.

#### S-46 Create room sheet

**Drawn by.**
- `overlays.js`: `CreateRoom`.
- Classes: `.sheet.create-room`, `.type-cards`, `.type-card`, `.tc-icon`, `.tc-title`, `.tc-desc`, `.tc-chev`, `.field-prefixed`, `.set-row.in-sheet`.

**Reach.** A Space's menu → Create room, or Space settings → Rooms → Create room.

**Layout.**
- **First:** "Create a room", "In Night Shift Radio", and three cards (gap 8). Each card:
  - a grid `40px 1fr 16px`, padding 12, radius 16, `--card`, `--shadow-rest` (hover `--shadow-raised`);
  - a 40 × 40 icon tile (radius 12, `--secondary-fill`, icon 20 in accent-text);
  - its title (`600 14px`) and a line (12.5 px ink-2);
  - `chevron-right`.
  - The three: **Text room** (`hash`; "Messages, pictures, links, stickers"), **Voice room** (`volume-2`; "Talk, share a screen, hang out"), **Announcements** (`megaphone`; "Only some can post; everyone reads").
- **Then** (Back, the title "New text room", close):
  - **Name:** a field with the room's icon inside (38 tall, radius 11), "new-room". It lowercases, and turns spaces into dashes.
  - **What it's for:** "Optional".
  - **Category:** a select.
  - **Private**, with a switch: "Only the roles and members you pick see it".
  - The foot: Cancel, and primary **Create room** (disabled until named).

**Replaces.** The Create Room dialog in `ChannelsSidebar.svelte`:
- types Text Room, Voice Room and **Category**;
- a category picker and a name.
- **Keep Category as something you can create** (Space settings → Rooms has "New category").
- Announcements and Private are new (§7.2). Whether rooms take a topic in the app: see PARITY.md.

**States.**
- `S-46-types`.
- `S-46-text`.
- `S-46-voice-private`.

### Settings

#### S-47 Settings window

**Drawn by.**
- `windows.js`: `OSWindow`, `SideNav`, `SettingsWindow`, and the blocks `Group`, `Row`, `Toggle`, `Slider`, `Select`.
- `app.js`: `D.openWindow`, `D.closeWindow`.
- `core.js`: `D.Toggle`, `D.Segmented`, `D.Button`.
- Classes: `.oswin` (`.focused`), `.oswin-bar`, `.oswin-title`, `.oswin-body`, `.ws-side`, `.ws-lights`, `.ws-me` (`.active`, `.static`), `.ws-search`, `.ws-nav`, `.ws-group`, `.ws-group-title`, `.ws-item` (`.active`), `.ws-ico`, `.ws-main`, `.ws-toolbar`, `.ws-title`, `.ws-content`, `.ws-page`, `.window-sheet`, `.scrim-window`, and the blocks' classes below.

**Reach.**
- ⌘, (opens on Appearance).
- The profile menu's Settings…, Edit profile… or Set a custom status… (Profile).
- A profile's Edit profile.
- Opening it again brings the open window forward.

**On macOS, Windows and Linux: its own window** (BRIEF: "like native Mac apps").
- 860 × 620 (at most the screen less 80 each way), centred; each further window 28 px down and right.
- Radius 14 (Windows 9, Linux 13). It arrives with `winIn` (.32 s).
- **Focus:** the focused window is drawn above, and the main window shows as inactive (S-01). Unfocused, its shadow is lighter.
- **Dragging:** by its side panel, its toolbar, and on Windows and Linux its title bar.
- **macOS:** no title bar. The traffic lights sit at the top of the side panel (a 52 px row, padding-left 8). Its own close button closes it.
- **Windows and Linux:** a 40 px title bar (`--base`, hairline under it) with "Duvet settings" (`500 12.5px` ink-2, padding-left 14) and the platform's controls at its right. The side panel then has padding-top 12.

**On the web: a sheet.**
- Over a scrim in the page (z 900): `min(920px, 100% − 48px)` × `min(660px, 100% − 48px)`, radius 24, side panel and page in a row.
- The side panel's corners are `24 0 0 24`, padding-top 14.
- The toolbar ends with a close button ("Close Esc").
- Only the newest window shows on the web.

**The side panel** (236 wide, padding `0 10 12`, `--sb-bg` with `--sb-filter`, a 1 px `--sb-edge` line on its right):
- **"Me"** (padding 8, radius 12, gap 10): a 34 px avatar, the name (`600 13.5px`) and "Duvet account" (11.5 px ink-2). It opens Profile. Active: `--accent-tint`; hover `--sb-hover`.
- **A search field** (30 tall, `--sb-field` with a .5 px `--sb-edge` ring) that filters the items.
- **The items**, in groups 10 apart. Each is 32 tall, padding `0 8`, radius 9, gap 9, `500 13px`: a 22 × 22 tile (radius 7, a colour, a white icon 14), the label, an optional count chip. Active `--accent-tint`; hover `--sb-hover`.
  1. Account (`user`, `#5E6380`); Privacy (`shield`, `#2F9E62`).
  2. Appearance (`palette`, `#2F4CFF`); Notifications (`bell`, `#E44FCB`); Sounds (`volume-2`, `#F97316`); Voice and video (`mic`, `#0E8FD6`); Keyboard (`keyboard`, `#5E6380`).
  3. My files (`folder`, `#0B6FE8`); Developer (`code`, `#15172B`).

**The page.**
- A 52 px toolbar (padding `0 16 0 24`, hairline under it) with the section's title (Fraunces `500 17px`, opsz 36).
- The content scrolls, padding `20 26 40`. The page is centred, at most 640 wide, gap 20, and arrives with `fadeUp` (.25 s) on each change of section.

**Building blocks** (Settings and Space settings):
- **A group:** its title (`600 11px` uppercase `.06em` ink-2, padding `0 6`); a card (radius 16, `--card`, `--shadow-rest`, clipped); an optional note (12 px ink-2, line height 1.45).
- **A row** (min 50 tall, padding `8 14`, gap 12; rows split by an inset hairline):
  - an optional 30 × 30 icon tile (radius 9, `--secondary-fill`, accent-text);
  - the label (`500 13.5px/1.3`) and a line (12 px ink-2);
  - its control at the right, or `chevron-right` for a row that opens something (hover `--hover-soft`);
  - danger rows in `--destructive`.
- **A form row:** a grid `136px 1fr`, padding `9 14`. The label is `500 13px` ink-2. Inputs are 38 tall, radius 11, `--card` with well and hairline (focused, the 4 px ring). Text areas are at least 84 tall, Roboto `13.5px/1.45`, with a character count at their bottom right.
- **A switch:** 40 × 24, radius 12, `--toggle-off`, `--accent` when on. The knob is 18 × 18, radius 7, white, `0 1px 3px rgba(0,0,0,.22)`, and moves 16 px in 250 ms on `--overshoot`. Disabled: 50%.
- **A segmented control:**
  - the track `--seg-track`, padding 3, radius 11;
  - the thumb `--card` (dark `#262633`), radius 8, `--shadow-control`, sliding in 250 ms on `--spring`;
  - options 28 tall, padding `0 12`, `500 12.5px` ink-2 (picked: ink); small ones 24 tall, 12 px.
- **A select:** 30 tall, padding `0 28 0 10`, radius 9, `--secondary-fill`, `500 12.5px`, with `chevrons-up-down` 13.
- **A slider:** 150 × 4, radius 2, `--accent` up to its value and `--toggle-off` after. The thumb is an 18 px white circle, `0 1px 3px rgba(0,0,0,.28), 0 0 0 .5px rgba(0,0,0,.12)`.
- **A meter:** 150 × 6, radius 3, `--toggle-off`, filled with `--live`.

**Keys.**
- Esc closes the focused window, when nothing in it is being typed in and no menu, popover or sheet is open.
- ⌘W closes it too.
- Pressing in the main window focuses the main window again, and Settings shows as unfocused. The prototype keeps drawing it above the main window. As a real window it goes behind, as the OS orders windows.

**Replaces.**
- `UserSettings.svelte`, a bits-ui modal opened from the user bar's gear. Its sections: My Account, Attachments, Security, Audio, Appearance, Activity Privacy (desktop only), S3 Buckets, Developer, and Log Out.
- **A real OS window is new to the app.** It makes one window today (`src/bun/index.ts`), so a second Electrobun window is needed, sharing the session and state (§8.13). The brief asks for it.

**States.**
- `S-47-window` (macOS; also win, linux, web).
- `S-47-nav-search`.
- `S-47-unfocused`.
- The main window behind it: `S-01-inactive`.

#### S-48 to S-57 Settings sections

Every section is drawn by its function in `windows.js`. The words are the prototype's. **Most of what these pages hold is not in the app.** What's new to the app is marked "(new)" and belongs in §7.2: leave it out, or ask.

**S-48 Profile** (`Profile`). Shots: `S-48-profile`, `S-48-unsaved`.
- **A card** (radius 16, `--card`, `--shadow-rest`):
  - a 140 px banner with a glass "Change banner" (`image` 14; 30 tall, radius 10, `500 12px`) at its bottom right;
  - under it (raised 42, padding `0 16 14`, gap 14): the 84 px avatar (4 px `--card` ring) with a glass 30 px camera button at its bottom right ("Change picture");
  - the name (Fraunces `500 20px`, opsz 72) and "@handle".
- **Profile:** Display name; Pronouns (new); Custom status (new); About me (190 characters, the count at the bottom right).
- **Username**, with the note "Friends add you with it. You can change it once a month.": a row "@wren", "duvet.chat/@wren", Copy. The once-a-month rule: check the app.
- **When something changes, an unsaved bar** (sticky at the bottom, glass, padding `10 10 10 16`, radius 16, `500 13px`): "You have unsaved changes", Reset, Save.
- *The app:* My Account. Banner and avatar (with `ImageCropModal`), display name, about me, username. `MemberProfileCard.svelte` previews the profile; keep the preview or the card above.

**S-49 Account** (`Account`). Shot: `S-49-account`.
- **Sign-in:** Email ("w•••@duvet.chat", Change); Password ("Changed 3 months ago", Change); Two-step sign-in (switch; new).
- **Your data:** Download your data (new).
- Then **Sign out**, and **Delete account** (danger; new).
- *The app:* Security (verify email; change it by a link; reset the password by a link) and Log Out. Map the app's actions onto these rows. "Change" for the password sends the reset link.

**S-50 Privacy** (`Privacy`). Shot: `S-50-privacy`.
- **Where you're signed in:** devices with Sign out (new).
- **Who can reach you:** Friend requests from (Everyone, Friends of friends, Nobody; new); Messages from Space members (new).
- **Chats:** Link previews (new); Read receipts (new).
- *The app:* Activity Privacy, "Share what I listen to on Spotify" (desktop only). That's this section's only real row.

**S-51 Appearance** (`Appearance`, `ThemeCard`). Shots: `S-51-top`, `S-51-bottom`.
- **Theme:** three cards (a 3-column grid, gap 14, padding 16), System · Light · Dark.
  - Each preview is 16:10 with radius 12 and a hairline ring; picked, a 3.5 px accent ring.
  - It draws a tiny window: a 30% sidebar and bubbles 7 tall, in the colours of §1.4. System is half light, half dark.
- **Messages:** two cards, Bubbles (with a "Default" tag: `600 10px`, radius 6, `--secondary-fill`) and Flat rows. The note: "Flat rows fit more on screen; bubbles are easier to follow. You can change it any time."
- **Your bubbles** (new):
  - a preview (padding 14, radius 12, `--base`) with one of theirs and one of yours;
  - swatches (30 px circles, gap 10): azure (the default), `#5F45B5`, `#2F4CFF`, `#E44FCB`, `#2F9E62`, `#F97316`, `#15172B`, and a conic "any colour" one with a colour input (`pipette`);
  - picked: `0 0 0 2px var(--card), 0 0 0 4px var(--ink-2)` with a white check.
- **Reading:** Text size (a slider, 13–19, "15 px"; new); Density (Comfortable · Compact; new); Code theme (a select: GitHub, One Dark, Solarized, Dracula, Night Owl); Play GIFs and stickers (new); Reduce motion (System · On; new).
- *The app:* Appearance has:
  - Theme (System, Light, Dark): same;
  - Spaces column (Fixed, Auto-hide);
  - Open chats (Tabs on top, Vertical list);
  - Members column (Auto, Shown, Hidden);
  - Keyboard navigation;
  - **Code Theme URL with a preview**: keep it, instead of the prototype's select;
  - Faces in voice.

  The brief adds bubbles or flat rows. Every app row stays, or its removal is decided (§9).

**S-52 Notifications** (`Notifications`). Shot: `S-52-notifications`.
- **On this computer:** Desktop notifications; Notices in the app; Unread count on the app icon; Show message text. All new.
- **New Spaces start with:** Notify me about (Every message · Only mentions). New.
- **Quiet hours**, with the note "Do not disturb turns on by itself. Calls still show, without ringing.": Every night; From–to. New.
- *The app:* no section. The web asks for notification permission (`NotificationPermissionBar.svelte`). This section has nothing real to hold yet; leave it out (§7.2).

**S-53 Sounds** (`Sounds`). Shots: `S-53-sounds`, `S-53-bottom`.
- **All sounds:** Volume (slider).
- **Each sound:** Message; Mention; Call ringing; Someone joins voice; Someone leaves voice; Mute and unmute; Deafen and undeafen; Disconnected. Each has a Play button and a slider.
- *The app:* Audio. Master, Notifications, Join Voice, Leave Voice, Incoming Call, Screen Share On, Screen Share Off, each **0–200%** with a preview. Use the app's sounds and its range, in this look.

**S-54 Voice and video** (`VoiceVideo`). Shots: `S-54-top`, `S-54-bottom`.
- **Voice:** Microphone (select); Speakers (select; new); Input level (a meter, "Say something"; new); Talk with (Voice activity · Push to talk; new); Noise suppression (switch); Echo cancellation (new).
- **Video:** a mirrored 16:9 preview (radius 12, margin `14 14 6`) with a glass "Preview" label; Camera (select); Mirror my video (new).
- *The app:* the mic picker sits on the user bar (right-click "Input Device"), the camera picker in the voice room, noise suppression on the user bar. This page can hold those three: Microphone, Camera, Noise suppression.

**S-55 Keyboard** (`Keys`). Shots: `S-55-keyboard` (also win), `S-55-bottom`.
- **Shortcuts**, a keycap per row:
  - Search or jump to ⌘K; New tab ⌘T; Close tab ⌘W; Next tab ⌃⇥; Go to tab 1–9 ⌘1 … ⌘9;
  - Open beside (split view) ⌥-click; Search in this chat ⌘F; New chat ⌘N;
  - Show or hide the sidebar ⌃⌘S; Settings ⌘,;
  - Mute ⌘⇧M; Deafen ⌘⇧D;
  - Edit your last message ↑; Reply to a message R; Emoji, GIFs, stickers ⌘E.
- *The app:* a "?" sheet (`KeyboardLayer.svelte`) and the Keyboard navigation switch (Appearance). List the app's real shortcuts here (§8.10), and keep the "?" sheet.

**S-56 My files** (`Files`). Shot: `S-56-files`.
- **The hero** (padding 16, radius 16, `--card`, `--shadow-rest`, gap 12):
  - "412 MB of 1 GB" (Inter `600 26px`; "of 1 GB" `500 14px` ink-2);
  - a 10 px bar (radius 5, `--toggle-off`, gap 2) in segments: Pictures `--azure`, Videos `#7A68E8`, Voice notes `#E44FCB`, Files `--live`;
  - a legend (12.5 px; 8 px dots; amounts in ink, 600).
- **Where your files live:** Duvet storage ("1 GB, free", "In use"); Your own S3 bucket (Connect); Your own WebDAV server (Connect; new).
- **Everything:** Export all your files (new).
- *The app:* Attachments (the quota, a file list with kind filters, delete, delete all, move) and S3 Buckets (your own bucket: endpoint, region, keys, path-style, limits, activate, transfers). Both live here; mobile's `MyFilesPage` shows how (§6). Mobile draws storage in shades of ink, not hues (§9).

**S-57 Developer** (`Developer`). Shot: `S-57-developer`.
- **Teams:** Lantern Games ("3 members · 1 app"); New team.
- **Applications:** Lantern CI ("Bot · in 1 Space · 3 slash commands"); Night Shift.
- The rows open nothing in the prototype.
- *The app:* teams (create, members, invite, pending invites) and applications and bots (create, appearance, active, invite link, Reset Token, delete). Their pages follow mobile's developer screens (§6).

### Space settings

#### S-58 Space settings window

**Drawn by.** `windows.js`, `SpaceWindow`, on the chassis of S-47.

**Reach.**
- A Space's menu → Space settings… (⌘⇧,), or → Emojis and stickers.
- A room's menu or a pane's More → Room settings…, which opens Rooms with that room open.
- One window per Space.

**Layout.**
- 940 × 660.
- On Windows and Linux the title bar reads "Night Shift Radio · Space settings".
- **The head** (static, not a button): the Space's 34 px icon, its name (Fraunces `500 15px`, opsz 24) and "Space settings".
- **The items:**
  1. Overview (`info`, `#5E6380`); Roles (`shield`, `#7C5CFF`); Rooms (`hash`, `#2F4CFF`); Emojis and stickers (`smile`, `#F59E0B`).
  2. "People": Members (`users`, `#0E8FD6`); Invites (`link`, `#2F9E62`); Bans (`ban`, `#B0443B`).
  3. "Apps and data": Webhooks (`webhook`, `#E44FCB`); Storage (`database`, `#0B6FE8`).
- Group titles are `600 11px` ink-2, padding `8 8 6`.

**Replaces.**
- `ServerSettings.svelte`, a modal with Overview, Roles, Members, Invites, Bans, Emojis, Stickers, Webhooks, Storage and **Attachments**.
- `ChannelSettings.svelte`, a room's or category's modal: Overview, Permissions, Webhooks.
- The Space's **Attachments** section has no item here: put it under Storage, or give it an item (§9).

**States.** `S-58-window` (macOS; also win, linux, web).

#### S-59 to S-67 Space settings sections

**S-59 Overview** (`Overview`). Shots: `S-58-window` (top), `S-59-bottom`.
- **The media** (margin-bottom 26):
  - a 150 px banner (radius 16) with "Change banner";
  - the Space's 72 px icon (a 4 px `--base` ring) at left 18, overlapping the foot by 26, with a camera button.
- **About:** Name; Description (a text area); Language (a select).
- **New members:** Default notifications (Every message · Only mentions); Welcome messages in (a select of rooms; new); Say hi when someone joins (new).
- Then: **Transfer ownership** (`crown`; new) and **Delete Space** (danger).
- *The app:* banner, icon, name, description, Locale, Default Notifications, and Delete Space (owner only, confirmed in place).

**S-60 Roles** (`Roles`, `ColorPicker`). Shots: `S-60-highest`, `S-60-gradient`, `S-60-solid`, `S-60-everyone`, `S-60-permissions`.
- **Two columns**, `214px 1fr`, gap 20; the page is up to 860 wide.
- **The list** (sticky):
  - a small secondary **New role**;
  - role rows (34 tall, radius 10, gap 8, `500 13px`; active `--accent-tint`): a grip (`grip-vertical` 14 at 55%; none for @everyone), a 9 px colour dot, the name ("@everyone"), and its member count (11.5 px ink-2);
  - "Drag to reorder. Higher roles win."
- **The editor** (gap 16):
  - On the highest role, a callout (padding `10 12`, radius 12, `--secondary-fill`, 12.5 px; `info` in accent-text): "This is your highest role. Only the Space's owner can change it."
  - Role name and Name colour, stacked fields side by side. The colour button is 38 tall with a 24 × 16 swatch (radius 6). @everyone has no colour, and its name is locked.
  - **The colour picker** (a card, padding 14, gap 12):
    - Default · Solid · Gradient;
    - ten swatches;
    - for a gradient, a bar between two 22 px stops;
    - a hex field (Fira Mono, on `--base`);
    - a preview: "Preview" and the name in that colour. Default says "Names show in the default ink."
  - A group: "N members" (Manage); Show members separately (switch); Anyone can @mention this role (switch; new).
  - Permission groups General, Messages, Voice, Members and Admin, a switch each, with the prototype's own labels and lines.
- *The app:* create; drag to reorder; colour solid or gradient with **three stops (From, Via, To)**; "Display role members separately"; permission switches. **Keep three stops.** Use the app's real permissions (`permissions.ts`, the gateway's bitfield), not the prototype's list.

**S-61 Rooms** (`Rooms`, `TriState`). Shots: `S-61-list`, `S-61-room`, `S-61-room-menu`.
- **Actions:** Create room (small primary) and New category (small secondary, `folder`).
- **Each category:**
  - a head (`grip-vertical`, the name: `600 11px` uppercase);
  - a card of room rows (46 tall, padding `0 8 0 10`, gap 8; hover `--hover-soft`): a grip; the room's icon; the name (`500 13.5px`); its topic (12 px ink-2, ellipsised); Permissions (`shield`); Options (…).
- **A room opened:**
  - "‹ Rooms" (accent-text, `500 13px`);
  - a head card (padding `12 14`, radius 16): a 40 px glyph tile, the name (Fraunces `500 18px`), its topic, and Rename;
  - "FOR": role pills with their dots, and "Add member" (new);
  - permission groups whose rows have a tri-state control instead of a switch:
    - Deny (`x`) · Role default · Allow (`check`), 300 wide;
    - the track is `--seg-track` with the thumb sliding in 250 ms on `--spring`;
    - picked Deny reads `--destructive`, picked Allow `--live`;
  - **Delete this room** (danger).
- *The app:*
  - rooms are managed from the sidebar: Create Room, categories, drag to reorder, Delete with a confirmation;
  - each room's overwrites live in `ChannelSettings`: Allow, Inherit or Deny per **role**; a member's are shown only if they already exist;
  - per-room webhooks;
  - a category's settings.

  Bring them all here. Room webhooks need a place in the room's page.

**S-62 Emojis and stickers** (`Emojis`). Shot: `S-62-emojis`.
- "EMOJIS · 6 OF 50": a grid (`auto-fill`, at least 92 wide, gap 8, padding 12) of items (at least 86 tall, radius 12, 11 px ink-2; the image 42, ":name:"). An **Upload** tile first (`--secondary-fill`, accent-text, `plus` 18).
- "STICKERS · 6 OF 30": the same, with 64 px images.
- *The app:* Emojis and Stickers with upload. Use its real limits.

**S-63 Members** (`Members`). Shots: `S-63-table`, `S-63-row-menu`.
- **Tools:** a search field (`--card`, `--shadow-rest`) and a role select ("Every role").
- **A table card:**
  - a head row (MEMBER · ROLES · JOINED; `600 10.5px` uppercase, padding `11 14`);
  - rows (a grid `2.2fr 2fr 1fr 40px`, padding `9 14`, 13 px, split by hairlines):
    - the person (a 28 px avatar with presence; the name, `600 13px`, in the top role's colour; "@handle");
    - role chips and BOT;
    - joined, in ink-2;
    - … (Roles…; Change nickname (new); Kick and Ban, both danger).
- *The app:* a members list with roles and a Member Details panel (**User ID**, roles, Kick, Ban). Roles are assigned in the profile popover. Keep the User ID.

**S-64 Invites** (`Invites`). Shot: `S-64-invites`.
- A small primary **Create invite** (`link`), which opens S-45.
- A table: LINK (Fira Mono) · MADE BY · USES ("3 / 10") · EXPIRES, and Revoke (`trash-2`). The grid is `2fr 1.3fr .8fr 1fr 40px`.
- *The app:* Invites with Revoke.

**S-65 Bans** (`Bans`). Shot: `S-65-bans`.
- Rows: a 32 px Facehash, the name, "reason · date", and Unban.
- *The app:* `SpaceBans.svelte`, and `BanDialog.svelte` for the reason.

**S-66 Webhooks** (`Webhooks`). Shot: `S-66-webhooks`.
- A small primary **New webhook**.
- Rows: `webhook`, the name, "Posts to #tracklist · made by Kit", and Copy URL.
- *The app:* `Webhooks.svelte`, a list and an editor. The editor isn't drawn (§6).

**S-67 Storage** (`SpaceStorage`). Shot: `S-67-storage`.
- **The hero:** "2.1 GB of 5 GB", a bar, a legend.
- **Buckets**, with the note "Files over 50 MB go to the uploader's own storage.": Duvet storage ("Kept for good: the owner has Premium", "Default"); a connected R2 bucket (Manage).
- *The app:* Storage (the Space's buckets and transfers) and Attachments. "Premium" and the 50 MB rule are sample copy: check them against the app.

### The rest

#### S-68 Drag and drop

**Drawn by.**
- `shell.js`: `rowHandlers` (draggable rows carrying `text/duvet-ref`), `Tab` (`text/duvet-tab`, drop zones).
- `pane.js`: `Pane` (drop zones).

**States.**
- `S-68-pane-beside`: a row over a single pane's right part, "Open beside".
- `S-68-pane-here`: over its left part, "Open here".
- `S-68-tab-join`: a tab over another's middle.
- `S-68-tab-before`: over its left quarter.

The drag in these shots is a dispatched `dragover`; the README says drag and drop wasn't tested in the prototype.

**Replaces.** `PaneView.svelte`'s drop zones (four sides plus the middle) and `TabBar.svelte`'s drops. Keep the vertical sides if vertical splits stay (S-10).

#### S-69 Appearance-driven states

- `S-69-compact`: Density Compact. Chat rows 44, room rows 27, bubble groups 6 apart, bubble padding `6 11`, flat heads 8 apart.
- `S-69-bubble-colour`: your bubbles in `#E44FCB` with `--own-ink` worked out from it, and text at 17 px.

Both are proposals (§7.2). They're shot so that the variables they drive are documented.

#### S-70 YouTube dock (scaffolding)

`overlays.js` `D.Dock`, classes `.dock*`:
- a glass card 300 wide at the main column's bottom right (right 16, bottom 96, radius 18);
- the video's thumbnail, title, channel and a red progress bar;
- Pause and Close.

**Don't build it.** On desktop, embeds play inside their message, as today (team brief, rule 4). Shot `S-70-dock`, so reviewers know what not to port.

---

## 5. Platform chrome

| | macOS | Windows | Linux | Web |
|---|---|---|---|---|
| Window shape | Radius 16; the OS's shadow (the prototype fakes it, §1.7) | Radius 9 | Radius 13 | The page: no radius, shadow or edge |
| Window controls | Traffic lights: 12 px, gap 8, `#FF5F57` `#FEBC2E` `#28C840`; glyphs on hover; grey when inactive | Minimise, Maximise, Close: 46 wide × 52, glyphs 10 px stroke 1; hover `--hover-strong`; Close `#C42B1C` | GNOME's: 24 px circles on `--hover-strong`, gap 10, glyphs 10 px stroke 1.4 | None |
| Their side | Left: in the sidebar header after 18 px; in the tab strip when the sidebar is hidden | Right end of the tab strip, flush with the edge | Right end of the tab strip, 4 px in | n/a |
| Title bar | One 52 px line: the sidebar header (left) and the tab strip (right) | Same | Same | Same line, nothing to drag |
| Drag areas | The sidebar header and the tab strip, except tabs, buttons and inputs; `.ts-fill` after the tabs | Same | Same | None |
| Where tabs start | 10 px into the main column, right of the sidebar; after the lights and Show sidebar when the sidebar is hidden | Same; after Show sidebar when hidden | Same | Same |
| The sidebar header's left | Traffic lights | The logo, 22 px | The logo, 22 px | The logo, 22 px |
| The sidebar's material | Vibrancy: `--sb-bg` over `blur(48px) saturate(1.5)` (dark 1.4), the desktop showing through | Mica-like: `rgba(238,241,254,.82)` / `rgba(20,20,27,.84)`, same blur | Solid Ghost tint `#EDF1FF` / `#0D0D12`, no blur | Solid Ghost tint, no blur |
| Shortcut text | ⌘ ⌥ ⇧ ⌃ | Ctrl+ Alt+ Shift+ | Same as Windows | The prototype writes Ctrl+ even for a Mac visitor (§9) |
| Hide sidebar | ⌃⌘S | "Ctrl+Shift+S" (tooltip only; not wired) | Same | Same |
| Settings, Space settings | Own windows; the lights in the side panel; no title bar | Own windows with a 40 px title bar, title and controls | Same, GNOME controls | A sheet in the page, 920 × 660 at most, one at a time, with × |
| Inactive main window | Grey lights; the tab strip at 80% | The tab strip at 80% | Same | n/a |
| The media pop-out (BRIEF) | Yes (not drawn) | Yes (not drawn) | Yes (not drawn) | No |

**The real app.**
- Electrobun makes the native window with `titleBarStyle: "hidden"` (`src/bun/index.ts`). On macOS the OS draws the shadow, the corner radius and the real traffic lights; the app draws its own controls today. The prototype's lights sit at x 18 within a 52 px header. Whether the port positions the native lights there or draws its own is an engineering choice (§8.14).
- On Windows the app already draws its buttons and handles snapping (`window-snap.ts`).
- Linux runs CEF.

**Screenshots and window size.**
- The prototype draws its window on a fake desktop, inset from the page: macOS 24 at the sides, 44 at the top (under a 26 px menu bar), 22 at the bottom; Windows and Linux 24 at the sides, 20 at the top, 22 at the bottom; the web none.
- So for a window of W × H, the viewport is (W + 48) × (H + 66) on macOS, (W + 48) × (H + 42) on Windows and Linux, and W × H on the web.
- The reference shots are named by the **window** size and clipped to it (§10). To compare the app, shoot its window, or its web build's viewport, at that size.

---

## 6. What the prototype doesn't draw

These are surfaces the app has. For each, the mobile screen to follow (in `mobile/lib`, and a picture in `screenshots/` when one exists), drawn in the redesign's language: the glass sheet frame (S-44), the settings blocks (S-47), the tokens. The screenshots README notes that sign-in, voice rooms, calls in progress and the video player weren't captured.

| The app's surface | App files | Mobile to follow | Screenshot | How |
|---|---|---|---|---|
| **Sign in** | `routes/(auth)/sign-in`, `AuthScene.svelte` | `login.dart` `LoginScreen` | none | A centred column, at most 400 wide: the `hello` mascot at 120; "Sign in to Duvet" (Inter 36 bold); Email; Password; "Forgot password?" to the right; the error line; primary Sign in, with a spinner while busy; "New to Duvet? Create an account". Fields 48 tall, radius 12, recessed (`--shadow-well`); in desktop density, 38 tall like S-47's. |
| **Sign up**, with its Terms modal | `routes/(auth)/sign-up` | `account.dart` `SignUpScreen` on `_FormPage` (at most 720 wide: back chevron, large title, a lead line, fields, one primary, extras) | none | Display name (optional), Username, Email, Password (show/hide), Confirm password, the "I agree to the Terms of use" checkbox (the terms in a sheet). A strength meter: four 4 px segments in ink, never red or green. "Already have an account? Sign in". |
| **Forgot password** | `routes/(auth)/forgot-password` | `ForgotPasswordScreen` | none | "Reset your password", Email, "Send reset link"; once sent, a "Link sent" card (radius 20, `mail-check`). |
| **Reset password** | `routes/(auth)/reset-password` | `ResetPasswordPage` | none | "Choose a new password", a field with the strength hint, "Save password". |
| **Verify email** (a link's result) | `routes/(auth)/verify` | `VerifyEmailPage` | none | "Check your email" with a 64 px mail tile (radius 16, raised); "Email verified" and Done when it's done. |
| **Change email** (a link's result) | `routes/(auth)/change-email` | `ChangeEmailPage` | none | The same form page. |
| **"Connecting…"** while the app starts | `routes/app/+page.svelte` | `main.dart`: the launch spinner; `_Unreachable` | none | A spinner. If the server can't be reached: "Couldn't reach Duvet", Try again, Sign in instead. |
| **The invite page** (`/invite`) | `routes/invite/+page.svelte` | No page: `spaces.dart` `_Join` in a glass sheet; `widgets/link_embeds.dart` `InviteCard` | `02-conversation/03-dm-invite-card-call-notices-light.png` (the card) | A centred card in the auth pages' frame: the Space's 64 px icon, its name, "N members", the description; a primary Join (or "Sign in to join this Space"). An expired invite: "This invite has expired". |
| **Add a Space** (create or join), **Join a Space**, **Space invite** (in the app) | `AddSpaceModal.svelte`, `JoinInviteModal.svelte`, `SpaceInviteModal.svelte` | `spaces.dart`: `SpacesMenuButton` ("Join with an invite", "Create a Space"), `CreateSpacePage`, `_Join` | `04-spaces/01-spaces-tab-light.png` (the entry only) | Sheets. Join: "Invite link or code" with Paste, a preview card (radius 20, raised; a skeleton while it loads), then "Join <Space>" or "Open <Space>". Create: a live preview card, a name (64 characters), "What's it about? · optional" (256), "Rooms, roles and invites come next.", Create Space. |
| **Add a bot to a Space** | `BotInviteModal.svelte` | none found | none | A sheet: the bot, a Space picker, "Add to Space". |
| **Confirmations**: delete a message; leave a Space or group; remove a friend; kick; unban; revoke an invite; delete a role, emoji, sticker, bucket, webhook, team, app or bot; reset a token; delete all attachments | `ConfirmDialog.svelte` and callers | `space_admin.dart` `confirmDestructive()`; `chat/actions.dart` `_showDeleteSheet`; `people.dart` `_confirmUnfriend` | none | A glass sheet: the title (Fraunces 22), 12, the body (15 px muted), 24, a full-width destructive button, 12, a full-width Cancel. Deleting a message shows the message in a recessed box (radius 16) first: "It will be removed for everyone in X…". |
| **Delete Space** (type its name) | `ServerSettings.svelte` (in place) | `spaces.dart` `_DeleteSpace` | none | The same sheet; the button is enabled once the name is typed. |
| **Ban, with a reason** | `BanDialog.svelte` | `people.dart` `_askBanReason` | none | The sheet with an optional Reason (512). |
| **Rename a group** | `PromptDialog.svelte` | `people.dart` `GroupInfoPage` | none | A sheet with one field. |
| **Unsaved changes** | (Settings) | `widgets/unsaved_changes.dart` `confirmDiscard` | none | The `oops` mascot at 120, primary "Keep editing", destructive "Discard". (S-48's unsaved bar is the prototype's in-page version.) |
| **Who reacted** | `ReactionsDialog.svelte` | `chat/reactors.dart` | none | A popover or sheet listing people per emoji. |
| **A bot's modal form** | `InteractionModal.svelte` | `widgets/bot_ui.dart` | none | A sheet with the bot's fields and selects. |
| **Crop a picture** | `ImageCropModal.svelte` | `account.dart` `CropPage` | `07-you/08-edit-profile-light.png` (edit profile) | A sheet over the picture. |
| **Files and buckets**: the file list, moving files, transfers and their failures, a bucket's files | `BucketFilesDialog`, `MoveFilesDialog`, `StorageTransferCard`, `StorageTransferFailures`, `FilePickerBar` | `account.dart` `MyFilesPage`, `StorageMeter`, `BucketMeter`, `FileRow`; `space_admin.dart` `SpaceStoragePage`, `BucketFormPage` | `07-you/06-my-files-light.png`, `07-you/04-you-tab-voice-storage-account-light.png`, `05-space-admin/23-storage-light.png` | In Settings' blocks. The meter in three shades of ink; buckets as rows ("x of y · Active/Off"); filters All · Largest · Images · Voice (the picked one in accent-text); file rows with a trash button. |
| **Developer**: a team, an app, its bot, its commands, a token shown once | `UserSettings.svelte` (Developer) | `developer.dart` `DeveloperPage`, `TeamPage`, `ApplicationPage`; `app_commands.dart` `CommandsPage`, `CommandEditorPage`; `space_admin.dart` `showSecretOnce` | `07-you/07-developer-portal-light.png`, `09-developer-team`, `10-developer-app`, `11-developer-app-commands`, `12-developer-command-editor` | Pages that slide in within the Settings window, in its blocks (panels of rows with section heads). |
| **Media controls outside a call**: mic (with the microphone picker), deafen, noise suppression | `UserStatusBar.svelte` | Mobile shows no controls outside voice. Its controls are `voice_room.dart` `VoiceControls`/`VoiceButton` | none | A row in the sidebar's bottom, above the profile row (BRIEF), in the call panel's controls' look (S-08: 30 tall, radius 10, `--secondary-fill`; off = destructive tint). Mic opens its device picker on a right-click or a chevron, as today. In a call, the row grows into the call panel. |
| **The media pop-out window** (new, desktop only) | none | none | none | A small OS window holding the media controls (and, in a call, the call panel's top row), on the Settings window's chassis without a sidebar. A button in the controls pops it out and back. Not on the web. The call stays in the main window. |
| **The voice-note playback bar** | `VoiceNoteBar.svelte` | `widgets/playback_bar.dart` `MediaPlaybackBar` | none | Mobile's: a glass bar 56 tall, a 2 px accent progress line on top, the title (16 px 500: "Voice message" or the file's name), "<sender> · m:ss / m:ss" (tabular), play/pause and ×. **Keep the app's speed and volume.** Place it in the sidebar's bottom, above the media controls (BRIEF). It doesn't pop out. |
| **Call banners in a chat**: "Call in progress — Join", "Calling from another device" | `ConversationView.svelte` | `calls.dart` `CallBanner` | none | A 36 px strip on `--sunken`, radius 12, under the header. |
| **Watch stream**; camera options; share options ("Screen only", "Screen + Audio"); the viewer count; a focused tile | `VoiceChannelView.svelte`, `StreamViewers.svelte` | `voice_room.dart` `VoiceControls`' More sheet (share screen, sound route, flip camera, camera list, incoming video) | none | A menu or popover from the control bar's camera and share buttons; "Watch stream" over a share's tile; an eye and count on the label. |
| **A floating stream** | `StreamWindow.svelte` | none | none | Keep it; it may be what a tile's Pop out opens (S-32). |
| **The Now section**: joinable calls, friend requests, team invites, transfers, busy voice rooms, online friends and what they're doing, the voice dock | `NowSection.svelte` | `ChatsTab` `NowBlock` and `OnlineFriends` | `01-chats/01-chat-list-light.png` | **No home in the prototype.** It needs one, or a decision (§9). |
| **Group info**: members, add a member, rename, leave | `ConversationView.svelte` | `people.dart` `GroupInfoPage` | none | The group's More menu, and the members popover with Add member at its foot. |
| **A room's or category's settings** | `ChannelSettings.svelte` | `space_admin.dart` | `05-space-admin/*` | Space settings → Rooms → the room (S-61), with its webhooks. |
| **The keyboard sheet** ("?") and **the jump marks** ("f") | `KeyboardLayer.svelte` | none | none | The sheet frame with S-55's rows; the marks as small keycaps over their targets. |
| **Asking for notification permission** (web) | `NotificationPermissionBar.svelte` | none | none | A glass bar like a notice, at the bottom centre. |
| **Staff: Edit Flags & Badges** | `MessageList.svelte` | none | none | A sheet. |
| **Empty, loading, error and offline states** | across the app | `widgets/skeleton.dart` `DuvetSkeleton`/`SkeletonBox` (the real rows as `--secondary-fill` blocks, pulsing from full to half over 2 s, even with reduced motion); `widgets/chrome.dart` `EmptyState`, `ConnectionBanner`; `DuvetMascot` moods | `06-calls/01-calls-tab-light.png` (an empty state) | The prototype draws empty states only (mascot, Fraunces title, a line). Draw loading as skeletons, and "Offline · showing saved messages", "Reconnecting… messages will send when you're back" and "Couldn't load the latest messages · tap to try again" as a 36 px strip (`--sunken`, radius 12, a 16 px icon). Failures to load: the `oops` mascot and Try again. |
| **Files waiting in the composer**, their upload progress, # and : suggestions, command options, pausing a recording | `ChatInput.svelte`, `CommandOptions.svelte` | the chat composer in `mobile/lib/chat/` (not checked in detail) | `02-conversation/09-composer-plus-menu-light.png` | Above the field, in the strips' place (S-23); suggestions in the @ panel's look (S-25). |
| **Audio files**, **spoilered files**, **four or more photos** | `MessageAttachments.svelte`, `AudioFilePlayer.svelte`, `SpoilerCover.svelte` | `widgets/media.dart` | `02-conversation/04-dm-youtube-voice-note-light.png` | An audio file as the voice note's card with a file's name; a spoiler as the specks over the tile; four photos as 2 × 2, more as 2 × 2 with "+N" on the last. |
| **A mobile-only person's presence** (a phone instead of a dot), **idle** | `StatusDot.svelte` | (mobile shows presence) | none | Keep both: the prototype has only online, do not disturb and offline. Idle uses `--duvet-warn` today. |
| **The "Search everywhere" results** | `MessageSearch.svelte` (everywhere mode) | `GlobalSearch` | `01-chats/07-search-light.png` | ⌘K's Messages filter (S-35). |

**The Settings and Space settings sections** the app has and the prototype lacks:
- Settings → Attachments and S3 Buckets: under My files.
- Settings → Audio: under Sounds.
- Settings → Activity Privacy: under Privacy.
- Space settings → Attachments: under Storage.
- A room's webhooks: in the room's page.

---

## 7. Scaffolding to drop, and proposals to leave out

### 7.1 Scaffolding: none of this ships

| What | Where in the prototype |
|---|---|
| **Tweaks**: the handle on the right edge and its panel (platform, theme, messages, window mode, wallpaper, Simulate Mention/Message/Incoming call, Reset the prototype), and the localStorage key `duvet-desktop-prototype:v1` | `app.js` `Tweaks`; `.tweaks`, `.tw-*`; `core.js` `PREF_FIELDS`, `D.resetPrefs` |
| **The fake desktop**: wallpapers (`wp-dusk` gradient, `wp-sky`, `wp-peaks`, `wp-sunset` photos), the macOS menu bar with its date and clock, the window's insets, its drawn shadow and inner edge, the "Full screen" window mode | `.wallpaper`, `.wp-*`, `.menubar`, `.mb-*`, `.main-window` insets, `.window` shadow and `::after`, `.fill`, `--win-edge`, `html, body` background `#0a0f2c` |
| **The sample world**: people, chats, Spaces, rooms, roles and their colours, messages, the call log, friends and requests, voice occupants, sticker packs (the ghost pack and the "Night Shift" text stickers), the GIF list and topics, pins, threads' replies, the screen share's run sheet, the search's "Recent" queries, every count and number (members, online, storage, invites, bans, webhooks, sessions, the masked email, "Changed 3 months ago", "Premium") | `data.js` (all of it); `app.js` (pins, unread, mentions, typing, the initial tabs and call); `pane.js` `RunSheet`; `overlays.js` (thread replies, recent searches, invite link); `windows.js` (every section's rows); `--role-*` tokens |
| **Photos from picsum.photos** | `assets/img/*` (avatars, banners, Space icons, photos, album art, GIF stand-ins, wallpapers) |
| **The fixed clock**: today at 12:41 PM, ticking from boot | `core.js` `D.now`, `D.clock`, `D.at`, `D.ago` |
| **Simulated events**: a message 6.5 s and a mention 9 s after boot; replies that come back with typing 0.9 s and 2.9 s after you send; a DM call answering itself after 2.6 s; a random input level; the panning "GIFs" | `app.js` (`demoMessage`, `demoMention`, `replies`, `replier`, `D.startCall`); `windows.js` `VoiceVideo`; `.gif img` animation |
| **Toasts standing in for actions** (copy them nowhere): "Duvet keeps running in the menu bar", "Zoom", "Opens in a new window", "Signed out (not really)", "Pick a file…", "Pick photos…", "Thread: N replies", "Are you sure?", "Focus on X", "Join or create a Space", "Switch account", "Request sent to X", "You waved at X 👋", "Notifications: …", "Muted for 1 hour", "X: done" | throughout |
| **The floating YouTube dock** | `overlays.js` `D.Dock`; `.dock*` (S-70) |
| **Its machinery**: Preact and htm, the store, the popover/menu/tooltip layers as written, the icon set as paths, the emoji data, the per-chat scroll memory, the "icon missing" warning | `assets/vendor/`, `core.js`, `assets/icons.js` (use `@lucide/svelte`), `assets/emoji.js` (use the app's data), `D.scrollMemory` (the app has its own scroll anchoring) |
| **Unused classes** | `.vibrant`, `.sp-play` beyond Spotify, `.dock-live` |

### 7.2 Proposals: what the prototype shows that the app can't do today

The brief adds two things only: the layout, and the media pop-out (and bubbles or flat rows as a setting). Everything below is a feature the app doesn't have. **Leave each out of the port, and list it for the lead.** "Check" means the app's code was searched without a clear answer; PARITY.md settles it.

**Tabs and windows**
1. Pin a tab; Duplicate a tab (S-02).
2. Open a chat in a new OS window (a pane's More, S-11). The brief's only new windows are Settings, Space settings and the media pop-out.
3. Start a video call as its own button (S-11). Calls can turn the camera on once started.

**Messages**
4. A message's right-click menu (S-21) is new UI. Its actions mostly exist, except **Copy text** and **Mark unread**.
5. The Spotify card (S-17).
6. Join messages, "Wave", "added to the group" rows, and "Call back" on a call row (S-18).
7. Videos in the media viewer; prev/next; thumbnails; Download, Open in browser and Reply from the viewer (S-41).
8. Several emoji at once ("Shift-click to pick several", S-26).
9. GIF topics (S-27): check KLIPY. Sticker packs with "by" (S-28).
10. Recent searches in the in-chat search (S-36).

**People and status**
11. A custom status; Switch account (S-07).
12. Pronouns; "On Duvet since"; mutual Spaces; Block (S-39): check.
13. Add a friend by username or "Duvet ID" (S-34): the app takes a user ID.
14. Notification levels with a timed mute ("Mute for 1 hour", "Mute until tomorrow"; S-05).

**Calls**
15. Full screen on a voice tile (S-32).
16. A voice room's chat beside it (S-32), if voice rooms take no messages today: check.

**Sheets**
17. Invite friends directly from the invite sheet (S-45).
18. Announcements rooms; private rooms (S-46); a room's topic ("What it's for"): check.

**Settings**
19. Privacy: devices, who can friend-request you, DMs from Space members, link previews, read receipts.
20. Account: two-step sign-in; download your data; delete account; "password changed" date.
21. Notifications: the whole section (desktop notifications, in-app notices, badge count, show message text, new Spaces' default, quiet hours).
22. Sounds: the prototype's list of sounds. Use the app's.
23. Voice and video: speakers; input level; push to talk; echo cancellation; mirror.
24. My files: WebDAV; export.
25. Appearance: bubble colour; text size; density; a code theme by name (the app takes a URL); "Play GIFs and stickers"; a "Reduce motion" override.

**Space settings**
26. Welcome messages' room; "Say hi when someone joins"; transfer ownership (S-59).
27. A role anyone can @mention (S-60).
28. Member nicknames (S-63).
29. Room overwrites for a member you add (S-61).

**Shortcuts**
30. The prototype's new shortcuts: ⌘T, ⌘W, ⌘N, ⌘F, ⌘E, ⌘\, ⌘,, ⌘⇧,, ⌘⇧M, ⌘⇧D, ⌃⌘S, ⌃Tab, ⌘U, R, E, ⌫. Section 8.10 has each against the app and the browser. Small, but new behaviour; the lead decides which come with the layout.

**Copy that must not ship as written**
- "GIFs come through Duvet's proxy: the GIF service never sees you" (S-27). False for the app.
- "Duvet keeps running in the menu bar" (S-01).
- Every "(not really)".

---

## 8. Behaviour worth porting carefully

What follows describes the prototype's mechanics so they can be rebuilt in Svelte. It is not code to copy.

### 8.1 Popover and menu placement (`D.place`, `D.Floating`)

**Inputs.**
- An anchor rectangle: an element's box, or a point (a right-click's position).
- The floating box's measured size.
- Options: `side` (bottom, top, right or left; default bottom), `align` (start, end or centre), `gap` (default 8), `inset`.
- The margin to the window's edge is 10.

**Bottom or top.**
1. Prefer the asked side.
2. If the box doesn't fit below (anchor's bottom + gap + height > window height − 10) but fits above, go above. For a top request, the other way round.
3. Top is anchor bottom + gap (below) or anchor top − gap − height (above).
4. Horizontally:
   - `align: end` puts the box's right edge on the anchor's right;
   - `centre` centres it;
   - `start` puts its left on the anchor's left.
   - With no alignment asked: `end` if the anchor's centre is in the window's right half, else `start`.

**Right or left** (submenus, profiles from a name).
1. Left is anchor right + gap. If that overflows the right edge, use anchor left − gap − width.
2. For a left request, the mirror.
3. Top is the anchor's top − `inset` (5 for submenus, so the first item lines up), or with `align: end` the anchor's bottom − height.

**Clamping.** Both coordinates are clamped to [10, window − size − 10].

**Gaps.** Menus from a button use 6. Menus at a point use 2. Tooltips use 6, centred.

**How a floating box appears.**
1. It renders off-screen (at −9999) and is measured.
2. It is placed, then gets `.placed`: opacity 0 → 1 in 160 ms, scale .97 → 1 in 280 ms on `--overshoot`.
3. Its transform-origin is the side that faces the anchor (top or bottom), and left or right by the anchor's half of the window.
4. A ResizeObserver on the box places it again when its content changes size, for example when a popover's list filters.

**Layers.**
- One popover, one menu (with its submenus) and one modal can be open at a time.
- Opening a popover closes the menu. Opening a modal closes both.
- A mousedown outside closes a menu, and a right-click elsewhere does too. A popover ignores clicks inside itself or inside a menu; the in-chat search also ignores its own field.
- Esc closes the innermost: the menu, then the popover, then the modal, then a Settings window.
- These layers sit at the page's root, so nothing clips them.

The app uses bits-ui for menus and popovers. Its placement must give the same results: the fallback order, the end alignment in the right half, the 10 px margin.

### 8.2 The message list keeps to the bottom (`D.MessageList`)

- **On opening a chat**, the list goes to where it was left (remembered per chat), else to the bottom.
- **"Pinned"** means within 24 px of the bottom.
- **A ResizeObserver** watches both the scroller and its content. While pinned, any change of size snaps the list back to the bottom: images loading, fonts arriving, the composer growing, a reply strip showing.
- **A new message** scrolls the list smoothly to the bottom if it was within 240 px of it, or if the message is yours.
- **On scroll**, with one update per animation frame:
  - remember the position;
  - work out "pinned" again;
  - move every Prism's side lights (§8.9);
  - tell the pane whether the list is scrolled more than 4 px (the header's glass) and more than 320 px from the bottom (the jump button).
- **A jump** (reply strip, pin, search result, notice) scrolls the message to the middle, smoothly, then flashes it for 1.6 s.

**In the app.** `scroll-anchoring` and `on-screen` keep long chats fast, and they stay. Build this pinning on top of them; don't replace them with the prototype's render-everything list. The startup and scroll timings must not get worse (team brief, rule 7).

### 8.3 The composer's height drives the list (`Composer`)

- A ResizeObserver on the composer bar writes its height to the pane as `--composer-h`.
- The list's bottom padding is `--composer-h` + 14, so the last message clears the bar however tall it grows: replies, typing lines, five lines of text, the recording row.
- The jump button sits at `--composer-h` + 12.
- The text area resets its height to `auto`, then takes its `scrollHeight`, capped at 132, on every change and every chat switch.
- The bar is glass over the list, so the messages scroll under it.

### 8.4 The header's glass, and the jump button

- The pane's header and its jump button read the list's scroll state.
- The header turns glass once the list is scrolled more than 4 px. It is always glass in a voice room, and during a call in a DM.
- The jump button shows past 320 px from the bottom, with unread and mentions as its count.

### 8.5 Opening things: click, ⌘-click, ⌥-click, middle click, drag

| Gesture | Result |
|---|---|
| Click | The focused pane of the active tab shows it. A split showing the same thing twice becomes one pane. |
| ⌘-click, middle click, "Open in new tab" | A new tab, after the active one, showing it. |
| ⌥-click, "Open in split view", ⌘\ then pick | A single pane gets it beside (focus moves there). A split replaces its other pane. Ratio 0.5. |
| Drop a row on a pane | Its right 40% (single pane): beside. Elsewhere: here. |
| Drop a row on a tab | Its left or right quarter: a new tab before or after it. Its middle: beside its pane. |
| Drop a tab on a tab | Quarters: move it there. Middle: join the two into a pair (only if the target is single). |
| Click a Space | Its last text room (voice rooms aren't remembered as last), unfolding it. |

A chat counts as read 1.4 s after it's shown in the active tab (the prototype's rule). Keep the app's read-state logic.

### 8.6 Tabs and pairs: the model

**The prototype's model.**
- A window has tabs.
- A tab is `{ panes: [ref] or [ref, ref], focus: 0 or 1, ratio, pinned }`. A ref is a chat, a room, a voice room or Friends.
- One strip lists the tabs. A pair shows as one wide tab with two halves.
- "Separate split view" turns a pair into two tabs. "Split with" or a drop joins two single tabs.
- Closing a tab activates the next one, or the one before. Closing the last leaves a "New tab" with nothing in it.

**The app's model** (`lib/pane.ts`).
- A tree of splits, horizontal and vertical, any depth.
- Each leaf has its own tabs and an active one. Tabs move between leaves.
- The tree is saved in localStorage.

**The gap.** The redesign's model is simpler, and loses vertical splits, more than two panes, and tabs per pane. Choose one:
- keep the app's tree, showing the focused leaf's tabs in the title bar;
- or adopt the pairs and report what's lost;
- or let a pair's halves hold the app's subtrees.

That's the lead's decision, and it comes before porting S-02 and S-10 (§9).

**Migration.** The saved layout (`duvet.openRooms.v1`) has to become whatever is chosen, without losing people's open chats.

### 8.7 The sidebar: resize, hide, filter, fold

- **Resize.**
  - A press on the 6 px handle starts it.
  - Moving sets the width to the start width plus the movement, clamped to 232–380.
  - Release ends it. While dragging, the whole page shows `col-resize` and nothing can be selected.
  - The width is remembered.
- **Hide.** The header button or ⌃⌘S. The tab strip then leads with the window controls (macOS) and a Show sidebar button.
- **Filter** (All · Chats · Spaces). Remembered.
  - Under All, the six-latest rule applies (S-05).
  - Under Chats, every chat shows, with no heads.
  - Under Spaces, the Spaces alone, without the "Spaces" head.
  - Each option's dot shows unread on the other side.
- **Fold.**
  - Spaces and categories fold separately, remembered by Space and by Space + category.
  - Clicking a folded Space opens it and unfolds it.
  - A folded category keeps showing the open room.
  - Quiet Spaces sit behind one row. Opening it shows them folded, unless you unfolded one.

### 8.8 Notices and toasts

- A notice is pushed when something arrives in a chat that isn't in any pane of the active tab. That chat's unread count, room flag and mentions rise as well.
- In Do not disturb only calls are pushed.
- Each notice leaves 7 s after it arrived (at least 0.8 s from now), unless it's a call.
- While the stack is hovered, nothing leaves, and the stack fans out.
- The newest three show.
- A click opens the chat and, 80 ms later, jumps to the message.
- Toasts are a column at the bottom centre, each 2.2 s.

### 8.9 Prism's moving light (`usePrism`, `D.updatePrism`)

On every render of a bubble that mentions you (bubbles only):
1. Its main light is centred on the mention: `--mx`, `--my` = the mention's centre within the bubble.
2. **Scale.** `--ps` = clamp(bubble width / 270, .4, 1).
3. **Slide.** Take `t` = (the bubble's vertical centre − the list's top) / the list's height, clamped to 0–1, and `slide` = 1 − `t`.
4. **Side lights.** `--cx` = (70 + slide × 150) × scale px; `--wx` = (30 + slide × 90) × scale px.
5. As the bubble moves up the list, the blue and pink lights slide right. The scroll handler updates every Prism bubble once per frame.

This is mobile's `prism.dart`, which also lifts names readable over the light (`behindName`, §9).

### 8.10 Shortcuts

| Keys | Prototype | The app today | Clash |
|---|---|---|---|
| ⌘K | Open or close ⌘K | Opens the quick switcher | none |
| ⌘1–⌘9 | That tab, or the last | That open chat; 9 is the last | Browsers keep Ctrl/⌘+1–9 on the web |
| ⌃Tab, ⌃⇧Tab | Next, previous tab | none | Browsers keep these on the web |
| ⌘T | ⌘K in its new-tab mode | none | Browsers keep it on the web (README) |
| ⌘W | Close the tab, or the focused Settings window | Ctrl+W closes a tab (`PaneView`) | Browsers keep it on the web |
| ⌘N | New conversation | none | Browsers keep it on the web |
| ⌘\ | ⌘K in its beside mode | none | none |
| ⌘, | Settings | none | Some browsers open their own settings |
| ⌘F | Focus the pane's search | none | The browser's find (the page may take it) |
| ⌘E | Emoji picker | none | Safari and Chrome on the Mac: "use selection for find" |
| ⌘⇧M | Mute in a call | none | Chrome on the Mac: the profile menu |
| ⌘⇧D | Deafen in a call | none | Chrome: bookmark all tabs |
| ⌃⌘S | Hide or show the sidebar (macOS only) | none | none |
| Ctrl+Shift+S | Shown in the tooltip off the Mac; **not handled** | none | none |
| ⌘U | Shown on "Upload a file"; **not handled** | none | none |
| ⌘⇧, | Shown on "Space settings…"; **not handled** | none | none |
| R, E | Shown in the hover bar and the menu; **not handled** | `r`, `e` with keyboard navigation on | Typing: single keys must not steal from the composer |
| ⌫ | Shown on Delete; **not handled** | none | none |
| ↑ (empty composer) | Edit your last message | The same | none |
| Esc | Close the innermost layer; cancel a reply or an edit | Closes layers; leaves the composer for keyboard navigation | Decide which Esc does what |
| ⌘/ | none | The shortcuts sheet | none |
| Alt+↑/↓, Alt+Shift+↓ | none | Previous/next chat, next unread | none |
| j k G J K u i f ? (keyboard navigation) | none | Move between messages, chats, unread; write; jump marks; help | none |
| Ctrl+N/P in ⌘K | none | Move in the switcher | none |

**Keep all of the app's shortcuts.** Add the prototype's on the desktop. On the web, leave out those the browser keeps, and show the others' real keys.

### 8.11 Theme

- The prototype resolves System to the OS's light or dark, and follows changes.
- The app already does the same (`lib/theme.ts`, `theme.svelte.ts`): the class `.duvet-light` on `<html>`, set before the first paint by `app.html`'s script, dark when the OS says nothing.
- **Keep that mechanism.** Change the values (§1.1), and give the dark values the role of the default, as `app.css` has them.
- The mascot and the logo pick their light or dark file by the resolved theme.

### 8.12 Search tokens (`SearchPopover`, `runSearch`)

- The query is split on spaces.
- Words with a colon are filters:
  - `from:x` (the start of a handle or name);
  - `has:` link, embed, file, image, video, sound or sticker;
  - `mentions:x`;
  - `pinned:yes`;
  - `before:`, `after:`, `during:` (dates; not implemented in the prototype).
- The other words must all appear.
- While the last token is `has:`, `from:` or `mentions:` with nothing or a partial value after it, the popover suggests values, and a pick replaces the token's tail.
- **The app's search does this for real**, with `in:` and `pinned:true/false` too (`lib/search.ts`). Keep it.

### 8.13 Settings windows

**The prototype's rules.**
- One Settings window. One Space settings window per Space.
- Opening an open one brings it forward and focused, at its new section.
- New windows cascade 28 px.
- The focused window is drawn above, and the others look inactive: the main window's lights grey and its strip at 80%; a Settings window's lighter shadow.
- On the web, a sheet, and only the last one shows.

**In Electrobun these are real windows.**
- The app has one `BrowserWindow` today, so it needs a second one, either for each window or for a route the Settings page loads in.
- The session, the theme and live state (profile edits, a Space's roles) must reach both.
- The main window's inactive look comes from the OS's focus events.

This is the largest engineering change in the redesign apart from the media pop-out, which needs the same and must never drop a call: the call stays in the main window (BRIEF).

### 8.14 The platform's window

**macOS vibrancy.**
- The sidebar's look needs the window to be transparent behind the sidebar, with a native visual-effect view.
- CSS `backdrop-filter` can only blur the page's own content.
- If Electrobun can't do it, the sidebar falls back to the Linux and web look: the solid Ghost tint, no blur.

**Traffic lights.**
- With `titleBarStyle: "hidden"`, macOS draws its own lights at a fixed spot.
- The design puts them at x 18 within a 52 px header, and they move to the tab strip when the sidebar hides.
- Either position the native ones there, or hide them and draw the prototype's. The second also covers the inactive grey.

**Windows and Linux.** The app already draws its buttons. They move into the tab strip.

### 8.15 Small rules worth keeping

- **Your bubble's ink:** white unless `#15172B` contrasts better with the picked colour (`D.inkOn`).
- **Jumbo emoji:** the text is emoji only (pictographs, components, VS16, ZWJ, spaces), at most 24 characters, with no digits, `#` or `*`.
- **A message's row time:** today the clock, yesterday "Yesterday", within a week the short weekday, else "18 Nov".
- **Day labels:** "Today", "Yesterday", the weekday within a week, else "Monday, 10 November".
- **A tab's unread dot:** the chat's unread + mentions + its room's flag, hidden on the focused half of the active tab.
- **A member's colour:** their top role that "shows separately"; a gradient role fills the text with a 90° gradient.
- **Containers, not the window:** the pane header compacts by the pane's width (620 and 480 px). A split pane compacts when it's narrow, whatever the window's size.

---

## 9. Contradictions

Each is a place where the prototype disagrees with `BRIEF.md`, mobile's `theme.dart` or mobile itself, with itself, or with what the app does. **Bold** ones need the lead's decision before the surface is ported.

### 9.1 The prototype against theme.dart and mobile

Most of these are deliberate: the brief asks for mobile's system "tuned for a mouse and for density".

1. **Sizes are smaller.**
   - Message text 15 against `body` 16.
   - Row names 13.5 against `rowTitle` 16.
   - Captions 11–12 against `caption` 13.
   - Overlines 10.5–11 at weight 600 against `overline` 12 at 500.
   - Headlines' line height 1.15–1.2 against 1.1; tracking −.012em against −.01.
   - Rows 50 against `sizeRow` 72 (compact 44 against `sizeRowCompact` 44).
2. **Radii are smaller**: buttons 11 against `radiusButton` 16; cards 16 against `radiusCard` 20; fields 10–11 against `radiusField` 12. Floating surfaces keep 20 and sheets 24.
3. **Fraunces at opsz 24** for Space names and the Settings head. theme.dart uses only 36, 72 and 144.
4. **Blurs**: the pane header's 24 px blur isn't `blurChrome` (20); the sidebar's 48 px has no theme.dart value.
5. **`--glass-strong`** (90–92%) has no theme.dart counterpart.
6. **No exit motion.** theme.dart has `panelOut` 250 ms on `decelerate`; the prototype removes everything at once.
7. **Prism has no `behindName`.** Mobile makes names on the spill readable against it (`#D3D0FD` / `#413A66`). Port it from `prism.dart`.
8. **Two reds.** `#E5484D` (Live, recording, Decline, Hang up, Leave) beside `--destructive` (`#B0443B` / `#E07A70`). Mobile's destructive buttons use `destructive`.
9. **The scrim.** Sheets' scrim is `rgba(7,7,10,.3)` in light, against theme.dart's `barrier` `rgba(0,0,0,.5)` and mobile's dialog sheet scrim `0x52000000` (.32).
10. **The storage bar uses four hues.** Mobile draws storage "in three shades of ink, never different hues" (`StorageMeter`).
11. **`--hairline` in dark** is .07 where `0x12` is .0706: a rounding, not a choice.

### 9.2 The prototype against BRIEF.md

1. **The media controls.** The brief: mic with its picker, deafen and noise suppression always above the profile, growing into the call panel. The prototype draws nothing outside a call, and the call panel has **no noise suppression and no microphone picker**. The ping is only a tooltip. The brief admits the row and the pop-out aren't drawn (§6).
2. **Quiet Spaces.** The brief: "Busy Spaces are open, quiet ones folded". The prototype hides the quiet ones behind one "N quiet Spaces" row, and lists them folded when it's opened.
3. **The screen share's strip.** The brief: "everyone else sits in a strip under it". The prototype's strip includes the sharer too.
4. **The incoming call.** The brief puts notices at the top centre "as today", and says nothing of calls. **The prototype moves the incoming call there too**; the app shows it bottom right (`CallCard`). It's a UX change the brief doesn't make.
5. **Editing a message.** **The prototype edits in the composer, with a strip; the app edits in place.** The brief doesn't mention it.
6. **The message menu on right-click**, and the hover bar holding fewer actions than the app's: UX the brief doesn't mention (the README lists right-clicking messages).
7. **"Open in new window"** on a pane. The brief's only new windows are Settings, Space settings and the media pop-out.
8. **The sidebar's search field "as today".** The app has no such field today, only ⌘K.
9. **The header's order.** The brief lists "traffic lights, sidebar toggle, New chat, Call history"; the prototype draws Calls, New chat, Hide sidebar.

### 9.3 The prototype against itself

1. **Shortcuts shown but not handled**: Ctrl+Shift+S (hide the sidebar off the Mac), ⌘U, ⌘⇧,, R, E, ⌫ (§8.10).
2. **The web writes "Ctrl+"** for a visitor on a Mac. It should follow the visitor's system.
3. **The composer's top hairline** is meant for when the list is scrolled away from the bottom (`.composer.over`). The prototype always passes `scrolledAway`, so it always shows.
4. **Four or more photos** fall into the three-photo grid; there's no layout for them.
5. **A file card always says "· PDF"**, whatever the file.
6. **`#room` mentions** resolve against one sample Space, even in DMs and other Spaces.
7. **The close button's toast** ("keeps running in the menu bar") shows on Windows and Linux too.
8. **Appearance → Reduce motion** does nothing; the CSS follows the OS only.
9. **The notices sit in the main column, not the window**, so they're centred on the main column, beside the sidebar. That's probably intended; keep it.
10. **The role colour tokens** (`--role-*`) are defined for one role in light and six in dark. They're sample-data patches.
11. **Five lines in the composer cover the last message** in `S-23-multiline`. §8.3's intent is that the list keeps clear of the bar, however tall it grows. Seen in a scripted run; whether it's the prototype or the timing wasn't settled. Port the intent.

### 9.4 The prototype against the app

These need a decision; until it's made, keep what the app does.

1. **The pane model** (§8.6). Pairs in title-bar tabs against the app's tree of horizontal and vertical splits with tabs in each pane.
2. **The members column.** "Nothing is docked on the right": the column (`GuildMemberSidebar`), its Auto/Shown/Hidden preference, and pinning the members popover open as the column all go.
3. **The search results panel** becomes a popover (same reason).
4. **Appearance's other rows.** "Spaces column: Fixed / Auto-hide" (with `SpaceEdge`), "Open chats: Tabs on top / Vertical list" and "Members column" have no place in the new layout. Each needs a decision. "Keyboard navigation", "Faces in voice" and the code theme URL stay.
5. **The Now section** has no home (§6).
6. **Settings as a window** where the app has a modal, and the Electrobun work it needs (§8.13).
7. **Videos** play inline in the app and in the viewer in the prototype.
8. **The GIF picker's privacy line is false** for the app (KLIPY is called directly). Don't port it.
9. **`--duvet-warn`** (an unverified email, a full store, idle) has no new value.
10. **Fira Sans goes.** `fonts.test.ts` asserts it by name and changes with it (§2.2).
11. **A voice room's chat beside it** (S-32): the app's voice rooms have no chat today.
12. **The icons** `smile`, `smile-plus` and `circle-check` differ between Lucide 1.70.0 (mobile) and the app's `@lucide/svelte` 0.577.0 (§3).

---

## 10. The reference screenshots

**590 screenshots** of 70 surfaces and 221 states, in `redesign-work/shots/prototype/` (outside git), with `manifest.json` beside them.
- 144 make up the main views' full matrix: 6 views × 4 platforms × 2 themes × 3 sizes.
- 446 are the other states.
- By platform: macOS 466, Windows 45, Linux 40, web 39.

**How they were taken.** By `redesign-work/tools/proto-shots.ts`, with Playwright's Chromium at 1× (`--dpr=2` for 2×).
- **Re-run one surface:** `bun proto-shots.ts S-12` from `redesign-work/tools/`. Several: `bun proto-shots.ts S-13 S-32`. The manifest keeps the other surfaces' entries. `--main` or `--detail` limit a run to the main matrix or the rest.
- **Its steps are functions.** Each state's `reach` function reads as a list of steps, and the manifest records them, in words, for every file.
- **The prototype is driven through its own store** (`window.D.setState`, which is what Tweaks does), with real clicks, hovers and keys wherever the prototype has them.
- **These states, and no others, use the page's state directly**, and their steps say so:
  - `S-22-count`: an unread count;
  - `S-32-grid` and `S-32-tile-hover`: the sample's screen share switched off;
  - `S-68-*`: a drag;
  - `S-69-bubble-colour`: the text-size slider.
- **Every file in `desktop-prototype/` is untouched.**
- **Hidden:** the Tweaks handle, by an injected style.
- **Cleared before each load:** the prototype's saved preferences.
- **The two arrivals the prototype fakes after boot** are fast-forwarded and undone, so every shot starts from the same state.
- **Animations** are disabled when a shot is taken: finite ones show their end, loops their first frame. The flash (`S-19-jump-flash`) is caught 450 ms in.
- **Comparing the app:** shoot it with reduced motion, or the same way.

**Sizes.**
- Each shot is clipped to the **app window**: `.main-window`, or the Settings or Space settings window (`.oswin`) on macOS, Windows and Linux.
- The size in a file's name is the window's. The viewport was larger by the fake desktop's margins (§5): macOS +48 × +66, Windows and Linux +48 × +42, web none.
- A Settings shot is 860 × 620 and a Space settings shot 940 × 660: the windows' own sizes at a 1280 × 800 main window.
- The macOS window's rounded corners show a little of the fake wallpaper.
- The app should be shot at the window size in the file's name.

**The files**, by surface and state. In the right column, `m-l` = `__mac-light-<layout>-1280x800.png`, `m-d` = `__mac-dark-…`, `win`/`linux`/`web` = that platform in light at 1280×800. ★ marks the full matrix: `__{mac,win,linux,web}-{light,dark}-<layout>-{1024x700,1280x800,1512x945}.png`.

| Surface | State (file prefix) | Shots |
|---|---|---|
| S-01 Window chrome | `S-01-controls-hover`: Windows: Close hovered (red); Linux: GNOME's round buttons | linux, m-d, m-l, win |
|  | `S-01-inactive`: The main window while another Duvet window (Settings) has focus: grey traffic lights, the tab strip at 80% | m-d, m-l |
|  | `S-01-traffic-hover`: Traffic lights hovered: their glyphs show | m-d, m-l |
| S-02 Title-bar tab strip | `S-02-hover`: An inactive tab hovered: tint and its close button | m-d, m-l |
|  | `S-02-many`: Twelve tabs: they shrink to 112 px, then the strip scrolls sideways (its scrollbar hidden) | m-d, m-l |
|  | `S-02-pair-active`: The joined pair active: the focused half tinted | m-d, m-l |
|  | `S-02-pair-tooltip`: A pair's tooltip names both halves | m-d, m-l |
|  | `S-02-pinned`: A pinned tab: 44 px, its icon only, no close button | m-d, m-l |
|  | `S-02-single`: One tab | m-d, m-l |
| S-03 Sidebar header | `S-03-new-chat-tip`: New chat's tooltip, with its shortcut (⌘N, Ctrl+N off the Mac) | m-d, m-l, win |
| S-04 Sidebar search field | `S-04-hover`: Hovered: its text darkens | m-d, m-l |
| S-05 Chats section | `S-05-chats-only`: The switch on Chats: no section heads, every chat | m-d, m-l |
|  | `S-05-expanded`: Under All, “4 more chats” clicked: every chat, then “Show fewer” | m-d, m-l |
|  | `S-05-in-call`: A chat in a call: “In a call” in green, no time | m-d, m-l |
|  | `S-05-row-hover`: A chat row hovered | m-d, m-l |
| S-06 Spaces tree | `S-06-add-space-hover`: The Spaces section hovered under All: its + button | m-d, m-l |
|  | `S-06-category-folded`: The Talk category folded while #general is open: #general stays | m-d, m-l |
|  | `S-06-folded`: Night Shift Radio and Lantern Games folded: a mention chip, an unread dot | m-d, m-l |
|  | `S-06-quiet-open`: “4 quiet Spaces” opened: the quiet ones listed, folded | m-d, m-l |
|  | `S-06-space-hover`: A Space row hovered: its … button | m-d, m-l |
|  | `S-06-spaces-only`: The switch on Spaces: the busy Spaces open, rooms, voice occupants | m-d, m-l |
| S-07 Sidebar bottom: profile row and the All · Chats · Spaces switch | `S-07-dnd`: Do not disturb: the status line and the red presence | m-d, m-l |
|  | `S-07-no-call`: Not in a call: the profile row and the switch only | m-d, m-l |
|  | `S-07-profile-hover`: The profile row hovered | m-d, m-l |
|  | `S-07-spaces-dot`: The switch on Spaces, with unread chats: a dot on Chats | m-d, m-l |
| S-08 Call panel | `S-08-camera-share`: Camera and screen share on: both buttons accent | m-d, m-l |
|  | `S-08-dm-calling`: A DM call ringing: “Calling…” | m-d, m-l |
|  | `S-08-dm-in-call`: A DM call answered: “In a call” | m-d, m-l |
|  | `S-08-hover-where`: Its title hovered: the room underlines (click goes to the voice room) | m-d, m-l |
|  | `S-08-muted-deafened`: Deafened (which mutes too): both buttons red | m-d, m-l |
| S-09 Sidebar resize and hide | `S-09-hidden`: Hidden: the tab strip leads with the window controls (macOS) and Show sidebar | linux, m-d, m-l, web, win |
|  | `S-09-narrowest`: Dragged to its narrowest, 232 px | m-d, m-l |
|  | `S-09-widest`: Dragged to its widest, 380 px | m-d, m-l |
| S-10 Panes and split view | `S-10-gutter-hover`: The gutter hovered: 3 px accent tint | m-d, m-l |
|  | `S-10-narrow-left`: The gutter dragged to 28%: the narrow pane's header compacts (search to an icon, member count hidden) | m-d, m-l |
|  | `S-10-split`: Two chats side by side in one tab, the right one focused | ★ 24 (bubbles) |
| S-11 Pane header | `S-11-at-rest`: At the top of a chat: no glass, no hairline | m-d, m-l |
|  | `S-11-group`: A group: Facehash, name, members and online, call, video, pins, members, search, more | m-d, m-l |
|  | `S-11-room`: A room: Space icon, # name, Space · topic, pins, members, search, more | m-d, m-l |
|  | `S-11-voice`: A voice room (left) and its chat (right, “On Air chat”) | m-d, m-l |
| S-12 Empty pane | `S-12-empty`: Every tab closed: “Where to?” | ★ 24 (bubbles) |
| S-13 Messages in bubbles | `S-13-dm`: A DM at its bottom: azure own bubbles right, card bubbles left, no avatars or names | ★ 24 (bubbles) |
|  | `S-13-dm-prism`: A mention of you (Prism): light, rim and violet shadow; a quote; a reply | m-d, m-l |
|  | `S-13-dm-top`: A DM at its top: the chat's intro, a day separator, two photos with a reaction | m-d, m-l |
|  | `S-13-group`: A group at its bottom: avatars beside each group's last bubble, names on the first, the New messages line, typing | m-d, m-l |
|  | `S-13-group-middle`: A group's middle: replies, reactions from many, a file, a pin, code and a spoiler | m-d, m-l |
|  | `S-13-long-text`: A long message you sent: the bubble caps at 65% of the pane | m-d, m-l |
|  | `S-13-room`: A room in bubbles: role colours (a gradient for the host), a bot with its BOT tag, a thread | m-d, m-l |
|  | `S-13-room-prism`: A room's mention of you, mid-list | m-d, m-l |
| S-14 Messages in flat rows | `S-14-dm`: A DM in flat rows | m-d, m-l (flat) |
|  | `S-14-hover`: A continuation row hovered: its time in the gutter, the hover bar along its top edge | m-d, m-l (flat) |
|  | `S-14-mention`: A mention of you in a flat row: the Prism light as a wash behind the row | m-d, m-l (flat) |
|  | `S-14-room`: A room in flat rows: 36 px avatars, names and times on each group's head | ★ 24 (flat) |
| S-15 Message text | `S-15-bold-quote-rooms`: Bold, a quote, #room mentions as chips | m-d, m-l |
|  | `S-15-code-spoiler`: A YAML code block with its language, a hidden spoiler, inline mentions | m-d, m-l |
|  | `S-15-inline-code`: Bold headings, inline code, many reactions (412) | m-d, m-l |
|  | `S-15-spoiler-open`: The spoiler clicked open | m-d, m-l |
| S-16 Attachments | `S-16-file-card`: A file card | m-d, m-l |
|  | `S-16-portrait`: One portrait photo, at its own aspect | m-d, m-l |
|  | `S-16-three-photos`: Three photos: one tall, two stacked | m-d, m-l |
|  | `S-16-voice-note`: A voice note at rest | m-d, m-l |
|  | `S-16-voice-own`: Your own voice note: on your bubble colour | m-d, m-l |
|  | `S-16-voice-playing`: A voice note playing: the bars fill, pause shows, the time counts | m-d, m-l |
| S-17 Embeds | `S-17-bot-fields`: A bot's embed with fields and buttons | m-d, m-l |
|  | `S-17-bot-status`: A bot's build cards: passed and failed | m-d, m-l |
|  | `S-17-invite-joined`: The invite after Join: Open, and a toast | m-d, m-l |
|  | `S-17-link-spotify`: A link preview with its image; a Spotify card | m-d, m-l |
|  | `S-17-youtube-invite`: A YouTube card; a Space invite card with Join | m-d, m-l |
| S-18 System rows | `S-18-added-pinned`: Someone added; a pin, with See all | m-d, m-l |
|  | `S-18-calls`: A call that lasted, a call no one answered (red), Call back | m-d, m-l |
|  | `S-18-joined-wave`: Someone joined the Space, with 👋 Wave | m-d, m-l |
|  | `S-18-missed`: A missed call from them | m-d, m-l |
| S-19 Replies, reactions, threads | `S-19-jump-flash`: A reply strip clicked: the list jumps to the original, which flashes | m-d, m-l |
|  | `S-19-reacted`: A reaction of yours added: violet | m-d, m-l |
|  | `S-19-reaction-tip`: A reaction's tooltip names who reacted | m-d, m-l |
|  | `S-19-thread-chip`: A message with a thread: its chip | m-d, m-l |
| S-20 Hover bar | `S-20-mid-group`: On a bubble that isn't its group's last: the time leads the bar | m-d, m-l |
|  | `S-20-mine`: On your bubble: beside it, left, mirrored, with Edit | m-d, m-l |
|  | `S-20-theirs`: On their bubble: beside it, right | m-d, m-l |
| S-21 Message menu | `S-21-mine`: From the hover bar's … on your message: with Edit and Delete | m-d, m-l |
|  | `S-21-theirs`: Right-click on their message: reactions, Reply, Copy text, Copy link, Mark unread, Pin | m-d, m-l |
|  | `S-21-thread`: On a message with a thread: View thread | m-d, m-l |
| S-22 Jump to latest | `S-22-count`: Scrolled up with 3 unread: the round button and its count | m-d, m-l |
| S-23 Composer and its strips | `S-23-edit`: Editing your last message (↑): the strip, the bubble outlined, Save | m-d, m-l |
|  | `S-23-multiline`: Several lines: the field grows to 132 px, then scrolls | m-d, m-l |
|  | `S-23-recording`: Recording a voice note | m-d, m-l |
|  | `S-23-reply`: Replying: the strip above the field | m-d, m-l |
|  | `S-23-text`: Text typed: Send turns cobalt; the field's focus ring | m-d, m-l |
|  | `S-23-typing`: Someone typing: the line above the field | m-d, m-l |
| S-24 The + menu | `S-24-dm`: In a chat | m-d, m-l |
|  | `S-24-room`: In a room: with Use a command | m-d, m-l |
| S-25 @ suggestions | `S-25-group`: @ typed in a group | m-d, m-l |
|  | `S-25-room-filtered`: @k typed in a room: names in role colours, the first picked | m-d, m-l |
| S-26 Emoji picker | `S-26-compose`: From the composer in a room: tabs, search, categories, Recent, the Space's own emoji | m-d, m-l |
|  | `S-26-hover`: An emoji hovered: it grows, the footer names it | m-d, m-l |
|  | `S-26-react`: For a reaction: no tabs, “Pick a reaction” | m-d, m-l |
|  | `S-26-search`: Searched: results | m-d, m-l |
| S-27 GIF picker | `S-27-topic`: A topic picked | m-d, m-l |
|  | `S-27-trending`: Trending | m-d, m-l |
| S-28 Sticker picker | `S-28-packs`: The packs | m-d, m-l |
| S-29 Notices | `S-29-incoming-call`: An incoming call: Decline and Accept (Accept rings) | m-d, m-l |
|  | `S-29-mention`: A mention of you | m-d, m-l |
|  | `S-29-message`: A message in a chat not in view | m-d, m-l |
|  | `S-29-stack`: Three at once: stacked, the newest in front | m-d, m-l |
|  | `S-29-stack-open`: The stack hovered: fanned out, each with its × | m-d, m-l |
| S-30 Toasts | `S-30-toast`: A toast at the bottom centre | m-d, m-l |
| S-31 A call in a DM or group | `S-31-connected`: Answered: the timer, Mara speaking (green ring, talking mouth) | m-d, m-l |
|  | `S-31-group`: A group call: three of them and you | m-d, m-l |
|  | `S-31-muted`: Muted | m-d, m-l |
|  | `S-31-ringing`: Ringing: the stage above the chat, “Calling Mara…” | m-d, m-l |
|  | `S-31-small`: Shrunk to its bar | m-d, m-l |
| S-32 Voice room | `S-32-controls-on`: Muted, deafened, camera on: your tile shows video | m-d, m-l |
|  | `S-32-empty`: An empty voice room | m-d, m-l |
|  | `S-32-grid`: No screen share: the tiles fill the pane (five: three columns) | m-d, m-l |
|  | `S-32-not-joined`: Not joined: the room, who's in it, Join voice | m-d, m-l |
|  | `S-32-share`: The room's chat closed | m-d, m-l |
|  | `S-32-share-chat`: Joined, someone sharing a screen: the stage, the strip under it, the room's chat beside | ★ 24 (bubbles) |
|  | `S-32-tile-hover`: A tile hovered: Pop out and Full screen | m-d, m-l |
| S-33 Call history popover | `S-33-all`: All calls | m-d, m-l |
|  | `S-33-missed`: Missed only | m-d, m-l |
| S-34 Friends | `S-34-add-typed`: A username typed: Send request enabled | m-d, m-l |
|  | `S-34-all`: All friends | m-d, m-l |
|  | `S-34-online`: Online friends | ★ 24 (bubbles) |
|  | `S-34-pending`: Pending requests: Accept and Decline | m-d, m-l |
|  | `S-34-row-hover`: A row hovered: raised, its banner brighter | m-d, m-l |
|  | `S-34-row-menu`: A row's … menu | m-d, m-l |
|  | `S-34-sent`: Sent requests: Cancel request | m-d, m-l |
| S-35 ⌘K palette | `S-35-beside`: From ⌘\: “Open beside…” | m-d, m-l |
|  | `S-35-call`: From Calls → Start a call: “Call someone…” | m-d, m-l |
|  | `S-35-messages`: The Messages filter, “rain” typed | m-d, m-l |
|  | `S-35-new-tab`: From + in the tab strip: “Open in a new tab…” | m-d, m-l |
|  | `S-35-nothing`: Nothing found | m-d, m-l |
|  | `S-35-open`: Opened: Recent | m-d, m-l, win |
|  | `S-35-people`: The People filter | m-d, m-l |
|  | `S-35-query`: “ma” typed: the matching chats, people and messages (the sample has no room or Space to match), the first picked | m-d, m-l |
|  | `S-35-spaces`: The Spaces filter | m-d, m-l |
| S-36 In-chat search | `S-36-focused`: The field focused: it widens, Filters and Recent | m-d, m-l |
|  | `S-36-from`: “from:” typed: the chat's people | m-d, m-l |
|  | `S-36-has`: “has:” typed: its values | m-d, m-l |
|  | `S-36-none`: No results | m-d, m-l |
|  | `S-36-results`: “poster” typed: results, the word marked | m-d, m-l |
| S-37 Pins | `S-37-empty`: Nothing pinned | m-d, m-l |
|  | `S-37-list`: Pinned messages | m-d, m-l |
| S-38 Members | `S-38-group`: A group's members (from its title) | m-d, m-l |
|  | `S-38-profile`: A member clicked: their profile, with Back | m-d, m-l |
|  | `S-38-search`: Searched | m-d, m-l |
|  | `S-38-space`: A Space's members: separate roles, then Online and Offline; the owner's crown; Invite people | m-d, m-l |
| S-39 Profiles | `S-39-bot`: A bot's: BOT, no call button, no “since” | m-d, m-l |
|  | `S-39-dm`: Someone's profile, from a DM's title | m-d, m-l |
|  | `S-39-more`: Its … menu | m-d, m-l |
|  | `S-39-no-banner`: No picture, no banner: Facehash and a gradient | m-d, m-l |
|  | `S-39-own`: Your own: Edit profile | m-d, m-l |
|  | `S-39-space-member`: In a Space: their name in their role's colour, roles, the owner's crown | m-d, m-l |
| S-40 Thread popover | `S-40-thread`: A thread: the message, replies, a reply field | m-d, m-l |
| S-41 Media viewer | `S-41-bare`: Clicked once: the chrome hides | m-d, m-l |
|  | `S-41-gallery`: One of two photos: arrows, thumbnails | m-d, m-l |
|  | `S-41-single`: A single photo | m-d, m-l |
|  | `S-41-video`: A video: its controls | m-d, m-l |
| S-42 Context menus | `S-42-chat-row`: A DM's row | m-d, m-l, win |
|  | `S-42-group-row`: A group's row: Leave group | m-d, m-l |
|  | `S-42-header-dm`: A DM header's … | m-d, m-l |
|  | `S-42-header-room`: A room header's … | m-d, m-l |
|  | `S-42-header-split`: A split pane header's …: Close this side | m-d, m-l |
|  | `S-42-notifications`: Its Notifications submenu | m-d, m-l |
|  | `S-42-profile`: Your profile row: status, custom status, edit profile, settings, switch account, sign out | m-d, m-l |
|  | `S-42-room-row`: A room's row | m-d, m-l |
|  | `S-42-space-row`: A Space's row (also its … button and a room's header title) | m-d, m-l |
|  | `S-42-tab`: A tab: Split with (submenu) | m-d, m-l |
|  | `S-42-tab-pair`: A joined pair: Separate split view | m-d, m-l |
| S-43 Tooltips | `S-43-plain`: A plain tooltip | m-d, m-l |
|  | `S-43-shortcut`: A tooltip with its shortcut | m-d, m-l, win |
| S-44 New conversation sheet | `S-44-empty`: Opened | m-d, m-l |
|  | `S-44-group`: Three picked: the Group name field, Create group | m-d, m-l |
|  | `S-44-one`: One person picked: Start chat | m-d, m-l |
| S-45 Invite people sheet | `S-45-room-sent`: To a room (“They land in #general”), one invite sent | m-d, m-l |
|  | `S-45-space`: To a Space | m-d, m-l |
| S-46 Create room sheet | `S-46-text`: A text room's form, named | m-d, m-l |
|  | `S-46-types`: Its three kinds | m-d, m-l |
|  | `S-46-voice-private`: A voice room's form, private | m-d, m-l |
| S-47 Settings window | `S-47-nav-search`: Its sidebar searched | m-d, m-l |
|  | `S-47-unfocused`: Unfocused (the main window clicked): grey traffic lights, a lighter shadow | m-d, m-l |
|  | `S-47-window`: The window on each platform (Appearance) | linux, m-d, m-l, web, win |
| S-48 Settings: Profile | `S-48-profile`: Banner, picture, name, form | m-d, m-l |
|  | `S-48-unsaved`: A change: the unsaved-changes bar | m-d, m-l |
| S-49 Settings: Account | `S-49-account`: Sign-in, your data, sign out, delete | m-d, m-l |
| S-50 Settings: Privacy | `S-50-privacy`: Sessions, who can reach you, chats | m-d, m-l |
| S-51 Settings: Appearance | `S-51-bottom`: Your bubbles and Reading | m-d, m-l |
|  | `S-51-top`: Theme and Messages | m-d, m-l |
| S-52 Settings: Notifications | `S-52-notifications`: On this computer, new Spaces, quiet hours | m-d, m-l |
| S-53 Settings: Sounds | `S-53-bottom`: Scrolled | m-d, m-l |
|  | `S-53-sounds`: Volume and each sound | m-d, m-l |
| S-54 Settings: Voice and video | `S-54-bottom`: Video: the preview | m-d, m-l |
|  | `S-54-top`: Voice | m-d, m-l |
| S-55 Settings: Keyboard | `S-55-bottom`: Scrolled | m-d, m-l |
|  | `S-55-keyboard`: Shortcuts (Ctrl off the Mac) | m-d, m-l, win |
| S-56 Settings: My files | `S-56-files`: Storage used, where files live, export | m-d, m-l |
| S-57 Settings: Developer | `S-57-developer`: Teams and applications | m-d, m-l |
| S-58 Space settings window | `S-58-window`: The window on each platform (Overview) | linux, m-d, m-l, web, win |
| S-59 Space settings: Overview | `S-59-bottom`: Scrolled: new members, ownership, delete | m-d, m-l |
| S-60 Space settings: Roles | `S-60-everyone`: @everyone: no colour, the name locked | m-d, m-l |
|  | `S-60-gradient`: Its name colour opened: a gradient | m-d, m-l |
|  | `S-60-highest`: The highest role: the callout, members, permissions | m-d, m-l |
|  | `S-60-permissions`: Scrolled: the permission groups | m-d, m-l |
|  | `S-60-solid`: A solid colour | m-d, m-l |
| S-61 Space settings: Rooms | `S-61-list`: Categories and rooms | m-d, m-l |
|  | `S-61-room`: A room's permissions: Deny · Role default · Allow per role | m-d, m-l |
|  | `S-61-room-menu`: A room's … menu | m-d, m-l |
| S-62 Space settings: Emojis and stickers | `S-62-emojis`: Emojis and stickers, with Upload | m-d, m-l |
| S-63 Space settings: Members | `S-63-row-menu`: A member's … menu: roles, nickname, kick, ban | m-d, m-l |
|  | `S-63-table`: The members table | m-d, m-l |
| S-64 Space settings: Invites | `S-64-invites`: Invite links | m-d, m-l |
| S-65 Space settings: Bans | `S-65-bans`: Bans | m-d, m-l |
| S-66 Space settings: Webhooks | `S-66-webhooks`: Webhooks | m-d, m-l |
| S-67 Space settings: Storage | `S-67-storage`: Storage and buckets | m-d, m-l |
| S-68 Drag and drop | `S-68-pane-beside`: A chat dragged over a pane's right part: Open beside | m-d, m-l |
|  | `S-68-pane-here`: Over its left part: Open here | m-d, m-l |
|  | `S-68-tab-before`: Onto its left quarter: a drop line before it | m-d, m-l |
|  | `S-68-tab-join`: A tab dragged onto the middle of another: join | m-d, m-l |
| S-69 Appearance-driven states | `S-69-bubble-colour`: Your bubbles in another colour (pink), text size 17 | m-d, m-l |
|  | `S-69-compact`: Density: Compact | m-d, m-l |
| S-70 YouTube dock (scaffolding: not to port) | `S-70-dock`: The floating player the prototype opens from a YouTube card. The desktop plays embeds in their message: do not build this. | m-d, m-l |
