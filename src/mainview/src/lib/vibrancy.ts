// The sidebar's glass on macOS (#374, docs/redesign/DESIGN-MAP.md §8.14). The desktop shows through the sidebar,
// blurred: a page can only blur what it draws itself, so the blur is the system's sidebar material, which Bun puts
// behind the main window's web view (src/bun/sidebar-material.ts) and says so in the page's shell (lib/platform.ts:
// vibrancy). The page's part is to leave that glass uncovered, and only there:
//   - while the app's shell is up, <html> wears .duvet-vibrant: the page's own backgrounds (html, body, the layout's
//     and the shell's) let go, and each part of the shell paints its own: the title strip and the chats the window's
//     background, the sidebar its tint alone (VIBRANT_SIDEBAR). Every other page, and the app while it connects,
//     stays as opaque as it was;
//   - the material follows the system's appearance by itself, and the page's theme can be picked apart from it
//     (lib/theme.ts): the page tells Bun which theme it wears, so the glass under a light sidebar is light.

/** The class <html> wears while the page shows the system's material behind its sidebar (app.css). */
export const VIBRANT_CLASS = "duvet-vibrant";
/** The light theme's class on <html> (lib/theme.svelte.ts, app.html). */
const LIGHT_CLASS = "duvet-light";

/** The sidebar's column over the material: its tint, the rings cut into it and its blur are the vibrant ones, for all
 * it holds (app.css's tokens). The blur is for the column shown over the chat, where the page itself is behind it. */
export const VIBRANT_SIDEBAR =
	"[--duvet-sb-bg:var(--duvet-sb-bg-vibrant)] [--duvet-sb-ring:var(--duvet-sb-ring-vibrant)] [--duvet-sb-filter:var(--duvet-sb-filter-vibrant)]";

/** Whether the page leaves the material uncovered: the window has it, and the app's shell, whose sidebar it is for,
 * is up. */
export function showsMaterial(shell: { vibrancy: boolean }, shellUp: boolean): boolean {
	return shell.vibrancy && shellUp;
}

/** What this needs of <html>: its classes. */
export interface ThemedRoot {
	classList: { contains(name: string): boolean };
}

/** The theme the page wears, read off <html>: what the user sees, whoever set it. */
export function wornTheme(root: ThemedRoot): "light" | "dark" {
	return root.classList.contains(LIGHT_CLASS) ? "light" : "dark";
}

/**
 * Tells `tell` the theme the page wears, now and each time it changes, once per change; returns what stops it.
 * `watch` calls back whenever the root's classes change (a MutationObserver on <html> in the app).
 */
export function followWornTheme(
	root: ThemedRoot,
	tell: (theme: "light" | "dark") => void,
	watch: (changed: () => void) => () => void,
): () => void {
	let told: "light" | "dark" | null = null;
	const say = () => {
		const theme = wornTheme(root);
		if (theme === told) return;
		told = theme;
		tell(theme);
	};
	say();
	return watch(say);
}

/** Watches <html>'s classes: the theme is one of them. */
export function watchClasses(root: Element): (changed: () => void) => () => void {
	return (changed) => {
		const observer = new MutationObserver(changed);
		observer.observe(root, { attributes: true, attributeFilter: ["class"] });
		return () => observer.disconnect();
	};
}
