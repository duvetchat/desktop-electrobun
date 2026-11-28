// Settings' sections (#357): the app's own, kept through the redesign, in their order. The Settings window's page ends
// when the window closes, so the section viewed last is saved for the next one to open on.

export const SETTINGS_SECTIONS = [
	"account",
	"attachments",
	"security",
	"audio",
	"voice-video",
	"appearance",
	"language",
	"activity",
	"buckets",
	"developer",
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Where the section viewed last is kept, on this device. */
export const SETTINGS_SECTION_KEY = "duvet.settings.section.v1";

const isSection = (value: unknown): value is SettingsSection =>
	typeof value === "string" && (SETTINGS_SECTIONS as readonly string[]).includes(value);

/** The section a saved or a sent value names; My account for none, for anything else, and for Activity privacy
 * outside the desktop app, which alone has it. */
export function parseSettingsSection(raw: unknown, desktopApp: boolean): SettingsSection {
	if (!isSection(raw)) return "account";
	return raw === "activity" && !desktopApp ? "account" : raw;
}
