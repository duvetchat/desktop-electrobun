import { expect, mock, test } from "bun:test";
import { get } from "svelte/store";

// In the browser, the session store starts with the token the browser kept, and keeps the next one there. It reads
// SvelteKit's environment as it loads: this file loads it afresh, under its own mock, whatever the files before it
// loaded (#176).
mock.module("$app/environment", () => ({ browser: true }));
// A browser's window, where the store hears the other pages' writes (lib/session.ts, and #612's account).
Object.assign(globalThis, { window: { addEventListener: () => {} } });
localStorage.setItem("duvet_session_token", "stored-token");
const { accessToken } = await import("$lib/stores/auth");

test("the session store starts with the token the browser kept", () => {
	expect(get(accessToken)).toBe("stored-token");
});

test("it keeps a new token in the browser's storage, and forgets it there", () => {
	accessToken.set("new-token");
	expect(localStorage.getItem("duvet_session_token")).toBe("new-token");
	accessToken.set(null);
	expect(localStorage.getItem("duvet_session_token")).toBeNull();
});
