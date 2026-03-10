import { SvelteSet } from "svelte/reactivity";
import { writable } from "svelte/store";

import type { GatewaySpace, GatewayUser, Message } from "$lib/types";

const SESSION_KEY = "duvet_session_token";

function createUserSession() {
	const storage = typeof localStorage !== "undefined" ? localStorage : null;
	let token = $state<string | null>(storage?.getItem(SESSION_KEY) ?? null);

	return {
		get token() {
			return token;
		},
		set token(value: string | null) {
			token = value;
			if (!storage) {
				return;
			}
			if (value === null) {
				storage.removeItem(SESSION_KEY);
			} else {
				storage.setItem(SESSION_KEY, value);
			}
		},
	};
}

export const userSession = createUserSession();

export const gatewaySpaces = writable<GatewaySpace[]>([]);
export const currentUser = writable<GatewayUser | null>(null);
export const wsSessionToken = writable<string | null>(null);
export const channelMessages = writable<Record<string, Message[]>>({});
export const speakingUsers = writable<SvelteSet<string>>(new SvelteSet());

export const isMuted = writable<boolean>(false);
export const isDeafened = writable<boolean>(false);
export const activeVoiceRoomId = writable<string | null>(null);

let initialMicId = "";
if (typeof localStorage !== "undefined") {
	initialMicId = localStorage.getItem("duvet_mic_id") || "";
}
export const selectedMicId = writable<string>(initialMicId);

if (typeof localStorage !== "undefined") {
	selectedMicId.subscribe((value) => {
		if (value) {
			localStorage.setItem("duvet_mic_id", value);
		}
	});
}
