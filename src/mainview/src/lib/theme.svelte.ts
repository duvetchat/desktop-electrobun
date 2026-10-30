import { THEME_KEY, parseThemePref, resolveTheme, type ThemePref } from "$lib/theme";

const LIGHT_QUERY = "(prefers-color-scheme: light)";

function readSaved(): ThemePref {
	try {
		return parseThemePref(localStorage.getItem(THEME_KEY));
	} catch {
		return "system";
	}
}

function systemPrefersLight(): boolean {
	return typeof window !== "undefined" && typeof window.matchMedia === "function"
		? window.matchMedia(LIGHT_QUERY).matches
		: false;
}

/** The theme picked in Appearance. The page's class follows it, and the system's appearance while it's System. */
export const theme: { pref: ThemePref } = $state({ pref: typeof window === "undefined" ? "system" : readSaved() });

/** The light theme is a class on <html> (.duvet-light in app.css), which app.html's script sets first. */
function apply() {
	if (typeof document === "undefined") return;
	document.documentElement.classList.toggle("duvet-light", resolveTheme(theme.pref, systemPrefersLight()) === "light");
}

export function setThemePref(pref: ThemePref) {
	theme.pref = pref;
	try {
		localStorage.setItem(THEME_KEY, pref);
	} catch {
		// no storage: the pick lasts until the app closes
	}
	apply();
}

/** Keeps the page's theme up with the system's appearance; returns what stops it. */
export function followSystemTheme(): () => void {
	apply();
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
	const query = window.matchMedia(LIGHT_QUERY);
	query.addEventListener("change", apply);
	return () => query.removeEventListener("change", apply);
}
