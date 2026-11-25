// What the app is to the API and the gateway (PLAN-E2E-API.md, its formats and events; PLAN-E2E-CLIENTES.md, Task 10):
// the client X-Duvet-Client and an identify's client name, which the API holds to E2E_MIN_CLIENTS, and the device of this
// installation an identify names, which the page keeps by user so it identifies before its core opens (Ruling 30).
// Neither is a secret: the API knows both.
import { readShellInputs, shellFor, type ShellInputs } from "$lib/platform";

const PLATFORMS = { windows: "desktop-windows", mac: "desktop-macos", linux: "desktop-linux", web: "web" } as const;

/**
 * <platform>/<version>, as the API reads it: the desktop app by its system (Bun's word, else its user agent's), or the
 * web, never the dev server's preview of another system; the version is the root package.json's (VITE_APP_VERSION).
 */
export function duvetClient(inputs: ShellInputs = readShellInputs()): string {
	return `${PLATFORMS[shellFor({ ...inputs, preview: null }).chrome]}/${VITE_APP_VERSION}`;
}

const USER_KEY = "duvet.e2e.user";
const deviceKey = (userId: string) => `duvet.e2e.${userId}.device`;

/** The device this installation registered for the user, or null before it did. */
export function deviceOf(userId: string): string | null {
	return localStorage.getItem(deviceKey(userId));
}

/** Keeps the device this installation registered for the user, which every identify names from then on. */
export function keepDevice(userId: string, deviceId: string): void {
	localStorage.setItem(deviceKey(userId), deviceId);
}

/** The user the page last connected as (its READY's), whose device a new page's identify names before READY says. */
export function lastUser(): string | null {
	return localStorage.getItem(USER_KEY);
}

/** Keeps whose session the page connected as. Storage that refuses it only leaves the identify naming the user before. */
export function keepUser(userId: string): void {
	try {
		localStorage.setItem(USER_KEY, userId);
	} catch (error) {
		console.error("[e2e] Couldn't keep whose session this is:", error);
	}
}

/** The device the next identify names: the one kept for the user the page last connected as, or none. */
export function identifyDevice(): string | null {
	const user = lastUser();
	return user ? deviceOf(user) : null;
}
