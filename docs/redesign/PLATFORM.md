# What Electrobun 1.15.1 can do for the redesign

Written by the lead from the platform spike's code and its logged runs, after the spike's own
writer ran out of credits; every claim below is backed by the spike branch (`redesign/spike-platform`)
and its transcripts (`redesign-work/logs/p0-spike.jsonl`, `logs/p0-spike-run.out`), not by reading alone,
except where a row says "read from source". Each `Verdict` is one of: **works**, **works with limits**,
**doesn't work**, or **not run**.

The spike made six runs of the app (A–F) in the sandbox home, driving it through a QA socket
(`src/bun/spike/qa.ts`) that can list windows, evaluate JavaScript in each window's webview, click,
type, snapshot pages to PNG and call native probes through `bun:ffi` (`src/bun/spike/native-probe.ts`,
`src/bun/spike/objc.ts`). Commits: `b54c899`, `b8df970`, `b517947`, `799e7cf`, `4ecf0d9`.

## 1. macOS traffic lights with `hiddenInset`

- **Verdict:** works.
- **Evidence:** main window created with `titleBarStyle: "hiddenInset"`. Native probe of the window's
  standard buttons: close `{x:9, y:6, 14×16}`, minimise `{x:29, y:6, 14×16}`, zoom `{x:49, y:6, 14×16}`;
  the title-bar container is 28 pt tall; the webview's `contentLayoutRect` starts below it. In full
  screen the traffic lights move to the top-right zone of the screen and `titlebarHeight` reports 0
  while a title-bar container of 28 pt sits at the bottom of the frame: the page must not hard-code
  a top inset. The tab strip must reserve ~75 px on the left for the lights (the spike measured
  `titlebarPadding: "75px"`).
- **Traps:** full screen changes where the lights are; don't trust `titlebarHeight` alone there.
- **Recommendation:** ship `hiddenInset` on macOS. Keep the measured 75 px left inset; make it a
  design token, since it may drift between macOS versions.

## 2. Drag regions

- **Verdict:** works (native class), with limits on double-click.
- **Evidence:** single clicks on the title bar both hit the page (`mousedown`/`click` logged) and drag
  the window; a `-no-drag` button inside the strip receives clicks without moving the window; a
  double-click on the strip zoomed the window (frame before `{0,33,1400,887}` → after, maximised).
  This is Electrobun's preload drag-region handler (`electrobun-webkit-app-region-drag`,
  `-no-drag`), which the app already uses in `Header.svelte`.
- **Recommendation:** keep the two classes; every interactive control in the strip needs `-no-drag`.

## 3. A second window (the media controls' pop-out; Settings and Space settings)

- **Verdict:** works, both in the dev build and in a packaged build.
- **Evidence:** the spike's pop-out window (`views://mainview/spike-popout.html`) opened and worked in
  the dev bundle and in a packaged canary build (`Duvet-canary.app`), where the page was found at
  `Resources/app/views/mainview/spike-popout.html` and its DOM, buttons and snapshots all worked. A
  negative check is the trap, proved: **without a `copy` rule for the page, the dev build serves it
  but the packaged build 404s** (`eval timed out`, `spike-popout.html` not in the bundle).
  A page with a `copy` rule in `electrobun.config.ts` works in both. The pop-out was created with its
  own `titleBarStyle` (the spike used `hiddenInset`), its own frame, and `renderer: "native"` on
  macOS / `"cef"` on Linux. Creating it took 19.6 ms. Closing the main window leaves the pop-out
  open; closing the pop-out does not close the main window; when the last window closed, the app
  exited (`exitOnLastWindowClosed` applies to every window). An off-screen remembered frame was
  clamped back on screen (`{4200,-900,2000,300}` → `{0,33,1512,300}`): the clamping logic in
  `lib/window-frame.ts` (`Maximizer`) applies as-is to a second window, since frames and `Screen`
  data share units on macOS.
- **Recommendation:** one `copy` rule per second-window page is mandatory. The pop-out should be a
  `BrowserWindow` with its own typed RPC (next section), created lazily on first "Pop out".

## 4. RPC between windows through the main process

