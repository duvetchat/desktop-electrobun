import { writable } from "svelte/store";
import { browser } from "$app/environment";
import { currentShell } from "$lib/platform";
import { keepTokenWithStorage } from "$lib/session";

const initialToken = browser ? localStorage.getItem("duvet_session_token") : null;

export const accessToken = writable<string | null>(initialToken);

// The main window writes the token the app's windows share; another window's copy follows it (lib/session.ts).
if (browser) {
	keepTokenWithStorage(currentShell().window === "main", accessToken, localStorage, (changed) =>
		window.addEventListener("storage", (event) => changed(event.key)),
	);
}
