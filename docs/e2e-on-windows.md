# End-to-end encryption on Windows, against a local stack

How to try the desktop app's encrypted DMs and groups on Windows before the cutover: a local stack of the API's suites,
the app pointed at it, and what to check there (PLAN-E2E-CLIENTES.md, «Lo que queda para el usuario», point 1).
Nothing here reaches production.

## What it takes

- `duvet-api`, `duvet-gateway` and `desktop-electrobun` side by side, each on its `e2e` branch, with the desktop's
  dependencies installed (`bun install` in its root and in `src/mainview`).
- Go (an older one fetches the modules' 1.27 through `GOTOOLCHAIN=auto`), `goose` on the `PATH`
  (`go install github.com/pressly/goose/v3/cmd/goose@latest`), Bun, and podman with compose (or docker, with
  `$env:E2E_CLI = "docker"`).
- For the parts with the phone, the Pixel's test APK from mobile's own release workflow, pointed at this computer.

## 1. The stack

From `duvet-api`, in PowerShell:

```powershell
$env:E2E_KEEP = "1"; $env:E2E_WORKERS = "1"
bun run tests/e2e/run.ts client-ip
```

`run.ts` builds the API and the gateway (from `../duvet-gateway`) into `%TEMP%\duvet-e2e-bin`, brings up worker 0's
Postgres (127.0.0.1:25432) and Dragonfly (127.0.0.1:26380), migrates and seeds them, and runs `client-ip`, a suite that
leaves the seed as it found it. `E2E_KEEP` leaves the two containers up afterwards. The seed's accounts are
`alice@harness.test`, `bob@harness.test`, `carol@harness.test` and `dave@harness.test`, each with the password
`harness-password-1`.

Then, from `desktop-electrobun`:

```powershell
bun scripts/local-stack.ts
```

It starts the fake S3 and mail server, the API on `localhost:9876` and the gateway on `127.0.0.1:8765`, on that stack,
with the harness's own environment: its `E2E_MIN_CLIENTS` (`desktop-windows=1.2.0,web=1.2.0,android=1.1.0`) and no
`.env`. It says where their logs are, and Ctrl+C stops them. The first time `duvet-api.exe` listens, Windows' firewall
asks about it once: either answer works, as everything here is on this computer.

- **Starting again from nothing:** `run.ts` again. It takes the old stack down first, and the accounts lose what
  they had, their devices and keys included.
- **Taking it down,** from `duvet-api`:

  ```powershell
  $env:E2E_SUFFIX = ""; $env:E2E_PG_PORT = "25432"; $env:E2E_DF_PORT = "26380"
  podman compose -p duvet-e2e -f tests/e2e/compose.yml down -v
  ```

## 2. The app, pointed at it

The app's `local` target is that stack's API and gateway (`localhost:9876` and `localhost:8765`, in
`src/mainview/src/lib/common/common.ts`). Two ways to run the app with it:

- **A dev build of a checkout:** `src/mainview/.env.development.local` with `VITE_DOMAIN_TARGET_ENV=local`, then
  `bun run start` from `desktop-electrobun`. It runs as the dev channel, with data and keys of its own, beside any
  installed Duvet.
- **The test channel's installer:** `release.yml`, run by hand, builds the canary of the branch it's given into a
  prerelease of this repository (once the default branch holds it, at the cutover):

  ```powershell
  gh workflow run release.yml --repo duvetchat/desktop-electrobun -f ref=e2e -f target=local
  gh release download test-<run number> --repo duvetchat/desktop-electrobun --pattern "*.zip"
  ```

  Extract the zip and run `Duvet-Setup-canary.exe`. It installs over the canary this computer has, in its folder and
  with its data (`%LOCALAPPDATA%\com.duvet.desktop\canary`): copy that folder first if that canary is in daily use, as
  its session belongs to production, and install the usual canary again afterwards. The installed app's
  `Resources\version.json` has the hash the release's `canary-win-x64-update.json` names.

For a second side on the same computer, the web: `bun run dev` in `src/mainview`, with the same
`.env.development.local`, serves the app at `http://localhost:5173`, which the stack's API takes. Each browser, or a
private window, is a device of its own.

The whole app also runs in headless browsers against such a stack:
`bun scripts/local-stack.ts bun scripts/web-e2e.ts app` (with `CHROME` or `FIREFOX` naming a browser's binary). It
needs a fresh stack's accounts.

## 3. What to check

Sign in as alice on the Windows app, and as bob on the web (or the Pixel). Each sets up encryption from the bar at the
bottom (Set up, the recovery key saved, Continue). Friends first: a DM takes a friendship.

1. **The core loads, and its key is in the Credential Manager.** Once alice's device is set up, a DM with bob opens and
   its messages go both ways. `cmdkey /list` shows a generic credential that names the channel's service
   (`com.duvet.desktop.dev`, or `com.duvet.desktop.canary`) and alice's user ID (`01920000-0000-7000-8000-00000000a11c`).
   Beside her database, `%LOCALAPPDATA%\com.duvet.desktop\<channel>\e2e\<her user ID>\core.db`, there's no
   `core.db.key`: that file would mean the key went to disk, as it does only where the system has no keyring.
2. **A second instance says it's locked.** Open the same app again while it runs: the second one's bar says
   «Encrypted conversations are open in another Duvet window.», and the first one goes on.
3. **The native dialogs show over the window,** each with Cancel as its default button, and Cancel changes nothing:
   - **approving:** a new device of alice's (the web signed in as alice, Set up, then «Use a code instead» or the
     QR) has the Windows app ask «Is this device yours?»; after It's mine, and the new device's yes to the code, Confirm
     opens Windows' dialog, which names the fingerprint the new device shows;
   - **changing keys:** Settings → Devices → Change security keys;
   - **starting over:** a new device's setup, Start over;
   - **being approved:** with the Windows app as alice's new device (her web set up first), its Set up opens Windows'
     own box, «Set up this device», with a fingerprint for a code and one for a phone's scan. The web's «Is this device
     yours?» shows the first. The box asks nothing: the window takes the code while it's open, and it goes once the
     device is set up or the setup's sheet closes. Left open on its QR, the sheet renews the QR every 9 minutes: the
     new box takes the old one's place without coming to the front (desktop-electrobun#557);
   - **another account:** sign out of alice and in as bob on the same app. Before bob's encrypted conversations open,
     Windows' box asks to open another account's. Cancel leaves the bar saying they couldn't open, until the app starts
     again; OK opens them, and signing in as bob again asks nothing (desktop-electrobun#558).
4. **The window keeps up while a large history is shared.** In a DM with a few hundred messages, Share history with a
   member's new device, and pick «the conversation's history». While it goes, drag the window by its title bar, snap it
   with Win+Left and Win+Right, and type in another chat: none of it should stall.
5. **A player's frame holds nothing of the window's RPC.** In a dev build, play a YouTube and a TikTok embed in a
   room. In DevTools' console (F12), pick each of the player's frames in the context menu at the top (top ▾), and run
   `[typeof __electrobunSecretKeyBytes, typeof __electrobunRpcSocketPort]`: every frame says
   `['undefined', 'undefined']`, where the top one says `['object', 'number']` (desktop-electrobun#556). Then, in each
   frame, `[typeof __electrobunBunBridge, typeof __electrobunInternalBridge, typeof __electrobunEventBridge]` says
   `undefined` three times: the bun bridge carries the RPC with no key at all.
6. **The rest, with the web and with the Pixel:**
   - conversing: a message, a reply, an edit, a deletion, in a DM and in a group;
   - attachments: a picture, a file, a voice note;
   - recovery: a new device set up with the recovery key;
   - approval: by code, and the Pixel scanning the PC's QR;
   - history: a share, and the offer of it added on the other side;
   - the backup: Settings → Devices says it's up to date, and a new device restores it.

Leave the stack up only while you check: other runs of the API's suites wait for its ports.
