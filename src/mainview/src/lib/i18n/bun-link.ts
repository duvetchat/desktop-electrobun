// The app's language and the Bun process's, in the desktop app (#464). Bun has words of its own, the menu bar and the
// windows' titles (src/bun/i18n.ts), which the main window's page tells it the language of; and Bun reads the system's
// languages, of which the web view tells the page only part, for "Match system" (lib/i18n.ts: setSystemLanguages).
// lib/i18n.ts never talks to Bun itself: the root layout links them through here. Outside the desktop app there's no
// Bun, and none of this does anything.
import { getElectrobunRpc, type AppRPCClient } from "$lib/electrobun-rpc";
import { setSystemLanguages } from "$lib/i18n";

type Rpc = () => Promise<AppRPCClient | null>;

/** Tells Bun the language the main window's page is in: the root layout's, as it starts and each time it changes. */
export function tellBunLanguage(locale: string, rpc: Rpc = getElectrobunRpc): void {
	void rpc()
		.then((client) => client?.send.appLanguage({ locale }))
		.catch((err: unknown) => console.warn("[i18n] Bun wasn't told the app's language:", err));
}

/**
 * Asks Bun the system's languages once, before the page first draws (the root layout's load, routes/+layout.ts): then
 * "Match system", and the order of dates and numbers, are Bun's from the first frame, not the web view's until the page
 * has mounted. Waits `waitMs` at most, so a Bun slow to answer holds the page no longer: its answer is left, and the
 * page has the web view's until followSystemLanguages asks again. Never throws.
 */
export async function primeSystemLanguages(rpc: Rpc = getElectrobunRpc, waitMs = 250): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), waitMs)));
	try {
		const languages = await Promise.race([rpc().then((client) => client?.request.systemLanguages()), late]);
		if (Array.isArray(languages)) await setSystemLanguages(languages);
	} catch (err) {
		console.warn("[i18n] Bun didn't say the system's languages before the page drew:", err);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Keeps "Match system" with the system's languages as Bun reads them: asked as the page starts, and again when the web
 * view says the system's changed (languagechange). Every window's page does, each having its own language. Returns what
 * stops it.
 */
export function followSystemLanguages(
	rpc: Rpc = getElectrobunRpc,
	target: EventTarget | null = typeof window === "undefined" ? null : window,
): () => void {
	let asked = 0;
	let stopped = false;
	const ask = () => {
		const turn = ++asked;
		void rpc()
			.then((client) => client?.request.systemLanguages())
			.then((languages) => {
				// The latest ask's answer is the one that counts.
				if (stopped || turn !== asked || !Array.isArray(languages)) return;
				return setSystemLanguages(languages);
			})
			.catch((err: unknown) => console.warn("[i18n] Bun didn't say the system's languages:", err));
	};
	ask();
	target?.addEventListener("languagechange", ask);
	return () => {
		stopped = true;
		target?.removeEventListener("languagechange", ask);
	};
}
