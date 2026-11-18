# Decisions and judgment calls

Every call the redesign made without asking the founder, with the reason. The parity ledger
(`PARITY.md`) points here for anything marked "see DECISIONS.md". Newest first.

## Gate 0: where every capability goes (2026-11-18)

Every P-item's "New home" was filled by a script that maps each item's component to its surface in the
new design, then reviewed by hand where the script had no answer. The mapping is: the sidebar, tabs and
panes keep their components under the Shell workstream; messages and the composer are Conversation;
popovers, menus, pickers, dialogs and notices are Overlays; voice, video, calls and every media player
are Calls & media; Settings, Space settings, room settings, webhooks, bans, storage and the developer
screens are Windows (windows of their own on desktop, sheets on the web); the auth pages and the invite
page are Auth & pages; `src/bun` is Main process; tokens, fonts, theme, stores and shared logic are
Foundation.

Items whose behaviour is purely logic (API client, stores, permissions) keep working as they do today;
their home says "unchanged". A home that says "Keep as today" would mean the design couldn't take the
item — after the review there are none: every item has a home.

## The prototype's unanswered questions (2026-11-18)

The design map's writer listed questions the brief doesn't answer. Rulings:

1. **The pane model.** The prototype draws two side-by-side panes joined in the strip; today's app is a
   split tree (`lib/pane.ts`) with vertical and deeper splits. The tree stays (dropping it would lose
   features): two side-by-side tabs render as the prototype's joined pair, and deeper or vertical splits
   keep working in the new look. Nothing of `pane.ts` changes; `pane.test.ts` keeps passing.
2. **The members column and the layout preferences.** The design brief puts nothing docked on the
   right: members become a popover, so the members column's toggle has no surface left. The toggle and
   its width preference are removed, and the ledger marks those items as superseded by the signed-off
   design, not silently. The bubbles/flat-rows preference stays, as a setting. Every other layout
   preference keeps its behaviour.
3. **The Now section.** It has no surface in the new design. Its call state moves into the call panel
   (the media controls grow into it, the brief says so): where you are, the ping, Disconnect. Its
   remaining states (a stream's viewers) go to the call panel or the stream window, decided by the
   Calls & media workstream.
4. **The incoming call.** Becomes a notice at the top centre with accept and decline, as the brief
   says, instead of today's card.
5. **Editing a message.** Moves into the composer (the reply and edit strips, ↑ edits your last
   message), as the brief says; today's in-place edit is superseded.
6. **A voice room's chat.** Keep whatever the app does today: if the room's chat opens beside the
   tiles, it opens as the split the brief draws; if the app has no room chat, the split is a proposal,
   listed and left out.

## The platform spike's follow-ups (2026-11-18)

Rulings, from `PLATFORM.md`:

1. **Vibrancy** ships **off** everywhere for now: the opaque tint (the prototype's Linux/web look) on
   every platform. The native bridge is proven and cheap, but it was never seen by a human, so it waits
   for one look before it ships. Listed as a follow-up.
2. **Typing on macOS 27** is broken in today's build (the window isn't key, the webview isn't first
   responder). The foundation fixes it; until then desktop QA drives through the QA socket, which
   never ships.
3. **Session renewal** happens in the main window only; secondary windows never renew, so two windows
   can't race the refresh token.
4. **Windows and Linux** behaviour is from source and the app's existing code; real machines verify it
   before the PR is called done. That check is a follow-up, not a blocker for opening the PR.

## Copy rulings (2026-11-18)

From the copy audit's open questions (`COPY.md` §8):

- "Leave call" stays (the app's word; leaving a group call doesn't end it for the others).
- The pop-out window's title is "Voice controls"; its pin says "Keep on top" / "Stop keeping on top";
  the sidebar's slim row says "Voice controls are in their own window" with "Put back".
- Shortcuts are written the app's way: "Ctrl K" on Windows and Linux, "⇧⌘M" order on macOS.
- The + button's tooltip is "Add files and more".
- "Close pane" stays.
- Settings and Space settings keep the app's sections, in sentence case.
- The known API error texts that say "channel" or "server" are mapped to the app's wording client-side
  (a test pins them); the wire behaviour doesn't change.
- The two allowed "server" strings ("No answer from the server in time", "Server did not return a
  valid token") stay: they mean the API.
- "Verify your email to secure your account" stays: account security, not a messaging claim.
- No ellipses on menu items that open a window, as the app writes.
- "Jump to the newest" (the app's own word).

## Build and process rulings (2026-11-18)

- One prototype behaviour never ships: the GIF footer "GIFs come through Duvet's proxy" is false for
  the app, which calls the GIF service directly.
- The design map's recommendation stands: keep the app's `font-display: swap`, its `--duvet-warn`
  colour, its code-theme URL, its sounds and their 0–200% range, and its three-stop role gradients over
  the prototype's versions.
- The prototype's sample world is banned by name (`forbidden-strings.txt`), so none of it can ship.
- The media controls' pop-out and the Settings windows are desktop-only; the web build never renders
  their entry points.
