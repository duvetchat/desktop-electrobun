# Today's app, measured before the redesign

The "before" numbers the redesign's finish line compares against ("startup and long-chat scrolling are no
slower"). Taken on `dev` at `c6e514a` (the parity ledger's baseline commit), on 2026-11-18, by
`redesign-work/tools/perf-startup.ts` and `perf-scroll.ts` (outside the repo; described in `TESTING.md`).
The scripts take a worktree and a label, so the same ones measure the redesign.

## The machine, and how loaded it was

Apple M5 × 10, 16 GB, macOS 27.2 (arm64). The machine was not idle: WindowServer and the Hermes desktop
app were the top processes, load average ~5–6. Treat every number as measured under load; the "after"
measurement must be taken under comparable load (the scripts record the same machine snapshot, so a run
carries its own conditions).

## Startup (Chromium, the UI's static build served locally, signed in as the seeded main account)

30 runs per kind (2 passes of 15): ms since the page's `timeOrigin`. `socket` is the gateway connection;
`messagesOnScreen` is the first chat's messages on screen; `chatOpen` is the first chat opened (includes
waiting for the session, the socket and one page of messages).

| Mark | cold median | cold p95 | warm median | warm p95 |
|---|---|---|---|---|
| first paint | 24 | 48 | 20 | 40 |
| DOMContentLoaded | 22.6 | 37.8 | 19.1 | 37.2 |
| app | 40 | 83 | 35.5 | 56 |
| session | 42 | 89 | 37 | 58 |
| socket | 43.5 | 96 | 6.5 | 17 |
| ready | 47 | 109 | 42 | 66 |
| spaces | 51 | 114 | 131 | 193 |
| shown | 52 | 118 | 43 | 71 |
| convRow | 97.4 | 185.4 | 87.2 | 142.9 |
| messagesOnScreen | 244.4 | 466.8 | 226 | 489.7 |
| chatOpen | 147.2 | 311.9 | 139.8 | 254 |
| LCP | 192 | 340 | 216 | 368 |

Raw data: `redesign-work/perf/baseline/startup-2026-11-18T08-00-28-926Z.json`.

## Scrolling a long chat (3,000-message DM, fixed speed, 5 runs)

One run (the first) never reached the start and was dropped from the medians. The other four are stable:
scroll up the whole history at a fixed speed (median 55.7–59.8 s to reach the start), then back down
(59.0–59.2 s), 30 older pages loaded, 0 position jumps (the list held its place every run; max jump 0 px).

| Measure | Median | p90 |
|---|---|---|
| frame interval, scrolling | 50 ms | 66.6 ms |
| frame interval p95 | 83.4 ms | 133.4 ms |
| frames over 33 ms | 1,325 | 4,655 |
| frames over 50 ms | 901 | 3,901 |
| frames over 100 ms | 27 | 1,751 |
| long tasks | 13 | 15 |
| long-task time, total | 756 ms | 939 ms |
| older pages loaded | 30 | 30 |
| page request → DOM | 38.5 ms | 106 ms |
| page fully settled | 224 ms | 370 ms |
| DOM nodes, at the top of the history | 35,958 | 35,959 |
| JS heap, at the top of the history | 156.5 MB | 155.9 MB |
| position jumps | 0 | 0 |

Raw data: `redesign-work/perf/baseline/scroll-2026-11-18T08-16-52-020Z.json`.

Reading the numbers: scrolling is already heavy — the median frame is 50 ms (~20 fps) under load, with
the DOM at ~36k nodes and the heap at ~156 MB at the top of the history. That is today's app, not a
regression target; the redesign must not be worse at the same load.

## Defects seen while driving today's app (Chromium, local stack)

Recorded so the reviewers don't report them as regressions of the redesign:

- On macOS 27.2.1 the desktop build is badly broken: typing into the app doesn't work. The platform
  spike (PLATFORM.md §12) found the mechanism: the window isn't key and the webview isn't first
  responder. Fixing it is part of the foundation.
- The parity reader's list of possible bugs (PARITY.md, and the reader's report) is a separate list;
  anything in it behaves as recorded until a phase changes it on purpose.

## The desktop app's own startup log

Could not be produced: on this macOS the dev build could not be driven far enough for `startup.log` to
be written under the sandbox home. The desktop-app startup measurement stays open; the foundation
re-measures once typing works (the QA socket can sign in without typing).
