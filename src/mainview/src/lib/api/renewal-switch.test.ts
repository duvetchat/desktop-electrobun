import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { activateAccount, type StoredAccount } from "$lib/accounts";
import { followAccount, keepUser } from "$lib/e2e/client";

// #620's review, M3: a renewal that went out before another page switched accounts, and is answered after, wrote the
// answer's tokens, the old account's, over the switched-to account's session in storage. Each case loads api.ts anew
// (its query), as a renewal that's never answered keeps that module's single renewal for good.

const ANA = "0193a4b2-0000-7000-8000-0000000000a1";
const BEN = "0193a4b2-0000-7000-8000-0000000000b1";
const ben: StoredAccount = {
	id: BEN,
	name: "Ben",
	username: "ben",
	avatar: null,
	accessToken: "access-b",
	refreshToken: "session-b",
};

afterEach(() => localStorage.clear());

/** api.ts loaded anew, by a query of its own (a specifier TypeScript doesn't read). */
const freshApi = (query: string): Promise<typeof import("./api")> => import(`./api.ts?${query}`);

/** A page signed in as Ana, following storage's account, with its renewal out until `answer`. */
async function renewalOut(api: Promise<typeof import("./api")>) {
	localStorage.setItem("duvet_session_token", "access-a");
	localStorage.setItem("duvet_refresh_token", "session-a");
	keepUser(ANA);
	let heard: (key: string | null) => void = () => {};
	let reloads = 0;
	followAccount(
		(changed) => (heard = changed),
		() => reloads++,
	);
	const { refreshSession } = await api;
	let answer: (response: Response) => void = () => {};
	const fetched = spyOn(globalThis, "fetch").mockImplementation(
		(() => new Promise<Response>((resolve) => (answer = resolve))) as typeof fetch,
	);
	void refreshSession();
	await Bun.sleep(0);
	expect(fetched).toHaveBeenCalledTimes(1);
	// Another tab's Settings switches to Ben.
	activateAccount(ben);
	heard("duvet.e2e.user");
	return { answer: (response: Response) => answer(response), fetched, reloads: () => reloads };
}

describe("a renewal out as another page switches accounts", () => {
	test("writes nothing of its answer over the switched-to account's session", async () => {
		const out = await renewalOut(freshApi("answered"));
		try {
			out.answer(Response.json({ token: "access-a2", session_token: "session-a2" }));
			await Bun.sleep(0);
			expect(localStorage.getItem("duvet_session_token")).toBe("access-b");
			expect(localStorage.getItem("duvet_refresh_token")).toBe("session-b");
			expect(out.reloads()).toBe(1);
		} finally {
			out.fetched.mockRestore();
		}
	});

	test("refused, removes nothing of the switched-to account's session", async () => {
		const out = await renewalOut(freshApi("refused"));
		try {
			out.answer(Response.json({ error: "unauthorized" }, { status: 401 }));
			await Bun.sleep(0);
			expect(localStorage.getItem("duvet_session_token")).toBe("access-b");
			expect(localStorage.getItem("duvet_refresh_token")).toBe("session-b");
			expect(out.fetched).toHaveBeenCalledTimes(1);
		} finally {
			out.fetched.mockRestore();
		}
	});
});
