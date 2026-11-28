import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import config from "../../electrobun.config";
import { BUN_NOTICES, bunBundleNotices } from "../../scripts/third-party-notices";
import { MANIFEST } from "../mainview/licenses/notices";
import { noticeProblems } from "../mainview/third-party-notices";

// The Licenses page's notices of the desktop app's own process (#628): the packages its Bun bundle ships, which
// licenses/bun.json keeps for the page's build, and the runtime Electrobun ships beside it, which the lists name.
const root = join(import.meta.dir, "..", "..");
const electrobun = join(root, "node_modules", "electrobun");

describe("the Bun process's packages", () => {
	test("are those its bundle ships, built as Electrobun builds it: `bun scripts/third-party-notices.ts` writes them", async () => {
		expect(await Bun.file(BUN_NOTICES).json()).toEqual(await bunBundleNotices());
	}, 60_000);

	test("each may ship: a licence text, under an accepted licence", async () => {
		const notices: { name: string; version?: string; license: string; text: string }[] =
			await Bun.file(BUN_NOTICES).json();
		expect(notices.map((notice) => notice.name)).toContain("electrobun");
		for (const notice of notices) expect(noticeProblems(notice, MANIFEST.accepted)).toEqual([]);
	});
});

// Electrobun's version holds the rest of its runtime (its update tools, the WebView2 loader): a new Electrobun is a
// new runtime, whose notices are checked again.
describe("the runtime's notices", () => {
	test("are of the Electrobun the build ships, and of the Bun and CEF it ships", async () => {
		const { version } = await Bun.file(join(electrobun, "package.json")).json();
		const { BUN_VERSION } = await import(join(electrobun, "dist/api/shared/bun-version.ts"));
		const { DEFAULT_CEF_VERSION_STRING } = await import(join(electrobun, "dist/api/shared/cef-version.ts"));
		const versions = Object.fromEntries(MANIFEST.runtime.map((notice) => [notice.name, notice.version]));
		expect(versions).toMatchObject({
			Electrobun: version,
			Bun: BUN_VERSION,
			"Chromium Embedded Framework": DEFAULT_CEF_VERSION_STRING,
		});
	});

	test("have CEF's for Linux only while the Linux build bundles it", () => {
		const cef = MANIFEST.runtime.find((notice) => notice.name === "Chromium Embedded Framework");
		expect(Boolean(cef)).toBe(Boolean(config.build.linux.bundleCEF));
		expect(cef?.platforms).toEqual(["linux"]);
	});
});
