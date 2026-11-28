import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// .github/workflows/release.yml (#456, #590): each system's stable build, published on a tag, and the test channel, by
// hand. Electrobun builds only for the system it runs on, so each system has a job of its own on its runner.
const workflow: unknown = Bun.YAML.parse(
	await Bun.file(new URL("../../.github/workflows/release.yml", import.meta.url)).text(),
);
const field = (of: unknown, name: string): unknown =>
	typeof of === "object" && of !== null ? Reflect.get(of, name) : undefined;
const jobs = field(workflow, "jobs");
const job = (name: string): Record<string, unknown> => {
	const found = field(jobs, name);
	if (typeof found !== "object" || found === null) throw new Error(`release.yml has no ${name} job`);
	return Object.fromEntries(Object.entries(found));
};
const secrets = (of: unknown) => [...new Set(JSON.stringify(of).match(/secrets\.\w+/g))].sort();
type Step = { name?: string; run?: string; env?: Record<string, string> } & Record<string, unknown>;
const steps = (name: string): Step[] => {
	const found = job(name).steps;
	if (!Array.isArray(found)) throw new Error(`release.yml's ${name} job has no steps`);
	return found;
};
/** A job's step by its name, or by its command when it has none. */
const step = (name: string, called: string): Step => {
	const found = steps(name).find((each) => (each.name ?? each.run) === called);
	if (!found) throw new Error(`release.yml's ${name} job has no step ${called}`);
	return found;
};

// The macOS job's own steps, around the windows job's (#619).
const GATE = "Apple's secrets, or no build";
const KEYCHAIN = "Duvet's Developer ID, in a keychain of this job's own";
const APPLE_SECRETS = [
	"MACOS_CERTIFICATE",
	"MACOS_CERTIFICATE_PASSWORD",
	"APPLE_ID",
	"APPLE_APP_PASSWORD",
	"APPLE_TEAM_ID",
];

