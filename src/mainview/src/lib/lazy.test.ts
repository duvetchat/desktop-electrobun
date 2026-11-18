import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IDLE_TIMEOUT_MS, lazy, NO_IDLE_DELAY_MS, whenIdle, type IdleHost } from "$lib/lazy";

describe("lazy", () => {
	test("loads once, whoever asks and however often, and has the value from then on", async () => {
		let loads = 0;
		const screen = lazy(async () => `screen ${++loads}`);
		expect(screen.value).toBeNull();
		expect(loads).toBe(0);
		const [first, second] = await Promise.all([screen.load(), screen.load()]);
		expect([first, second]).toEqual(["screen 1", "screen 1"]);
		expect(await screen.load()).toBe("screen 1");
		expect(screen.value).toBe("screen 1");
		expect(loads).toBe(1);
	});

	test("a load that failed is tried again by the next ask", async () => {
		let loads = 0;
		const screen = lazy(async () => {
			if (++loads === 1) throw new Error("offline");
			return "screen";
		});
		await expect(screen.load()).rejects.toThrow("offline");
		expect(screen.value).toBeNull();
		expect(await screen.load()).toBe("screen");
		expect(loads).toBe(2);
	});
});

describe("whenIdle", () => {
	test("runs when the browser says the page is idle, and waits for a busy page only so long", () => {
		const asked: { run: () => void; timeout?: number }[] = [];
		const host: IdleHost = {
			requestIdleCallback: (run, options) => asked.push({ run, timeout: options?.timeout }),
			cancelIdleCallback: () => {},
			setTimeout: () => {
				throw new Error("not this way");
			},
			clearTimeout: () => {},
		};
		let ran = 0;
		whenIdle(() => void ran++, host);
		expect(asked.map((ask) => ask.timeout)).toEqual([IDLE_TIMEOUT_MS]);
		expect(ran).toBe(0);
		asked[0]?.run();
		expect(ran).toBe(1);
	});

	test("is called off by what it returns", () => {
		const cancelled: number[] = [];
		const host: IdleHost = {
			requestIdleCallback: () => 7,
			cancelIdleCallback: (handle) => void cancelled.push(handle),
			setTimeout: () => 0,
			clearTimeout: () => {},
		};
		whenIdle(() => {}, host)();
		expect(cancelled).toEqual([7]);
	});

	test("where the browser can't say, runs after the page's start, and can be called off", () => {
		const timers: { run: () => void; ms: number }[] = [];
		const cleared: unknown[] = [];
		const host: IdleHost = {
			setTimeout: (run, ms) => timers.push({ run, ms }),
			clearTimeout: (handle) => void cleared.push(handle),
		};
		let ran = 0;
		const stop = whenIdle(() => void ran++, host);
		expect(timers.map((timer) => timer.ms)).toEqual([NO_IDLE_DELAY_MS]);
		timers[0]?.run();
		expect(ran).toBe(1);
		stop();
		expect(cleared).toEqual([1]);
	});
});

// C-18 of the redesign's review: the desktop app's main window loaded both settings screens, sixteen files it can
// never draw (there they are windows of their own), with the app's page.
describe("the settings screens", () => {
	const component = (name: string) => readFileSync(join(import.meta.dir, "components", `${name}.svelte`), "utf8");
	const hosts = [
		{ name: "UserSettings", screen: "SettingsScreen" },
		{ name: "ServerSettings", screen: "SpaceSettingsScreen" },
	];

	test("are no part of the app's page: what opens them loads them apart", () => {
		for (const { name, screen } of hosts) {
			const source = component(name).replace(/\s+/g, " ");
			expect(source).not.toMatch(new RegExp(`import ${screen} from`));
			expect(source).toContain(`lazy(() => import("$lib/components/settings/${screen}.svelte")`);
		}
	});

	test("are never loaded in the desktop app's main window, where they are windows", () => {
		for (const { name } of hosts) {
			const source = component(name).replace(/\s+/g, " ");
			// Both ways in, the idle load and the first opening, come after the window's check, which returns.
			expect(source).toContain(
				"onMount(() => { if (inWindow) { startSettingsHost(ownMobileOnly); return; } return whenIdle(show); });",
			);
			expect(source).toMatch(
				/if \(inWindow\) \{ open = false; [^;]*void openAppWindow\([^;]*\); return; \} show\(\); \}\);/,
			);
			expect(source.match(/\bshow\(\)/g)).toHaveLength(2);
		}
	});

	test("on the web are loaded once the page is idle, so the first opening finds them there", () => {
		for (const { name } of hosts) expect(component(name)).toContain("return whenIdle(show);");
	});
});
