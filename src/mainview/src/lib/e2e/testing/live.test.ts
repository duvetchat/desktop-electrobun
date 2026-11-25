// The live tests (PLAN-E2E-CLIENTES.md, Task 11): the app's own code against a real API and gateway, which the API's
// suite clients-desktop starts and names: E2E_LIVE_API and E2E_LIVE_WS, its seeded accounts (E2E_LIVE_ACCOUNTS, JSON:
// each one's id and email) and their password (E2E_LIVE_PASSWORD). Outside that suite, as in the app's own run, they're
// skipped. Each engine task adds its cases here, on the core the desktop carries (native/core).
import { describe, expect, test } from "bun:test";
import api from "$lib/api/api";
import { logIn } from "$lib/api/auth";
import { e2eApi } from "$lib/api/e2e";
import { identifyData } from "$lib/api/ws/identify";
import { getWSHostURL } from "$lib/common/common";

interface Account {
	id: string;
	email: string;
}

const env = process.env;
const accounts: unknown = JSON.parse(env.E2E_LIVE_ACCOUNTS ?? "[]");
const live = env.E2E_LIVE_API
	? { accounts: Array.isArray(accounts) ? accounts : [], password: env.E2E_LIVE_PASSWORD ?? "" }
	: null;
// The app reaches the API and the gateway at VITE_API_URL and VITE_WS_URL, which the preload points nowhere.
if (live) Object.assign(globalThis, { VITE_API_URL: env.E2E_LIVE_API, VITE_WS_URL: env.E2E_LIVE_WS ?? "" });

/** The stack's nth seeded account. */
function account(n: number): Account {
	const found: unknown = live?.accounts[n];
	if (typeof found === "object" && found !== null && "id" in found && "email" in found) {
		const { id, email } = found;
		if (typeof id === "string" && typeof email === "string") return { id, email };
	}
	throw new Error(`the stack names no account ${n}`);
}

/** Identifies on the gateway with the session's access token, as the app does, and gives READY's data. */
function ready(token: string): Promise<{ user: { id: string } }> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(`${getWSHostURL()}/gateway?token=${encodeURIComponent(token)}`);
		const end = (settle: () => void) => {
			clearTimeout(timer);
			socket.close();
			settle();
		};
		const timer = setTimeout(() => end(() => reject(new Error("no READY within 15 s"))), 15_000);
		socket.onopen = () => socket.send(JSON.stringify({ type: "identify", data: identifyData(token, null) }));
		socket.onmessage = (event) => {
			const message = JSON.parse(String(event.data));
			if (message.event === "payload" && message.d?.type === "READY") end(() => resolve(message.d.data));
			else if (message.event === "close-with-reason") {
				end(() => reject(new Error(`the gateway closed with ${message.code}: ${message.reason}`)));
			}
		};
		socket.onerror = () => end(() => reject(new Error("the gateway's socket failed")));
	});
}

describe.skipIf(!live)("live, against the API's stack", () => {
	test("the client reaches the stack", async () => {
		if (!live) throw new Error("no stack");
		const alice = account(0);
		const session = await logIn({ email: alice.email, password: live.password });
		expect((await api.get<{ id: string }>("/api/users/@me")).data.id).toBe(alice.id);
		// A route of encryption's, which takes only a client whose X-Duvet-Client meets its platform's minimum.
		expect(await e2eApi().devices()).toEqual([]);
		expect((await ready(session.token)).user.id).toBe(alice.id);
	}, 30_000);
});
