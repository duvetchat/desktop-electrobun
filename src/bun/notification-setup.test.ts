import { describe, expect, spyOn, test } from "bun:test";
import { listenAndSetUp, notificationIdentity, registryCommands } from "./notification-setup";

// Each channel's notifications have their own sender, link and pipe, so the dev build never takes the installed app's.
describe("a channel's notification identity", () => {
	test("stable is plain Duvet; canary and dev carry their channel", () => {
		expect(notificationIdentity("stable")).toEqual({
			aumid: "com.duvet.desktop",
			displayName: "Duvet",
			scheme: "duvet",
			pipe: String.raw`\\.\pipe\duvet-open-stable`,
		});
		expect(notificationIdentity("canary")).toEqual({
			aumid: "com.duvet.desktop.canary",
			displayName: "Duvet Canary",
			scheme: "duvet-canary",
			pipe: String.raw`\\.\pipe\duvet-open-canary`,
		});
		expect(notificationIdentity("dev")).toMatchObject({ displayName: "Duvet Dev", scheme: "duvet-dev" });
	});
});

describe("the registry's keys", () => {
	const paths = {
		iconPath: String.raw`C:\Users\A B\AppData\Local\com.duvet.desktop\dev\notification-icon.png`,
		execPath: String.raw`C:\Users\A B\AppData\Local\com.duvet.desktop\dev\app\bin\bun.exe`,
		forwarderPath: String.raw`C:\Users\A B\AppData\Local\com.duvet.desktop\dev\notification-forwarder.js`,
	};
	const commands = registryCommands(notificationIdentity("dev"), paths);
	// What the command that sets a value (name, or the key's default for null) gives after a flag: /d its data, /t its type.
	const field = (key: string, name: string | null, flag: "/d" | "/t") => {
		const found = commands.find((c) => c[2] === key && (name === null ? c[3] === "/ve" : c[4] === name));
		return found?.[found.indexOf(flag) + 1];
	};
	const value = (key: string, name: string | null) => field(key, name, "/d");
	const typeOf = (key: string, name: string | null) => field(key, name, "/t");

	test("the sender, by its AUMID: its name and its icon, in the user's own hive", () => {
		const key = String.raw`HKCU\Software\Classes\AppUserModelId\com.duvet.desktop.dev`;
		expect(value(key, "DisplayName")).toBe("Duvet Dev");
		expect(value(key, "IconUri")).toBe(paths.iconPath);
	});

	// conhost by its full path, which Windows expands as it runs the handler: a bare name is left to the search order.
	test("the link's scheme, whose handler runs the forwarder without a window, every path quoted", () => {
		const key = String.raw`HKCU\Software\Classes\duvet-dev`;
		expect(value(key, "URL Protocol")).toBe("");
		const handler = String.raw`${key}\shell\open\command`;
		expect(value(handler, null)).toBe(
			String.raw`%SystemRoot%\System32\conhost.exe --headless "${paths.execPath}" "${paths.forwarderPath}" "%1"`,
		);
		expect(typeOf(handler, null)).toBe("REG_EXPAND_SZ");
	});

	test("every command is reg add, forced", () => {
		for (const c of commands) {
			expect(c.slice(0, 2)).toEqual(["reg", "add"]);
			expect(c.at(-1)).toBe("/f");
		}
	});
});

// A click while the registry was being written found no pipe, and the forwarder started a second Duvet.
describe("starting a channel's notifications", () => {
	test("listens for clicks before it writes the registry, and also when that fails", async () => {
		const steps: string[] = [];
		const listen = async () => void steps.push("listen");
		const errors = spyOn(console, "error").mockImplementation(() => {});
		const started = await listenAndSetUp(listen, async () => void steps.push("set up"));
		const failed = await listenAndSetUp(listen, async () => {
			steps.push("set up");
			throw new Error("the data folder can't be written");
		});
		const logged = errors.mock.calls.length;
		errors.mockRestore();
		expect(steps).toEqual(["listen", "set up", "listen", "set up"]);
		expect([started, failed]).toEqual([true, false]);
		expect(logged).toBe(1);
	});
});
