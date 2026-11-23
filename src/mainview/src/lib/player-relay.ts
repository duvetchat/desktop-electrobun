// Where the YouTube relay listens, as Bun says it (src/bun/player-relay.ts): the desktop app's pages are views://, which
// sends no Referer, and YouTube's player refuses a frame without one (error 153). Asked once; null until it answers, and
// for good if it doesn't (the player is then framed as it was). Only a loopback origin is taken, whatever is answered.
import { writable } from "svelte/store";
import { getElectrobunRpc } from "$lib/electrobun-rpc";

const LOOPBACK = /^http:\/\/127\.0\.0\.1:\d{1,5}$/;

export const relayOrigin = writable<string | null>(null);

let asked = false;
export function loadRelayOrigin(): void {
	if (asked) return;
	asked = true;
	void getElectrobunRpc()
		.then((rpc) => rpc?.request.playerRelay())
		.then((origin) => relayOrigin.set(typeof origin === "string" && LOOPBACK.test(origin) ? origin : null))
		.catch(() => {});
}
