import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ShellInputs } from "$lib/platform";
import { deviceOf, duvetClient, keepDevice, keepUser, lastUser } from "./client";

// What the app tells the API (X-Duvet-Client) and the gateway (an identify's client) it is: <platform>/<version>, which
// the API reads as its ParseClient does (duvet-api's internal/domain/e2e) and holds to E2E_MIN_CLIENTS (PLAN-E2E-API.md,
// its formats; PLAN-E2E-CLIENTES.md, Task 10).
const ROOT = join(import.meta.dir, "..", "..", "..", "..", "..");
const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

/** A page's shell inputs: the desktop app's, with what Bun says of its system, or a browser's. */
const inputs = (over: Partial<ShellInputs>): ShellInputs => ({
	inElectrobun: false,
	injected: null,
	userAgent: "",
	preview: null,
	...over,
});
const shell = (os: string) => ({
	os,
	titleBarStyle: "hidden" as const,
	nativeButtons: false,
	glass: false,
	window: "main" as const,
});

describe("the client the app says it is", () => {
	test("is the desktop app by its system, or the web", () => {
		expect(duvetClient(inputs({ inElectrobun: true, injected: shell("win32") }))).toBe(`desktop-windows/${version}`);
		expect(duvetClient(inputs({ inElectrobun: true, injected: shell("darwin") }))).toBe(`desktop-macos/${version}`);
		expect(duvetClient(inputs({ inElectrobun: true, injected: shell("linux") }))).toBe(`desktop-linux/${version}`);
		expect(duvetClient(inputs({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }))).toBe(`web/${version}`);
	});

	test("goes by the user agent in the desktop app when Bun said nothing of its system", () => {
		const windows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
		const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
		expect(duvetClient(inputs({ inElectrobun: true, userAgent: windows }))).toBe(`desktop-windows/${version}`);
		expect(duvetClient(inputs({ inElectrobun: true, userAgent: mac }))).toBe(`desktop-macos/${version}`);
		expect(duvetClient(inputs({ inElectrobun: true, userAgent: "X11; Linux x86_64" }))).toBe(
			`desktop-linux/${version}`,
		);
	});

	// The dev server draws another system's chrome on request (?shell=mac): the app it runs is still a browser's.
	test("is never the dev server's preview of another system", () => {
		expect(duvetClient(inputs({ preview: "mac" }))).toBe(`web/${version}`);
		expect(duvetClient(inputs({ preview: "windows" }))).toBe(`web/${version}`);
		expect(duvetClient(inputs({ inElectrobun: true, injected: shell("win32"), preview: "web" }))).toBe(
			`desktop-windows/${version}`,
		);
	});

	test("has the version of the desktop's package.json, as major.minor.patch with up to four digits each", () => {
		expect(VITE_APP_VERSION).toBe(version);
		expect(VITE_APP_VERSION).toMatch(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/);
		expect(duvetClient()).toBe(`web/${version}`);
	});

	// The app's builds get it from Vite, as the tests from their preload: the same file's.
	test("is the version the app's builds are made with", () => {
		const config = readFileSync(join(import.meta.dir, "..", "..", "..", "vite.config.ts"), "utf8");
		expect(config).toContain('import { version } from "../../package.json";');
		expect(config).toContain("VITE_APP_VERSION: JSON.stringify(version)");
	});
});

// The gateway hands a device's events only to the connections that identified with it (PLAN-E2E-API.md, its events),
// and the app connects before its core opens: it keeps the device it registered, by user (Ruling 30).
describe("the device an identify names", () => {
	const ANA = "0193a4b2-0000-7000-8000-00000000a0a0";
	const BO = "0193a4b2-0000-7000-8000-00000000b0b0";
	const DEVICE = "0193a4b2-0000-7000-8000-0000000d0001";

	test("is the one kept for its user, under duvet.e2e.<user_id>.device, none before", () => {
		expect(deviceOf(ANA)).toBeNull();
		keepDevice(ANA, DEVICE);
		expect(deviceOf(ANA)).toBe(DEVICE);
		expect(deviceOf(BO)).toBeNull();
		expect(localStorage.getItem(`duvet.e2e.${ANA}.device`)).toBe(DEVICE);
	});

	test("goes by the user the page last connected as, which a new page reads before its READY says", () => {
		expect(lastUser()).toBeNull();
		keepUser(BO);
		expect(lastUser()).toBe(BO);
		expect(localStorage.getItem("duvet.e2e.user")).toBe(BO);
	});
});
