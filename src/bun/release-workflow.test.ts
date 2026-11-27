import { describe, expect, test } from "bun:test";

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

	test("the signing key and the releases' token reach the stable jobs alone", () => {
		const stable = ["secrets.DESKTOP_UPDATE_SIGNING_KEY", "secrets.RELEASES_TOKEN"];
		expect(secrets(job("windows"))).toEqual(stable);
		expect(secrets(job("linux"))).toEqual(stable);
		// The test channel builds any branch it's given.
		expect(secrets(job("test-channel"))).toEqual([]);
		expect(Object.keys(typeof jobs === "object" && jobs !== null ? jobs : {}).sort()).toEqual([
			"linux",
			"test-channel",
			"windows",
		]);
	});
});