- **Verdict:** works, fast and in order.
- **Evidence:** relay measured through the main process: sequential round trips median 0 ms,
  p95 1 ms, max 1 ms (≈0.4 ms per round trip); 50 at once answered in 3 ms with 0 out of order, 0
  missing; a burst of 1000 in 38 ms, 0 out of order, 0 missing; a burst of 5000 also in order.
  `storage` events cross windows: a theme change in the main window reached the pop-out live
  (`storage event in popout: key=duvet.theme.v1 new=dark`).
- **Recommendation:** state mirroring (where you're connected, ping, mute, deafen, noise
  suppression, camera, share, the chosen microphone) as a numbered stream from the main window
  through the main process, exactly as the spike's `probe.ts` does (`orderOf`/`timings` helpers have
  tests). Session and theme do not need mirroring: `localStorage` and the `storage` event work
  across windows on the same data store.

## 5. No second gateway connection; session and theme in the second window

- **Verdict:** works, with discipline.
- **Evidence:** the pop-out page was written so its module graph never reaches
  `api/ws/connection.ts` (`lib/spike/module-graph.ts` + `module-graph.test.ts` guards it: a test
  fails if the page's graph reaches the connection). `localStorage` and `BroadcastChannel` are both
  available in each window. A page can read the stored session token on start, and the
  `storage` event delivers theme changes before paint is needed. (The session-refresh race —
  two pages refreshing the token at once — was not resolved by the spike: the recommendation is
  that only the main window renews the session, and secondary windows call REST through the main
  process, or read a token refreshed by the main window. Resolve it in the foundation before the
  Windows workstream ships.)
- **Recommendation:** secondary windows import nothing from the main window's page graph; ship the
  module-graph test. Only the main window opens the socket, renews the session, and listens to the
  gateway.

## 6. `alwaysOnTop` / `setAlwaysOnTop`

- **Verdict:** works.
- **Evidence:** `setAlwaysOnTop` at run time: `isAlwaysOnTop` true, `NSWindow.level` 3, the window
  stays key; unsetting returns it to level 0. A full-screen check: with the main window full screen,
  the pop-out reported `isOnActiveSpace true`, level 3 — it can float over a full-screen app.
- **Recommendation:** pin is a plain toggle of `setAlwaysOnTop`, remembered in the pop-out's
  persisted frame/preferences.

## 7. Remembering size and position; multi-display

- **Verdict:** works.
- **Evidence:** the pop-out's frame survived close/reopen (`{700,300,360,460}` kept, `frame kept`);
  it persisted through the app in the sandbox home (frame written and re-read on reopen). An
  off-screen frame was clamped to the primary display's work area (see §3). `Screen` exposes
  `bounds`, `workArea`, `isPrimary` per display in shared units with window frames on macOS.
- **Recommendation:** persist `{x, y, width, height}` plus the pin state per device (localStorage or
  the main process), clamp on open with `Maximizer`'s logic, and re-clamp when displays change
  (`windowDidMove`/`resize` events fire; the spike logged `windowDidResize`/`windowDidMove`).

## 8. Focus and shortcuts across windows

- **Verdict:** works with limits (see the typing defect below).
- **Evidence:** `focus()` brought the main window forward and un-minimised it
  (`after Show Duvet: main minimized False key True`). In the pop-out, `⌘M` and `⌘D` produced
  `keydown` events that relayed mute/deafen to the main window in 1–3 ms, and `⌘,` reached the Bun
  process. A page-level key handler gets the shortcuts whichever window is key. A menu-based
  ⌘⇧M was also wired in the spike's Edit menu. In-app events through the application menu
  (`selectAll` ⌘A) did not fire from the webview; a page-level key handler or Electrobun's menu
  roles are the reliable routes.
- **Recommendation:** mute/deafen shortcuts as page-level `keydown` handlers in the pop-out page,
  relaying through the main process; don't rely on the native menu to dispatch them.

## 9. Vibrancy on macOS

- **Verdict:** works in a test project, seen by a human on 2026-11-19; in Duvet as Liquid Glass (#374,
  `DECISIONS.md`), not yet run on a Mac there.
- **Evidence (the spike, 2026-11-18):** an `NSVisualEffectView` was placed behind the webview through `bun:ffi`
  and public AppKit only (`src/bun/spike/vibrancy.ts`), because Electrobun already draws its webviews with
  `drawsBackground = NO` and a clear layer. It survives resize and full screen (subviews
  `[NSVisualEffectView, NSKVONotifying_WKWebView]`, the effect's frame tracks the content view).
  Scroll cost with the effect on vs off: median 17 ms/frame, p95 18 ms, 60 fps both ways — no
  measurable slowdown. The first attempt segfaulted Bun; after the fix (messaging only the webview,
  on the main thread) the runs were stable. The look could not be checked: this Mac has no Screen
  Recording permission.
- **Evidence (Liquid Glass, 2026-11-19):** a test project on Electrobun 1.15.1 and 2.0.6 (macOS 27.2.1, SDK
  27.2) put an `NSGlassEffectView` under the web view of a `transparent` window, from a small Objective-C
  library loaded with `bun:ffi`, and a human looked at it. What Electrobun does, read in its `nativeWrapper.mm`:
  `transparent: true` clears the window's background, makes it non-opaque and turns its shadow off (the library
  turns it back on); every webview is added above everything the content view holds, so a view put at the
  bottom stays behind them all; embedded `<electrobun-webview>`s keep an opaque background.
- **What ships (#374):** `native/macos/liquid_glass.mm`, built for the build's target by
  `scripts/build-liquid-glass.ts` (`scripts.preBuild`; an empty placeholder on Windows and Linux) and copied to
  `Resources/app/native/`; `src/bun/liquid-glass.ts` loads it. The main window on macOS is `transparent` when the
  library loads, the glass goes under its web view (`NSVisualEffectView` on macOS 14 and 15), and the page is told
  in its preload (`glass`; `lib/platform.ts`: `vibrancy`). The page leaves the glass uncovered under the sidebar
  only (`lib/vibrancy.ts`), and tells Bun its theme for the glass's appearance.
- **Not checked yet:** scroll cost with Liquid Glass (the spike measured vibrancy only); a notarized build (the
  build script signs the library itself, as Electrobun 1.15.1's signer only walks `Contents/MacOS`); the glass
  inside Duvet itself, with the typing fix (`window-keys.ts`) and full screen.

## 10. Windows and Linux (read from source, not run)

- Windows: WebView2; `hiddenInset` maps to a borderless window with a custom title-bar area
  (`createWindowWithFrameAndStyleFromWorker`: `hidden` → `WS_POPUP`, `hiddenInset` → bordered with
  custom title bar); drag regions are the same CSS classes handled by the preload. The app's own
  `window-frame.ts` (Win32 `GetWindowRect`/`SetWindowPos`), `window-snap.ts` (Windows' move loop,
  `WM_LBUTTONDOWN`/`WindowProc`) and `window-controls.ts` already draw and drive the Windows chrome.
- Linux: CEF (the app bundles it, `electrobun.config.ts` `bundleCEF`); frames are GDK, and
  `Maximizer` is only correct at GDK scale 1; the app's maximize is a `setFrame` to the work area,
  not the window manager's. The spike's pop-out creation uses `renderer: "cef"` on Linux.
- **Recommendation:** everything above must be re-verified on real Windows and Linux machines
  before the PR is called done; the parity/visual QA for those platforms is currently code-and-tests
  only. A follow-up should run the spike's QA socket on both.

## 11. The web fallback and the platform switch

- **Verdict:** works; the spike left its executable shape (`lib/spike/platform.ts`,
  `platform.test.ts`, 82 lines of tests).
- **Design:** one pure `shellFor(inputs)` answers everything the shell needs (chrome, native
  traffic lights, own window controls, draggable title bar, settings-in-windows, pop-out,
  vibrancy). Inputs: Electrobun's `window.__electrobunWindowId` (set by its preload at document
  start), the window's shell handed by Bun in its own `preload` (`window.__duvetShell`: OS,
  title-bar style, which window this is — measured to run before the page's scripts,
  `readyState: "loading", scripts: 0`), the user agent as fallback, and, in development builds
  only, a preview override (`?shell=mac|windows|linux|web` or `localStorage duvet.dev.shell`)
  compiled out of production by `import.meta.env.DEV`. `vibrancy` returns false until a human
  approves it.

## 12. The typing defect on this Mac (macOS 27.2.1)

- **Verdict:** the spike found the mechanism; it did not finish the cure before the credits ran out.
- **Evidence:** with the shipped `hidden` title-bar style the main window was
  `canBecomeKey: False` and stayed `key: False` even after clicks; the page logged 0 keydowns.
  When the window **was** key (or made key through AppKit), the webview still had to be first
  responder: `firstResponder: NSKVONotifying_NSWindow` (the window, not the WKWebView) with
  `page hasFocus false, keydowns 0`; after making the webview first responder, typed text reached
  the input (`page value: "abc"`, `active: INPUT#email`). So typing fails because the window is not
  key and the webview is not first responder — a real bug in today's build, and on this macOS the
  webview must be first responder for keyboard input.
- **Recommendation:** the spike's last commit hands the shell to each window at document start
  (`shellPreload`), which the foundation builds on; making the window key and the webview first
  responder on focus (Electrobun has the hooks; the spike's `makeKey`/`focusWebview` QA commands
  did it) is the likely fix and needs a focused investigation in the foundation phase. Until it is
  fixed, desktop-app QA drives through the QA socket (next section).

## 13. Checking the desktop app here without screenshots or typing

- **Verdict:** works — this is how the spike itself ran.
- **Evidence:** a QA socket (`src/bun/spike/qa.ts`, later moved to the standalone `src/bun/qa/`
  module with `qa/native.ts`, `qa/objc.ts`, `qa/snapshot.c`) gives: `windows` (every window with
  its frame), `eval` (JavaScript in a chosen window's webview, answer back), `click` (scripted
  clicks at coordinates, with mirror-mode reset), `type` (injected input events), `fill` (sets
  input values), `snapshot` (a DOM-rendered PNG of a page), plus native probes (traffic-light
  frames, key status, first responder, vibrancy, `alwaysOnTop` level, focus). The whole thing
  gated on `DUVET_QA_SOCKET`; without it no socket opens. Signing a seeded account in without
  typing: `fill` the fields and click (the spike's demo signed in against the local stack).
- **Recommendation:** carry the `src/bun/qa/` module as a QA-only patch kept outside the
  integration branch (the spike's plan: `redesign-work/qa/electrobun-qa.patch`), never shipped.

## 14. Verdict table

| Capability | macOS | Windows | Linux | Web |
|---|---|---|---|---|
| Native traffic lights, tabs in the title bar | works | drawn by the page (source) | drawn by the page (source) | no chrome |
| Drag regions (drag/no-drag classes) | works | works (source) | works (source) | n/a |
| Second window (pop-out, Settings, Space settings) | works | not run | not run | sheets / nothing |
| RPC + state mirroring through the main process | works (≤1 ms, in order) | not run | not run | n/a |
| `storage`/`localStorage` shared across windows | works | not run | not run | n/a |
| `alwaysOnTop` | works | not run | not run | n/a |
| Remembered frame, clamped | works | source says yes | scale-1 only (source) | n/a |
| Focus main window from pop-out | works | not run | not run | n/a |
| Page-level shortcuts in the pop-out | works | not run | not run | browser-reserved only |
| Vibrancy | Liquid Glass behind the main window's sidebar (vibrancy before macOS 26) | n/a | n/a | opaque tint |
| Typing on macOS 27 | broken today; fix = key window + first responder | n/a | n/a | n/a |
| QA without screenshots/typing (QA socket) | works | untested | untested | Playwright instead |

## Follow-ups

1. Vibrancy: ~~show it to a human (the bridge is written) and decide; ship opaque tint until then.~~ Seen on
   2026-11-19; ships as Liquid Glass on macOS (§9, #374).
2. Windows and Linux: run the spike on real machines; verify §3–§8 there.
3. Typing fix: make the window key and the webview first responder on focus; land it with the
   foundation so desktop QA can type for real.
4. Session refresh across windows: one renewer (the main window) before the Windows workstream.
5. Carry `src/bun/qa/` as the QA-only patch outside the integration branch.