describe("the release workflow", () => {
	test("Linux's stable job runs Windows' steps, on GitHub's Ubuntu runner, for a tag alone, once Linux is turned on", () => {
		const { "runs-on": windowsRunner, if: windowsIf, ...windows } = job("windows");
		const { "runs-on": linuxRunner, if: linuxIf, ...linux } = job("linux");
		expect(windowsRunner).toBe("windows-latest");
		expect(linuxRunner).toBe("ubuntu-24.04");
		expect(linux).toEqual(windows);
		expect(windowsIf).toBe("github.event_name == 'push'");
		// A Linux build carries the core, which no frame may reach before RM1 (#588): no tag publishes one until the
		// repository's RELEASE_LINUX says Linux is on (PLAN-E2E-PLATAFORMAS.md).
		expect(linuxIf).toBe("github.event_name == 'push' && vars.RELEASE_LINUX == 'true'");
	});

	test("the signing key and the releases' token reach the stable jobs alone, and Apple's the macOS one", () => {
		const stable = ["secrets.DESKTOP_UPDATE_SIGNING_KEY", "secrets.RELEASES_TOKEN"];
		expect(secrets(job("windows"))).toEqual(stable);
		expect(secrets(job("linux"))).toEqual(stable);
		expect(secrets(job("macos"))).toEqual([...stable, ...APPLE_SECRETS.map((name) => `secrets.${name}`)].sort());
		// The test channel builds any branch it's given.
		expect(secrets(job("test-channel"))).toEqual([]);
		expect(Object.keys(typeof jobs === "object" && jobs !== null ? jobs : {}).sort()).toEqual([
			"linux",
			"macos",
			"test-channel",
			"windows",
		]);
		// Each of Apple's in the steps that need it alone: the gate, the certificate's keychain, the build's notarization.
		const holding = (secret: string) =>
			steps("macos")
				.filter((each) => JSON.stringify(each).includes(`secrets.${secret}`))
				.map((each) => each.name ?? each.run);
		expect(holding("MACOS_CERTIFICATE")).toEqual([GATE, KEYCHAIN]);
		expect(holding("MACOS_CERTIFICATE_PASSWORD")).toEqual([GATE, KEYCHAIN]);
		for (const secret of ["APPLE_ID", "APPLE_APP_PASSWORD", "APPLE_TEAM_ID"]) {
			expect(holding(secret)).toEqual([GATE, "bun run build:stable"]);
		}
	});

	// Only a signed and notarized build reaches desktop-stable (PLAN-E2E-PLATAFORMAS.md, «Restricciones globales»).
	test("macOS's stable job runs Windows' steps with Apple's among them, on GitHub's macOS runner, for a tag alone, once macOS is turned on", () => {
		const { "runs-on": runner, if: when, "timeout-minutes": minutes, steps: _, ...macos } = job("macos");
		const { "runs-on": _runner, if: _when, "timeout-minutes": _minutes, steps: __, ...windows } = job("windows");
		expect(runner).toBe("macos-latest");
		// Apple notarizes the app, its self-extracting bundle and the .dmg, each waited for.
		expect(minutes).toBe(90);
		expect(macos).toEqual(windows);
		// A macOS build carries the core, which no frame may reach before RM1 (#588), as RELEASE_LINUX holds Linux's.
		expect(when).toBe("github.event_name == 'push' && vars.RELEASE_MACOS == 'true'");

		const build = step("macos", "bun run build:stable");
		const { env: notarization, ...plainBuild } = build;
		const ownSteps = steps("macos")
			.filter((each) => each.name !== GATE && each.name !== KEYCHAIN)
			.map((each) => (each === build ? plainBuild : each));
		expect(ownSteps).toEqual(steps("windows"));
		expect(notarization).toEqual({
			ELECTROBUN_APPLEID: "${{ secrets.APPLE_ID }}",
			ELECTROBUN_APPLEIDPASS: "${{ secrets.APPLE_APP_PASSWORD }}",
			ELECTROBUN_TEAMID: "${{ secrets.APPLE_TEAM_ID }}",
		});
		// The gate before anything installs or builds, and the Developer ID in place before the build.
		const order = steps("macos").map((each) => each.name ?? each.run);
		expect(order.indexOf(GATE)).toBeLessThan(order.indexOf("bun install --frozen-lockfile"));
		expect(order.indexOf(KEYCHAIN)).toBeLessThan(order.indexOf("bun run build:stable"));
		expect(step("macos", KEYCHAIN).run).toContain('echo "ELECTROBUN_DEVELOPER_ID=$identity" >> "$GITHUB_ENV"');
	});

	test.skipIf(process.platform === "win32")("without Apple's secrets, macOS's job stops before it builds", () => {
		const gate = step("macos", GATE);
		expect(gate.shell).toBe("bash");
		expect(Object.keys(gate.env ?? {}).sort()).toEqual([...APPLE_SECRETS].sort());
		const run = (env: Record<string, string>) =>
			Bun.spawnSync(["bash", "-c", gate.run ?? ""], { env: { PATH: process.env.PATH ?? "", ...env } });
		const all = Object.fromEntries(APPLE_SECRETS.map((name) => [name, "set"]));
		expect(run(all).exitCode).toBe(0);
		for (const name of APPLE_SECRETS) {
			const missing = run({ ...all, [name]: "" });
			expect(missing.exitCode).toBe(1);
			expect(missing.stdout.toString()).toContain(name);
		}
		expect(run({}).exitCode).toBe(1);
	});
});

// What Electrobun's build reads of electrobun.config.ts, given the macOS job's environment: it signs with the Developer
// ID when there's one, and has Apple notarize when it also has Apple's account; with none, nothing (#619).
describe("macOS's signing, by what the build is given", () => {
	const mac = (env: Record<string, string>) => {
		const read = Bun.spawnSync(
			[
				process.execPath,
				"-e",
				`const { build } = (await import(${JSON.stringify(join(import.meta.dir, "..", "..", "electrobun.config.ts"))})).default;
				console.log(JSON.stringify({ codesign: build.mac.codesign, notarize: build.mac.notarize }));`,
			],
			{ env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env } },
		);
		if (read.exitCode !== 0) throw new Error(read.stderr.toString());
		return JSON.parse(read.stdout.toString());
	};
	const identity = { ELECTROBUN_DEVELOPER_ID: "0123456789ABCDEF0123456789ABCDEF01234567" };
	const apple = { ELECTROBUN_APPLEID: "a@example.com", ELECTROBUN_APPLEIDPASS: "x", ELECTROBUN_TEAMID: "TEAM123456" };

	test("signs and notarizes with the Developer ID and Apple's account, signs alone with the ID, and does nothing without", () => {
		expect(mac({ ...identity, ...apple })).toEqual({ codesign: true, notarize: true });
		expect(mac(identity)).toEqual({ codesign: true, notarize: false });
		expect(mac(apple)).toEqual({ codesign: false, notarize: false });
		expect(mac({})).toEqual({ codesign: false, notarize: false });
		for (const name of Object.keys(apple)) {
			expect(mac({ ...identity, ...apple, [name]: "" })).toEqual({ codesign: true, notarize: false });
		}
	});
});
