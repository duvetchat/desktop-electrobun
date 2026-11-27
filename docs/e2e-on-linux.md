# End-to-end encryption on Linux, against a local stack

How to try the desktop app's encrypted DMs and groups on a Linux desktop before Linux is turned on: a local stack of the
API's suites, the app pointed at it, and what to check there (PLAN-E2E-PLATAFORMAS.md, «Lo que queda para el usuario»,
point 5, and «Pendiente de una persona»). Nothing here reaches production. `docs/e2e-on-windows.md` is the same walk on
Windows.

## What it takes

- **A Linux x64 desktop with glibc 2.38 or later** (Ubuntu 24.04, Debian 13, Fedora 39 or later): Electrobun's own
  native wrapper needs it. Ubuntu 22.04 can't run the app. Walk it on GNOME with its keyring, on KDE with KWallet, and
  in a session with neither (a bare window manager), where the key goes to a file.
- `duvet-api`, `duvet-gateway` and `desktop-electrobun` side by side, each on its `e2e` branch, with the desktop's
  dependencies installed (`bun install` in its root and in `src/mainview`).
- Go (an older one fetches the modules' 1.27 through `GOTOOLCHAIN=auto`), `goose` on the `PATH`
  (`go install github.com/pressly/goose/v3/cmd/goose@latest`), Bun, and podman with compose (or docker, with
  `E2E_CLI=docker`).
- For the other side: the web on the same computer, or the Windows app or the Pixel, pointed at it.

## 1. The stack

From `duvet-api`:

```bash
E2E_KEEP=1 E2E_WORKERS=1 bun run tests/e2e/run.ts client-ip
```

`run.ts` builds the API and the gateway (from `../duvet-gateway`) into `$TMPDIR/duvet-e2e-bin` (`/tmp` without it),
brings up worker 0's Postgres (127.0.0.1:25432) and Dragonfly (127.0.0.1:26380), migrates and seeds them, and runs
`client-ip`, a suite that leaves the seed as it found it. `E2E_KEEP` leaves the two containers up afterwards. The seed's
accounts are `alice@harness.test`, `bob@harness.test`, `carol@harness.test` and `dave@harness.test`, each with the
password `harness-password-1`.

Then, from `desktop-electrobun`:

```bash
bun scripts/local-stack.ts
```

It starts the fake S3 and mail server, the API on `localhost:9876` and the gateway on `127.0.0.1:8765`, on that stack,
with the harness's own environment and no `.env`. Its `E2E_MIN_CLIENTS` is the harness's
(`desktop-windows=1.2.0,web=1.2.0,android=1.1.0`) with `desktop-linux` at this checkout's version: production names no
Linux minimum until Linux is turned on, and without one the app's DMs say they aren't available in this app yet. It
says where the servers' logs are, and Ctrl+C stops them.

- **Starting again from nothing:** `run.ts` again. It takes the old stack down first, and the accounts lose what they
  had, their devices and keys included.
- **Taking it down,** from `duvet-api`:

  ```bash
  E2E_SUFFIX= E2E_PG_PORT=25432 E2E_DF_PORT=26380 podman compose -p duvet-e2e -f tests/e2e/compose.yml down -v
  ```

## 2. The app, pointed at it

The app's `local` target is that stack's API and gateway (`localhost:9876` and `localhost:8765`, in
`src/mainview/src/lib/common/common.ts`). Two ways to run the app with it:

- **A dev build of a checkout:** `src/mainview/.env.development.local` with `VITE_DOMAIN_TARGET_ENV=local`, then
  `bun run start` from `desktop-electrobun`. It runs as the dev channel, with data and keys of its own
  (`~/.local/share/com.duvet.desktop/dev`), beside any installed Duvet.
- **The test channel's installer:** `release.yml`, run by hand, builds the canary of the branch it's given on the
  system it's given, into a prerelease of this repository. `--ref` runs the workflow as that branch has it: until the
  cutover, the default branch's has no test channel.

  ```bash
  gh workflow run release.yml --repo duvetchat/desktop-electrobun --ref e2e -f system=linux -f target=local
  gh release download test-<run number> --repo duvetchat/desktop-electrobun --pattern "*.tar.gz"
  tar -xzf canary-linux-x64-Duvet-canary-Setup.tar.gz && ./installer
  ```

  The installer unpacks the app into `~/.local/share/com.duvet.desktop/canary/app` (`$XDG_DATA_HOME` in place of
  `~/.local/share` when it's set), keeps the build's tar beside it in `self-extraction/` for the updater, and puts
  `Duvet.desktop` in `~/Desktop` when that folder exists, with no entry in the applications menu. Run it again and it
  replaces `app/` and keeps the rest of the folder, the app's data among it: copy that folder first if this computer's
  canary is in daily use, as its session belongs to production. The shortcut is named as a stable install's, so it
  takes that one's place in `~/Desktop`. The installed app's `Resources/version.json` has the hash the release's
  `canary-linux-x64-update.json` names.

For a second side on the same computer, the web: `bun run dev` in `src/mainview`, with the same
`.env.development.local`, serves the app at `http://localhost:5173`, which the stack's API takes. Each browser, or a
private window, is a device of its own.

## 3. What to check

Sign in as alice on the Linux app, and as bob on the web (or the Pixel). Each sets up encryption from the bar at the
bottom (Set up, the recovery key saved, Continue). Friends first: a DM takes a friendship.

1. **The core loads, and its key is in the system's keyring.** Once alice's device is set up, a DM with bob opens and
   its messages go both ways.
   - **With a keyring** (GNOME Keyring, or KWallet's Secret Service): `secret-tool search --all service
     com.duvet.desktop.canary` (`com.duvet.desktop.dev` for a dev build) lists an item whose `username` is alice's user
     ID (`01920000-0000-7000-8000-00000000a11c`), and beside her database,
     `~/.local/share/com.duvet.desktop/<channel>/e2e/<her user ID>/core.db`, there's no `core.db.key`.
   - **With none:** Settings → Devices says «This computer has no system keyring, so the key to your encrypted
     conversations is kept in a file that only your user can read.», and `core.db.key` is beside the database, with
     `-rw-------` in `ls -l`.
   - **A locked keyring:** lock it (GNOME: Passwords and Keys, the login keyring's Lock) and start the app. The system's
     unlock dialog shows as the database opens. Cancel it: the bar says «Duvet couldn't open your encrypted
     conversations. If your system's keyring is locked, unlock it and try again.» with Try again, and no `core.db.key`
     appears. Try again shows the dialog again, and unlocking opens the conversations.
2. **A second instance says it's locked.** Open the same app again while it runs: the second one's bar says
   «Encrypted conversations are open in another Duvet window.», and the first one goes on.
3. **The boxes outside the page:** Electrobun's own (GTK's) dialogs, each with Cancel first and as its default: Enter
   and Esc cancel, closing the box cancels, and Cancel changes nothing.
   - **Approving:** a new device of alice's (the web signed in as alice, Set up, then «Use a code instead») has the
     Linux app ask «Is this device yours?»; after It's mine and the new device's yes to the code, Confirm opens
     «Approve a new device?», which names the fingerprint the new device shows.
   - **Verifying a contact:** bob's Verify security number, then Mark as verified, opens «Mark this contact as
     verified?» with the 60 digits.
   - **Removing a device:** Settings → Devices, a device's Remove, then the page's own question, opens «Remove a device
     from your account?», naming it.
   - **Changing keys:** Settings → Devices → Change security keys opens «Change your security keys?».
   - **Starting over:** a new device's setup, Start over, opens «Make new security keys?».
   - **Another account:** sign out of alice and in as bob on the same app. Before bob's encrypted conversations open,
     «Open another account's encrypted conversations?». Cancel leaves the bar saying they couldn't open, until the app
     starts again; Open opens them, and signing in as bob again asks nothing.
   - **Being approved:** with the Linux app as alice's new device (her web set up first), its Set up opens a window of
     its own, «Set up this device», with a fingerprint for a code and one for a phone's scan, over the main window. It
     asks nothing, the page can't reach it, and clicking the main window doesn't cover it. Left open on its QR, the sheet
     renews the QR every 9 minutes: the window's text changes in place, without coming to the front or taking the
     keyboard. Closing it doesn't quit Duvet, and closing Duvet closes it.
4. **The window keeps up while a large history is shared.** In a DM with a few hundred messages, Share history with a
   member's new device, and pick «the conversation's history». While it goes, move the window and type in another
   chat: none of it should stall.
5. **The recovery key's Copy:** on Linux the page copies the key, and takes it off the clipboard a minute later where
   the engine lets the page read the clipboard. A clipboard manager (GNOME's or KDE's) may keep it in its history: the
   plan's stated limit.
6. **A player's frame:** until the frames' bridges are closed (PLAN-E2E-PLATAFORMAS.md, Task 5, after the cutover), a
   frame on Linux still has Electrobun's bridges. What holds today: in a dev build, play a YouTube embed, and in
   DevTools (F12), in each of the player's frames, `[typeof __electrobunSecretKeyBytes, typeof
   __electrobunRpcSocketPort]` says `['undefined', 'undefined']`, where the top one says `['object', 'number']`.
7. **Updates,** on the stable channel alone (a canary never updates itself), once two Linux versions are published:
   - with the first installed and the second out, the title bar offers «Restart to update» once the second is
     downloaded and checked (it looks 30 s after the start, then every 6 hours); it closes Duvet and opens it again on
     the second, in its place, with its data;
   - installed with `XDG_DATA_HOME` set to a folder whose path a shell would misread (one with `$`, `` ` ``, `"` or `\`),
     it offers «Download update» instead, which opens duvet.chat/download.
8. **The rest, with the web and with the Pixel:**
   - conversing: a message, a reply, an edit, a deletion, in a DM and in a group;
   - attachments: a picture, a file, a voice note;
   - recovery: a new device set up with the recovery key;
   - approval: by code, and the Pixel scanning the computer's QR;
   - history: a share, and the offer of it added on the other side;
   - the backup: Settings → Devices says it's up to date, and a new device restores it.

Leave the stack up only while you check: other runs of the API's suites wait for its ports.
