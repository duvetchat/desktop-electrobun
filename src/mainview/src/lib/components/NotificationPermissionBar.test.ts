import { afterEach, describe, expect, test } from "bun:test";
import { tags } from "./server-render";

// The stores' .svelte.ts modules use $state, which only Svelte's compiler knows: here it's the value itself.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const { default: NotificationPermissionBar } = await import("./NotificationPermissionBar.svelte");

const bar = async () =>
	(await tags(NotificationPermissionBar, {})).find((t) => t.attributes["aria-label"] === "Notifications permission");

afterEach(() => {
	delete (globalThis as { window?: unknown }).window;
	delete (globalThis as { Notification?: unknown }).Notification;
});

// The web asks the browser for its permission to notify from a button, as a browser takes the request only from a click.
describe("the web's permission bar", () => {
	test("asks while the browser hasn't been asked", async () => {
		Object.assign(globalThis, { Notification: { permission: "default" } });
		expect(await bar()).toBeDefined();
	});

	test("asks nothing once the browser answered", async () => {
		for (const permission of ["granted", "denied"]) {
			Object.assign(globalThis, { Notification: { permission } });
			expect(await bar()).toBeUndefined();
		}
	});

	test("asks nothing in a browser without notifications, nor in the desktop app", async () => {
		expect(await bar()).toBeUndefined();
		Object.assign(globalThis, { Notification: { permission: "default" }, window: { __electrobunWindowId: 1 } });
		expect(await bar()).toBeUndefined();
	});
});
