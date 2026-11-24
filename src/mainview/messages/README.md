# The app's words (#464)

Every word the app shows comes from here, through `t()` (`$lib/i18n`). `en.json` is the source; the other files translate it key for key (`GLOSSARY.md` says how). A language ships once its file has every key (`SHIPPED` in `src/lib/i18n/locale.ts`); until then a missing key shows the English. The mobile app copies these files, so a key is a promise to both apps.

## Adding words

1. **Add the key to `en.json`, then run `bun run messages:sort`.**
   - Keys are flat `snake_case`, starting with the area's prefix (below).
   - Name what the words mean, not what they say: `chat_pin_notice`, not `chat_pinned_a_message`. Then a reworded sentence keeps its key.
   - Other languages get their words when they're translated: don't copy English into them.
2. **Show it:**
   - in text, `{t("chat_input_placeholder")}`;
   - in an attribute, `aria-label={t("call_mute")}`;
   - with values, `t("people_friends_online", { count })`.
3. **Add a note in `descriptions.json`** when the English alone doesn't say what it means: where it shows, what fills each placeholder, and whether the word is a verb or a noun. Start it with `[short]` when it sits in a fixed width (a button, a tab, a menu item, a column).
4. **Keep the tests on English:** `t()` gives English in the tests. A test that reads a component's source looks for the key; a test of what's drawn reads the English.

### One sentence, one key

Never build a sentence out of pieces: other languages reorder, inflect and agree. For example, `"Kick " + name + " from " + space + "?"` becomes one key, `"Kick {name} from {space}?"`.

- **A number:** use a plural.
  - `{count, plural, one {# member} other {# members}}`
  - `{count, plural, =0 {No files} one {# file} other {# files}}`
  - `#` is the number, written the locale's way: its digits and grouping (1,234 in English, 1.234 in German).
- **A number with no noun:** `{count, number}`, e.g. `Watching ({count, number})`, `{done, number} of {total, number}`.
- **A word that swaps in:** use a select, so each case is a whole sentence. For example, `{place, select, room {Leave this room?} call {Leave this call?} other {Leave?}}`. The value passed is the case's name (`place: "room"`); `other` is required.
- **Markup inside a sentence:** use tags, drawn by `Rich.svelte` with a snippet per tag:

  ```svelte
  {#snippet who(text: string)}<span class="font-medium">{text}</span>{/snippet}
  {#snippet pins(text: string)}<button onclick={showPins}>{text}</button>{/snippet}
  <Rich key="chat_pin_notice" values={{ name }} tags={{ b: who, link: pins }} />
  ```

  with `"chat_pin_notice": "<b>{name}</b> pinned <link>a message</link>."`. Values are filled in after the message is read, so a name is never markup. Plain `t()` shows tags as text, so a message with tags is only for `Rich`.

### Words from a module

A module never calls `t()` when it loads: a constant keeps the words of the language it was made in. Use one of these:

- Give back the key, and let the template call `t()`:

  ```ts
  const LABELS: Record<Status, MessageKey> = { dnd: "status_dnd" };
  ```

- Call `t()` inside the function that's asked for the words, so its caller gets them in the language of the moment.

A `$derived` or a template expression that calls `t()` runs again when the language changes; a `const` in a component's script doesn't, so it needs `$derived(t(...))`.

A svelte/store `derived()` runs its callback untracked: `t()` in it keeps the language its inputs last changed in. List `appLocale` (`$lib/i18n`) among its inputs, or keep keys in the store and call `t()` where it's drawn.

### Dates, numbers, lists and sizes

Use `$lib/i18n/format`:

- `formatDate(date, options)`
- `formatNumber(n, options)`
- `formatList(items)`
- `formatRelativeTime(value, unit)`
- `formatFileSize(bytes)`

Never call `Intl` with a locale of its own, or `toLocaleString()`.

A plain placeholder writes a number as it is: `{n}` gives 1234567 in every language, ungrouped and in Latin digits. A number people read (a count, a size, a limit, a percentage, a duration's figure, a place in a list) goes in `{n, number}` or a plural's `#`, which write it the locale's way, with its digits and grouping: 1,234,567 in English, 1.234.567 in German. That locale is the one `formatNumber` writes in: the app's language, in the system's region when the system is in that language (1.234.567 in English on a system set to English (Germany)), so a count and a size in one sentence agree. A value already written by `formatNumber`, `formatFileSize` or `formatDate` is a string and goes in a plain `{name}`, and so does an ID, a code, a year or a key cap, passed as a string.

### ICU, briefly

- **Placeholders:** `{name}` is filled in by the values passed, as they are; `{name, number}` writes a number in the locale's digits and grouping.
- **Apostrophes:** an apostrophe right before `{`, `}` (or `#` in a plural) quotes it. Write `''` for an apostrophe there; elsewhere `'` is just itself (`Duvet's`).
- **Literal braces:** write a literal `{` as `'{'`.

### What isn't translated

- What people wrote: names, messages, bios, Space and room names.
- Brands: Duvet, Duvet Premium, Spotify, GitHub, KLIPY.
- Addresses and code.
- The Mac's key symbols: ⌘ ⌥ ⇧ ⌃.

Key names are words, though: Ctrl, Alt, Shift and Esc are translated (German writes Strg).

## Prefixes

| Prefix | Area |
|---|---|
| `auth_` | sign-in, sign-up, password and e-mail pages |
| `public_` | the invite and download pages |
| `shell_` | sidebars, tabs, panes, the title bar, the quick switcher, the Now section, menus of the shell |
| `keys_` | key names and the keyboard shortcuts sheet |
| `status_` | online statuses |
| `chat_` | messages, the composer, search, pins, commands and interactions |
| `media_` | pickers (emoji, GIF, stickers), previews, players, embeds, voice notes, reactions |
| `emoji_` | emoji categories |
| `call_` | voice rooms, calls, call history, screen share, the media controls |
| `people_` | friends, members, profiles, direct messages and groups, invites, the confirm and prompt dialogs |
| `settings_` | Settings |
| `space_` | a Space's settings, its members and bans |
| `room_` | a room's settings and webhooks |
| `perm_` | permissions' names and descriptions |
| `mod_` | kicking and banning |
| `storage_` | buckets, moving files, transfers |
| `error_` | errors and notices that come from the API or the network |
| `format_` | sizes and other formats (`lib/i18n/format.ts`) |
| `menu_`, `window_`, `os_` | the Bun process: the menu bar, window titles, permission prompts |
