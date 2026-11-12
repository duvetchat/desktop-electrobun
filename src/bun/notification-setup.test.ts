import { describe, expect, test } from "bun:test";
import { notificationIdentity, registryCommands } from "./notification-setup";

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
	const value = (key: string, name: string | null) => {
		const command = commands.find((c) => c[2] === key && (name === null ? c[3] === "/ve" : c[4] === name));
		return command?.[command.indexOf("/d") + 1];
	};

	test("the sender, by its AUMID: its name and its icon, in the user's own hive", () => {
		const key = String.raw`HKCU\Software\Classes\AppUserModelId\com.duvet.desktop.dev`;
		expect(value(key, "DisplayName")).toBe("Duvet Dev");
		expect(value(key, "IconUri")).toBe(paths.iconPath);
	});

	test("the link's scheme, whose handler runs the forwarder without a window, every path quoted", () => {
		const key = String.raw`HKCU\Software\Classes\duvet-dev`;
		expect(value(key, "URL Protocol")).toBe("");
		expect(value(String.raw`${key}\shell\open\command`, null)).toBe(
			`conhost.exe --headless "${paths.execPath}" "${paths.forwarderPath}" "%1"`,
		);
	});

	test("every command is reg add, forced", () => {
		for (const c of commands) {
			expect(c.slice(0, 2)).toEqual(["reg", "add"]);
			expect(c.at(-1)).toBe("/f");
		}
	});
});
