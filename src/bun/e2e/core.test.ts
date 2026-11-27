import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import config from "../../../electrobun.config";

// The core in the app's Bun (PLAN-E2E-CLIENTES.md, Task 7): the core opened as the app opens it, its key in the keyring
// its config names. The library each build carries is library.test.ts's.

const ROOT = join(import.meta.dir, "../../..");
/** The Linux library native/core carries for the tests, or the build DUVET_E2E_FFI names. */
const LIBRARY = process.env.DUVET_E2E_FFI || join(ROOT, "native/core/linux-x64/libduvet_e2e_ffi.so");

const user = "0193a4b2-0000-7000-8000-00000000000a";
const device = "0193a4b2-0000-7000-8000-00000000000b";

const folders: string[] = [];
afterAll(() => folders.forEach((folder) => rmSync(folder, { recursive: true, force: true })));
const folder = () => {
	const made = mkdtempSync(join(tmpdir(), "duvet-core-"));
	folders.push(made);
	return made;
};

// The app runs the worker from coreWorker's source as Electrobun's build prints it. A bundler can put names of the
// module's into a function's body (require becomes __require), which would leave the worker dead in the packaged app
// alone: so the worker runs here from core.ts built as Electrobun builds the Bun side.
test.skipIf(!existsSync(LIBRARY))(
	"the worker runs from the core built as Electrobun builds the Bun side",
	async () => {
		const { entrypoint, ...options } = config.build.bun;
		expect(entrypoint).toBe("src/bun/index.ts");
		const out = folder();
		const built = await Bun.build({
			...options,
			entrypoints: [join(import.meta.dir, "core.ts")],
			outdir: out,
			target: "bun",
		});
		expect(built.success).toBe(true);
		const { startCore } = await import(join(out, "core.js"));
		const core = startCore({ library: LIBRARY, folder: folder(), key: Buffer.alloc(32, 5).toString("base64") });
		try {
			expect(await core.run("open", { userId: user })).toMatchObject({
				ok: { state: "ready", keyStorage: "provided" },
			});
			await core.run("handle", { command: { cmd: "create_device", user_id: user, device_id: device } });
			expect((await core.run("handle", { command: { cmd: "status" } })).ok).toMatchObject({ device_id: device });
			const { key } = (await core.run("handle", { command: { cmd: "attachment_key" } })).ok;
			const file = { key, attachmentId: device, index: 0, last: true };
			const data = Buffer.from("a file's bytes").toString("base64");
			const sealed = (await core.run("sealParts", { ...file, parts: [data] })).ok.parts;
			expect((await core.run("openParts", { ...file, parts: sealed })).ok.parts).toEqual([data]);
			expect((await core.run("stash", { shareId: device, n: 1, part: data })).error).toMatchObject({ field: "n" });
			expect(await core.run("close")).toEqual({ ok: {} });
			expect(await core.run("destroy", { userId: user })).toEqual({ ok: {} });
		} finally {
			core.stop();
		}
	},
	60_000,
);

/**
 * A run of the core as the app opens it, in a Bun of its own: its config names a keyring, and in a process without a
 * session bus Linux has no Secret Service, so the key goes to a file beside the database. The run can't be this one:
 * process.env doesn't reach the library's getenv, and this machine's session bus has a person's keyring on it. With
 * `bus`, the run keeps this process's session bus, which must be one of its own (SECRET_SERVICE).
 */
function asTheApp(steps: string, home: string, bus = false): any[] {
	const script = `
		const { startCore } = await import(${JSON.stringify(join(import.meta.dir, "core.ts"))});
		const library = ${JSON.stringify(LIBRARY)};
		const folder = ${JSON.stringify(home)};
		const keyring = { service: "com.duvet.desktop.test" };
		const log = [];
		const note = (value) => log.push(value);
		${steps}
		console.log(JSON.stringify(log));
		process.exit(0);
	`;
	const noBus = { DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(home, "no-bus")}`, XDG_RUNTIME_DIR: home };
	const run = Bun.spawnSync([process.execPath, "-e", script], {
		env: { ...process.env, ...(bus ? {} : noBus) },
		stdout: "pipe",
		stderr: "pipe",
	});
	if (run.exitCode !== 0) throw new Error(`the app's run failed: ${run.stderr.toString()}`);
	return JSON.parse(run.stdout.toString().trim().split("\n").at(-1)!);
}

