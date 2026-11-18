// The Settings windows' names and arguments (#357): Settings and a Space's settings each open in a window of their
// own in the desktop app (src/bun/settings-windows.ts makes them). What the pages and the main window say to each
// other goes by these names; the values themselves are lib/window-sync.ts's.
import { parseSettingsSection, type SettingsSection } from "$lib/settings-sections";

/** The channel of the commands a Settings window sends the main one. */
export const SETTINGS_CHANNEL = "settings";
/** The channel a shared value is published on. */
export const syncChannel = (key: string) => `sync:${key}`;
/** The key a channel publishes, or null for another channel's. */
export const syncKey = (channel: string) => (channel.startsWith("sync:") ? channel.slice(5) : null);
/** The channel that tells an open window which section to show: its value is { window, spaceId, section }. */
export const GOTO_CHANNEL = "settings:goto";

/** A Space's values, by its ID. */
export const spaceKey = (spaceId: string) => `space:${spaceId}`;
export const bansKey = (spaceId: string) => `bans:${spaceId}`;

/** What the main window asks Bun to open (bun.messages.openAppWindow). */
export type OpenAppWindow =
	| { window: "settings"; section?: string }
	| { window: "space-settings"; spaceId: string; name: string; section?: string };

/** What Bun hands a Settings window's page before its scripts run (window.__duvetSettings). */
export interface SettingsWindowArgs {
	/** The Space whose settings this window shows; null in Settings' own window. */
	spaceId: string | null;
	/** The section to open on, when whoever opened the window asked for one. */
	section: string | null;
}

/** window.__duvetSettings as Bun wrote it; no Space and no section for anything else. */
export function parseSettingsArgs(value: unknown): SettingsWindowArgs {
	const fields: Record<string, unknown> = typeof value === "object" && value !== null ? { ...value } : {};
	return {
		spaceId: typeof fields.spaceId === "string" && fields.spaceId ? fields.spaceId : null,
		section: typeof fields.section === "string" && fields.section ? fields.section : null,
	};
}

/** The section Settings' window opens on: the one asked for, or undefined to open on the one viewed last. */
export function askedSection(args: SettingsWindowArgs, desktopApp = true): SettingsSection | undefined {
	return args.section === null ? undefined : parseSettingsSection(args.section, desktopApp);
}

/** Whether a "go to" is for this window, and the section it names. */
export function gotoFor(value: unknown, spaceId: string | null): string | null {
	const fields: Record<string, unknown> = typeof value === "object" && value !== null ? { ...value } : {};
	const forSpace = typeof fields.spaceId === "string" ? fields.spaceId : null;
	if (forSpace !== spaceId) return null;
	return typeof fields.section === "string" && fields.section ? fields.section : null;
}

/** A shared value's write, as a window's command carries it: its key and the value, or null for anything else. */
export function parseWrite(args: unknown): { key: string; value: unknown } | null {
	if (typeof args !== "object" || args === null || !("key" in args) || typeof args.key !== "string") return null;
	return { key: args.key, value: "value" in args ? args.value : null };
}

declare global {
	// Set by Bun's preload in a Settings window (src/bun/settings-windows.ts); absent anywhere else.
	var __duvetSettings: unknown;
}
