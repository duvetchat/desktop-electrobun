import { describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import { DOWNLOAD_PAGE, restarting, takeUpdate, updateOffer, watchUpdates, type UpdateLink } from "./app-update";
import type { UpdateOffer } from "./electrobun-rpc";

const RESTART: UpdateOffer = { version: "1.2.0", how: "restart" };
const DOWNLOAD: UpdateOffer = { version: "1.2.0", how: "download" };

// A client of Bun's update RPC: what it already offers, a way to announce a new offer, and what the page sent.
function fakeLink(pending: UpdateOffer | null) {
	const handlers: ((offer: UpdateOffer | null) => void)[] = [];
	const sent: string[] = [];
	const link: UpdateLink = {
		on: { updateReady: (handler) => void handlers.push(handler) },
		request: { pendingUpdate: async () => pending },
		send: {
			applyUpdate: () => void sent.push("applyUpdate"),
			openExternal: ({ url }) => void sent.push(`openExternal ${url}`),
		},
	};
	return {
		link,
		sent,
		handlers,
		announce: (offer: UpdateOffer | null) => handlers.forEach((handler) => handler(offer)),
	};
}

function reset() {
	updateOffer.set(null);
	restarting.set(false);
}

describe("Restart to update (#456)", () => {
	test("an offer Bun had before the page loaded shows, one announced after replaces it, and null takes it away", async () => {
		reset();
		const { link, announce } = fakeLink(RESTART);
		await watchUpdates(link);
		expect(get(updateOffer)).toEqual(RESTART);
		announce({ version: "1.3.0", how: "restart" });
		expect(get(updateOffer)).toEqual({ version: "1.3.0", how: "restart" });
		announce(null);
		expect(get(updateOffer)).toBeNull();
	});

	test("nothing offered shows nothing, and a client is followed once however many times it's asked", async () => {
		reset();
		const { link, handlers } = fakeLink(null);
		await watchUpdates(link);
		await watchUpdates(link);
		expect(get(updateOffer)).toBeNull();
		expect(handlers).toHaveLength(1);
	});

	test("the web, with no Bun, shows nothing and sends nothing", async () => {
		reset();
		await watchUpdates(null);
		await takeUpdate(null);
		expect(get(updateOffer)).toBeNull();
		expect(get(restarting)).toBe(false);
	});

	test("Restart to update asks Bun once, and waits on its word: an offer again means it can be tried again", async () => {
		reset();
		const { link, sent, announce } = fakeLink(RESTART);
		await watchUpdates(link);
		await takeUpdate(link);
		await takeUpdate(link);
		expect(sent).toEqual(["applyUpdate"]);
		expect(get(restarting)).toBe(true);
		announce(RESTART);
		expect(get(restarting)).toBe(false);
		await takeUpdate(link);
		expect(sent).toEqual(["applyUpdate", "applyUpdate"]);
	});

	test("Download update opens duvet.chat/download in the browser", async () => {
		reset();
		const { link, sent } = fakeLink(DOWNLOAD);
		await watchUpdates(link);
		await takeUpdate(link);
		expect(sent).toEqual([`openExternal ${DOWNLOAD_PAGE}`]);
		expect(DOWNLOAD_PAGE).toBe("https://duvet.chat/download");
		expect(get(restarting)).toBe(false);
	});
});
