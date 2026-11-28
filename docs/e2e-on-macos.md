# End-to-end encryption on macOS, against a local stack

How to try the desktop app's encrypted DMs and groups on a Mac before macOS is turned on: a local stack of the API's
suites, the app pointed at it, and what to check there (PLAN-E2E-PLATAFORMAS.md, «Lo que queda para el usuario», point
3, and «Pendiente de una persona»). Nothing here reaches production. `docs/e2e-on-linux.md` and
`docs/e2e-on-windows.md` are the same walk on those systems.

## What it takes

- **A Mac with Apple silicon on macOS 14 or later:** the app's own libraries and the core's are built for macOS 14.0. An
  Intel Mac's build carries no core, and its DMs say they aren't available in this app.
- **The stack,** brought up as `docs/e2e-on-linux.md` says (section 1), on this Mac if it has Go, `goose`, Bun and
  podman, or on another computer whose ports this Mac reaches (below).
- **For a dev build:** `desktop-electrobun` on its `e2e` branch, its dependencies installed (`bun install` in its root
  and in `src/mainview`), and Xcode's command line tools, which build the app's own libraries
  (`scripts/build-native.ts`).
- **For the other side:** the web, or the Windows app or the Pixel, pointed at the same stack.

## 1. The stack, reached from the Mac

`bun scripts/local-stack.ts` starts the API on `localhost:9876` and the gateway on `127.0.0.1:8765`, where the app's
`local` target looks for them, with `desktop-macos` at this checkout's version among its minimums: production names no
macOS minimum until macOS is turned on, and without one the app's DMs say they aren't available in this app yet.

With the stack on another computer, forward its ports to the Mac's own loopback, from that computer, for as long as you
check: the API, the gateway, and the fake S3 the files' signed URLs name (worker 0's, `127.0.0.1:29000`). Nothing
listens beyond loopback on either side.

```bash
ssh -N -R 9876:127.0.0.1:9876 -R 8765:127.0.0.1:8765 -R 29000:127.0.0.1:29000 <you>@<the Mac>
```

## 2. The app, pointed at it

- **A dev build of a checkout:** `src/mainview/.env.development.local` with `VITE_DOMAIN_TARGET_ENV=local`, then
  `bun run start` from `desktop-electrobun`. It runs as the dev channel, with data of its own
  (`~/Library/Application Support/com.duvet.desktop/dev`) and Keychain items of its own (`com.duvet.desktop.dev`),
  beside any installed Duvet.
- **The test channel's canary:** `release.yml`, run by hand, builds the canary of the branch it's given into a
  prerelease of this repository. `--ref` runs the workflow as that branch has it: until the cutover, the default
  branch's has no test channel.

  ```bash
  gh workflow run release.yml --repo duvetchat/desktop-electrobun --ref e2e -f system=macos -f target=local
  gh release download test-<run number> --repo duvetchat/desktop-electrobun --pattern "*.dmg"
  ```

  Open the `.dmg` and drag Duvet-canary into Applications, then open it from there. Opened from the `.dmg` or from
  Downloads, macOS runs it from a read-only copy (App Translocation). Its data goes to
  `~/Library/Application Support/com.duvet.desktop/canary`, and its Keychain items are `com.duvet.desktop.canary`'s.

### Gatekeeper, for a build without a Developer ID