describe.skipIf(process.platform !== "linux" || !existsSync(LIBRARY))("the core as the app opens it", () => {
	test("opens with the key its keyring config names", () => {
		const home = folder();
		const [opened, made, again, status, otherKey] = asTheApp(
			`
			const core = startCore({ library, folder, keyring });
			note(await core.run("open", { userId: "${user}" }));
			note(await core.run("handle", { command: { cmd: "create_device", user_id: "${user}", device_id: "${device}" } }));
			await core.run("close");
			note(await core.run("open", { userId: "${user}" }));
			note(await core.run("handle", { command: { cmd: "status" } }));
			// Closed first: a stopped worker leaves its database open in the library, which is the process's.
			await core.run("close");
			core.stop();
			// Another key doesn't open that database: the file's key is the one it was made with.
			const stranger = startCore({ library, folder, key: Buffer.alloc(32, 7).toString("base64") });
			note(await stranger.run("open", { userId: "${user}" }));
			stranger.stop();
			`,
			home,
		);
		expect(opened).toMatchObject({ ok: { state: "ready", keyStorage: "file" } });
		expect(made.ok).toHaveProperty("signature_key");
		expect(again).toMatchObject({ ok: { state: "ready", keyStorage: "file" } });
		expect(status.ok).toMatchObject({ device_id: device, user_id: user, key_storage: "file" });
		// It says why: the key, which no later open fixes, not a failure that passes.
		expect(otherKey).toMatchObject({ ok: { state: "failed", reason: "bad_key" } });
		// Where the plan's table puts it: <userData>/e2e/<user_id>/core.db, the key beside it for its user alone.
		const database = join(home, user, "core.db");
		expect(existsSync(database)).toBe(true);
		expect(statSync(`${database}.key`).mode & 0o777).toBe(0o600);
		expect(readFileSync(`${database}.key`).length).toBe(32);
	});

	test("a second instance is told it's locked", () => {
		const home = folder();
		const [first, second, afterClose] = asTheApp(
			`
			const one = startCore({ library, folder, keyring });
			const two = startCore({ library, folder, keyring });
			note(await one.run("open", { userId: "${user}" }));
			note(await two.run("open", { userId: "${user}" }));
			await one.run("close");
			note(await two.run("open", { userId: "${user}" }));
			one.stop();
			two.stop();
			`,
			home,
		);
		expect(first).toMatchObject({ ok: { state: "ready" } });
		expect(second).toMatchObject({ ok: { state: "locked" } });
		expect(afterClose).toMatchObject({ ok: { state: "ready" } });
	});

	test("destroy leaves nothing to open", () => {
		const home = folder();
		const database = join(home, user, "core.db");
		const [opened, , destroyed, reopened, status, keys, destroyedAgain] = asTheApp(
			`
			const { readFileSync } = await import("node:fs");
			const keyFile = ${JSON.stringify(`${database}.key`)};
			const core = startCore({ library, folder, keyring });
			note(await core.run("open", { userId: "${user}" }));
			note(await core.run("handle", { command: { cmd: "create_device", user_id: "${user}", device_id: "${device}" } }));
			const before = readFileSync(keyFile).toString("base64");
			// While it's open, destroy closes it first.
			note(await core.run("destroy", { userId: "${user}" }));
			note(await core.run("open", { userId: "${user}" }));
			note(await core.run("handle", { command: { cmd: "status" } }));
			note({ before, now: readFileSync(keyFile).toString("base64") });
			note(await core.run("destroy", { userId: "${user}" }));
			core.stop();
			`,
			home,
		);
		expect(opened).toMatchObject({ ok: { state: "ready", keyStorage: "file" } });
		expect(destroyed).toEqual({ ok: {} });
		// What opens there now is a new database: no device, and a key of its own.
		expect(reopened).toMatchObject({ ok: { state: "ready", keyStorage: "file" } });
		expect(status.ok.device_id).toBeUndefined();
		expect(keys.now).not.toBe(keys.before);
		expect(destroyedAgain).toEqual({ ok: {} });
		for (const file of [database, `${database}.key`]) expect(existsSync(file)).toBe(false);
		// The locks stay, empty: an open may be waiting for one or racing for the other (the core's contract).
		for (const lock of [`${database}.lock`, `${database}.key.lock`]) expect(statSync(lock).size).toBe(0);
	});
});

/**
 * A session bus with a Secret Service of the run's own, as DUVET_E2E_SECRET_SERVICE says: CI's run under dbus-run-session,
 * with gnome-keyring (the core's binding tests take the same word). Never a person's own keyring: a run without it skips.
 */
const SECRET_SERVICE = process.platform === "linux" && process.env.DUVET_E2E_SECRET_SERVICE === "1";

describe.skipIf(!SECRET_SERVICE || !existsSync(LIBRARY))("the core with a Secret Service", () => {
	test("the key goes to the Secret Service when there is one", () => {
		const home = folder();
		// An account of this run's own: the Secret Service outlives the test's folder.
		const owner = crypto.randomUUID();
		const database = join(home, owner, "core.db");
		const [opened, made, again, status, keyFile, otherKey, destroyed, fresh] = asTheApp(
			`
			const { existsSync } = await import("node:fs");
			const core = startCore({ library, folder, keyring });
			note(await core.run("open", { userId: "${owner}" }));
			note(await core.run("handle", { command: { cmd: "create_device", user_id: "${owner}", device_id: "${device}" } }));
			await core.run("close");
			note(await core.run("open", { userId: "${owner}" }));
			note(await core.run("handle", { command: { cmd: "status" } }));
			await core.run("close");
			note(existsSync(${JSON.stringify(`${database}.key`)}));
			// Another key doesn't open that database: its key is the Secret Service's.
			const stranger = startCore({ library, folder, key: Buffer.alloc(32, 7).toString("base64") });
			note(await stranger.run("open", { userId: "${owner}" }));
			stranger.stop();
			// Destroying it takes the credential away: what opens there next is a database of its own.
			note(await core.run("destroy", { userId: "${owner}" }));
			note(await core.run("open", { userId: "${owner}" }));
			await core.run("destroy", { userId: "${owner}" });
			core.stop();
			`,
			home,
			true,
		);
		expect(opened).toMatchObject({ ok: { state: "ready", keyStorage: "keyring" } });
		expect(made.ok).toHaveProperty("signature_key");
		expect(again).toMatchObject({ ok: { state: "ready", keyStorage: "keyring" } });
		expect(status.ok).toMatchObject({ device_id: device, user_id: owner, key_storage: "keyring" });
		expect(keyFile).toBe(false);
		expect(otherKey).toMatchObject({ ok: { state: "failed", reason: "bad_key" } });
		expect(destroyed).toEqual({ ok: {} });
		expect(fresh).toMatchObject({ ok: { state: "ready", keyStorage: "keyring" } });
	});
});
