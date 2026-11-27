// What the app is to the API and the gateway (PLAN-E2E-API.md, its formats and events; PLAN-E2E-CLIENTES.md, Task 10):
// the client X-Duvet-Client and an identify's client name, which the API holds to E2E_MIN_CLIENTS, and the device of this
// installation an identify names, which the page keeps by user so it identifies before its core opens (Ruling 30).
// Neither is a secret: the API knows both.
import { readShellInputs, shellFor, type Os, type ShellInputs } from "$lib/platform";

const PLATFORMS = { windows: "desktop-windows", mac: "desktop-macos", linux: "desktop-linux", web: "web" } as const;

/**
 * <platform>/<version>, as the API reads it: the desktop app by its system (Bun's word, else its user agent's), or the
 * web, never the dev server's preview of another system; the version is the root package.json's (VITE_APP_VERSION).
 */
export function duvetClient(inputs: ShellInputs = readShellInputs()): string {
	return `${PLATFORMS[shellFor({ ...inputs, preview: null }).chrome]}/${VITE_APP_VERSION}`;
}

/**
 * The desktop app on Linux or macOS, whose database key is in a keyring a person can lock (the Secret Service, the
 * Keychain), so one that didn't open is said, with Try again (PLAN-E2E-PLATAFORMAS.md, Task 4). Windows' Credential
 * Manager opens with the session, and the web keeps its own key.
 */
export function lockableKeyring(inputs: ShellInputs = readShellInputs()): boolean {
	const { chrome } = shellFor({ ...inputs, preview: null });
	return chrome === "linux" || chrome === "mac";
}

const SYSTEMS: Record<Os, string> = { windows: "Windows", mac: "macOS", linux: "Linux", ios: "iOS", other: "" };
// The browser by its user agent's own mark, the ones built on Chrome's before Chrome's.
const BROWSERS: [RegExp, string][] = [
	[/Edg\//, "Edge"],
	[/OPR\//, "Opera"],
	[/Firefox\/|FxiOS\//, "Firefox"],
	[/Chrome\/|CriOS\//, "Chrome"],
	[/Safari\//, "Safari"],
];

/**
 * The name this installation registers its device with, which the user's other devices show (PLAN-E2E-CLIENTES.md,
 * «Convenciones entre clientes»; Ruling 27): the app's for its system, or the browser and its system, never longer than
 * the API's 64 characters.
 */
export function deviceName(inputs: ShellInputs = readShellInputs()): string {
	const { chrome, os } = shellFor({ ...inputs, preview: null });
	if (chrome !== "web") return `Duvet for ${SYSTEMS[chrome]}`;
	const agent = inputs.userAgent;
	const browser = BROWSERS.find(([mark]) => mark.test(agent))?.[1] ?? "Browser";
	const system = /Android/.test(agent) ? "Android" : /CrOS/.test(agent) ? "ChromeOS" : SYSTEMS[os];
	return system ? `${browser} on ${system}` : browser;
}

const USER_KEY = "duvet.e2e.user";
const deviceKey = (userId: string) => `duvet.e2e.${userId}.device`;

/** The device this installation registered for the user, or null before it did. */
export function deviceOf(userId: string): string | null {
	return localStorage.getItem(deviceKey(userId));
}

/** Keeps the device this installation registered for the user, which every identify names from then on. Storage that
 * refuses it is logged: the identify then names none, and the engine goes on. */
export function keepDevice(userId: string, deviceId: string): void {
	try {
		localStorage.setItem(deviceKey(userId), deviceId);
	} catch (error) {
		console.error("[e2e] Couldn't keep this installation's device:", error);
	}
}

/** Forgets the device this installation registered for the user: its data went, and no identify names it again. */
export function forgetDevice(userId: string): void {
	localStorage.removeItem(deviceKey(userId));
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

/** Forgets whose session the page had: a sign-in may be another account's, whose identify mustn't name the device of
 * the one before. READY tells whose it is. */
export function forgetUser(): void {
	localStorage.removeItem(USER_KEY);
}

/** The device the next identify names: the one kept for the user the page last connected as, or none. */
export function identifyDevice(): string | null {
	const user = lastUser();
	return user ? deviceOf(user) : null;
}