A dev build and the canary are signed by nobody Apple knows (their Bun ad hoc, #618), and not notarized.

- **A `.dmg` a browser downloaded** is quarantined: the first open says macOS can't verify Duvet-canary. Choose Done,
  then System Settings → Privacy & Security, where «"Duvet-canary" was blocked to protect your Mac» has Open Anyway.
  Confirm with your password: from then on it opens.
- **One `gh` downloaded** carries no quarantine, and opens without asking.
- **A signed build** (once Apple's account is in the release workflow) opens without either, and
  `spctl --assess --type execute -vv /Applications/Duvet.app` says it's accepted, its source Notarized Developer ID.

## 3. What to check

Sign in as alice on the Mac, and as bob on the web (or the Pixel). Each sets up encryption from the bar at the bottom
(Set up, the recovery key saved, Continue). Friends first: a DM takes a friendship.

1. **The core loads, and its key is in the login Keychain.** Once alice's device is set up, a DM with bob opens and its
   messages go both ways.
   - **Keychain Access,** in the login keychain: an application password named `com.duvet.desktop.canary`
     (`com.duvet.desktop.dev` for a dev build), its account alice's user ID
     (`01920000-0000-7000-8000-00000000a11c`). Beside her database,
     `~/Library/Application Support/com.duvet.desktop/<channel>/e2e/<her user ID>/core.db`, there's no `core.db.key`.
   - **Only the build that made it reads it unasked:** a second start opens the conversations asking nothing, and
     `security find-generic-password -s com.duvet.desktop.canary -a <her user ID> -w` asks before it shows anything
     (Deny). Another build (a later canary, or a dev build) may ask once, and «Always Allow» opens it.
   - **A locked keychain:** lock the login keychain (Keychain Access, File → Lock Keychain "login") and start the app.
     macOS asks for its password as the database opens. Cancel it: the bar says «Duvet couldn't open your encrypted
     conversations. If your system's keyring is locked, unlock it and try again.» with Try again, and no `core.db.key`
     appears. Try again asks again, and unlocking opens the conversations.
2. **A second instance says it's locked.** `open -n /Applications/Duvet-canary.app` while it runs: the second one's bar
   says «Encrypted conversations are open in another Duvet window.», and the first one goes on.
3. **The boxes outside the page:** Electrobun's own (NSAlert), each with Cancel first and as its default: Enter and Esc
   cancel, and Cancel changes nothing. The six of `docs/e2e-on-linux.md`, section 3, point 3: approving a new device,
   verifying a contact, removing a device, changing keys, starting over and another account. And being approved: the
   Mac as alice's new device opens «Set up this device» in a window of its own, over the main window, which the page
   can't reach; it renews its QR in place, and closing it doesn't quit Duvet.
4. **The window keeps up while a large history is shared,** as on Linux (point 4 there).
5. **The recovery key's Copy:** the key goes on this Mac's pasteboard alone, not to another device's Universal
   Clipboard, marked concealed, so a clipboard manager that honours it keeps no copy. Pasted within a minute it's there;
   a minute later it's gone, unless something else was copied meanwhile.
6. **A player's frame:** until the frames' bridges are closed (PLAN-E2E-PLATAFORMAS.md, Task 5, after the cutover), a
   frame on macOS still has Electrobun's bridges. What holds today: in a dev build, play a YouTube embed, and in the Web
   Inspector, in each of the player's frames, `[typeof __electrobunSecretKeyBytes, typeof __electrobunRpcSocketPort]`
   says `['undefined', 'undefined']`, where the top one says `['object', 'number']`.
7. **The microphone and the camera:** the first voice join asks for the microphone, and the first camera for the camera,
   each with Duvet's line in the system's language. In a signed build too, which runs under the hardened runtime.
8. **Updates,** on the stable channel alone (a canary never updates itself), once two signed macOS versions are
   published:
   - with the first in Applications and the second out, the title bar offers «Restart to update» once the second is
     downloaded and checked (it looks 30 s after the start, then every 6 hours). It closes Duvet and opens the second in
     its place, with its data, and the Keychain item opens asking nothing: both are signed by Duvet's Developer ID;
   - run from the `.dmg` or from Downloads (translocated), from a folder this user can't write, or from another volume
     than the user's own, it offers «Download update» instead, which opens duvet.chat/download.
9. **The rest, with the web and with the Pixel,** as on Linux (point 8 there): conversing, attachments, recovery,
   approval by code and by the Pixel's scan, history, and the backup.

Leave the stack up only while you check: other runs of the API's suites wait for its ports.
