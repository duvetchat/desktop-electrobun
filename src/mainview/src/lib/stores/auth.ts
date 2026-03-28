import { writable } from "svelte/store";
import { browser } from "$app/environment";

const initialToken = browser ? localStorage.getItem("duvet_session_token") : null;

export const accessToken = writable<string | null>(initialToken);

if (browser) {
	accessToken.subscribe((value) => {
		if (value) {
			localStorage.setItem("duvet_session_token", value);
		} else {
			localStorage.removeItem("duvet_session_token");
		}
	});
}
