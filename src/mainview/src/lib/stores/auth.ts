import { writable } from "svelte/store";
import { browser } from "$app/environment";
import { currentShell } from "$lib/platform";
import { followAccount } from "$lib/e2e/client";
import { keepTokenWithStorage } from "$lib/session";

const initialToken = browser ? localStorage.getItem("duvet_session_token") : null;

export const accessToken = writable<string | null>(initialToken);

// The main window writes the token the app's windows share; another window's copy follows it (lib/session.ts). And
// every page follows whose session storage holds, as another page's switch of accounts or sign-in makes it another
// account's (#612): read with the token, as the page loads.
if (browser) {
	const onStorage = (changed: (key: string | null) => void) =>
		window.addEventListener("storage", (event) => changed(event.key));
	keepTokenWithStorage(currentShell().window === "main", accessToken, localStorage, onStorage);
	followAccount(onStorage, () => window.location.reload());
}
