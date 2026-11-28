// The servers of a local stack (PLAN-E2E-CLIENTES.md, Task 34; docs/e2e-on-windows.md, docs/e2e-on-linux.md,
// docs/e2e-on-macos.md): the fake S3 and mail server, the API and the gateway, on the Postgres and Dragonfly the API's
// harness keeps up (its run.ts with E2E_KEEP=1), started by the harness's own lib.ts as its clients' suites start them:
// its environment, its seeded accounts and its E2E_MIN_CLIENTS with Linux and macOS added, and nothing of a .env.
//
//   bun scripts/local-stack.ts [command ...]
//
// The API listens on port 9876 and the gateway on 127.0.0.1:8765, where the app's `local` target looks for them
// (src/mainview/src/lib/common/common.ts), and the harness's API takes the app's origins: the packaged app's, the dev
// server's (localhost:5173) and the browser cases' (scripts/web-e2e.ts). With a command, it runs it with the stack's
// variables, as the API's clients' suites hand them to the clients' tests (E2E_LIVE_API, E2E_LIVE_WS, E2E_LIVE_ACCOUNTS,
// E2E_LIVE_PASSWORD), and stops the servers after; without one, it keeps them up until it's stopped. API_DIR is the
// API's checkout (default ../duvet-api), and API_EXE and GW_EXE the binaries its run.ts built (default its duvet-e2e-bin
// in the temp folder).
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../package.json";

const API_PORT = 9876;
const GATEWAY_ADDR = "127.0.0.1:8765";
const exe = process.platform === "win32" ? ".exe" : "";
const apiDir = process.env.API_DIR ?? join(import.meta.dir, "..", "..", "duvet-api");
const bin = join(tmpdir(), "duvet-e2e-bin");
// lib.ts reads these as it loads: worker 0's stack, the one a single run.ts keeps.
process.env.E2E_WORKER ??= "0";
process.env.API_EXE ||= join(bin, `duvet-api${exe}`);
process.env.GW_EXE ||= join(bin, `duvet-gateway${exe}`);
const lib = await import(join(apiDir, "tests", "e2e", "lib.ts"));

const api = `http://localhost:${API_PORT}`;
const gateway = `ws://${GATEWAY_ADDR}`;

/** Waits until `url` answers, 30 s at most. */
async function answers(url: string): Promise<boolean> {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		if (
			await fetch(url).then(
				(response) => response.ok,
				() => false,
			)
		)
			return true;
		await Bun.sleep(300);
	}
	return false;
}

// The harness's minimums, and Linux and macOS at this checkout's version, which production names only once each is
// turned on (PLAN-E2E-PLATAFORMAS.md, «Encender una plataforma»): their builds' encrypted conversations open here.
const minimums = lib.minClientsWith({ "desktop-linux": pkg.version, "desktop-macos": pkg.version });
lib.startFakes();
// The copies of images messages name are served from the API itself.
lib.startApi("local-api", {
	DUVET_API_APPLICATION_PORT: String(API_PORT),
	API_PUBLIC_URL: api,
	E2E_MIN_CLIENTS: minimums,
});
lib.startGateway("local-gateway", { ADDR: GATEWAY_ADDR, E2E_MIN_CLIENTS: minimums });
const up = {
	fakes: await lib.fakesUp(),
	api: await answers(`${api}/health`),
	gateway: await answers(`http://${GATEWAY_ADDR}/health`),
};
if (!up.fakes || !up.api || !up.gateway) {
	console.error(`the stack's servers didn't come up (${JSON.stringify(up)}): their logs are in ${lib.LOGS}`);
	process.exit(2);
}
const live = { ...lib.liveEnv(), E2E_LIVE_API: api, E2E_LIVE_WS: gateway };
const command = process.argv.slice(2);
if (command.length === 0) {
	const listed: unknown = JSON.parse(live.E2E_LIVE_ACCOUNTS);
	const emails = Array.isArray(listed)
		? listed.map((account: unknown) => String(Reflect.get(Object(account), "email")))
		: [];
	console.log(`The API is at ${api} and the gateway at ${gateway}, on worker ${process.env.E2E_WORKER}'s stack.`);
	console.log(`Its accounts: ${emails.join(", ")}, each with the password ${live.E2E_LIVE_PASSWORD}.`);
	console.log(`Their logs are in ${lib.LOGS}. Ctrl+C stops them.`);
	await new Promise(() => {});
}
const run = Bun.spawn(command, {
	env: { ...process.env, ...live },
	stdin: "inherit",
	stdout: "inherit",
	stderr: "inherit",
});
// lib.ts stops the servers as this process exits.
process.exit(await run.exited);
