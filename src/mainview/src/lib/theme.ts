/** The theme the user picked, saved on this device. app.html's inline script reads it too, before anything paints. */
export const THEME_KEY = "duvet.theme.v1";

/** System follows the system's light or dark appearance; light and dark keep to theirs. */
export type ThemePref = "system" | "light" | "dark";

export function parseThemePref(raw: string | null): ThemePref {
	return raw === "light" || raw === "dark" ? raw : "system";
}

/**
 * The theme a pick comes to. With System, the system's: light when it says light, dark when it says dark or says
 * nothing (no prefers-color-scheme), as the mobile app has it.
 */
export function resolveTheme(pref: ThemePref, systemPrefersLight: boolean): "light" | "dark" {
	if (pref !== "system") return pref;
	return systemPrefersLight ? "light" : "dark";
}
