import { describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import { restartToUpdate, updateReady, watchUpdates, type UpdateLink } from "./app-update";

// A client of Bun's update RPC: what it already has, a way to announce a new one, and what the page sent.
function fakeLink(pending: string | null) {
	const handlers: ((message: { version: string }) => void)[] = [];
	const sent: string[] = [];
	const link: UpdateLink = {
		on: { updateReady: (handler) => void handlers.push(handler) },
		request: { pendingUpdate: async () => pending },
		send: { applyUpdate: () => void sent.push("applyUpdate") },
	};
	return { link, sent, announce: (version: string) => handlers.forEach((handler) => handler({ version })), handlers };
}

describe("Restart to update (#456)", () => {
	test("a version Bun had ready before the page loaded shows, and so does one announced after", async () => {
		updateReady.set(null);
		const { link, announce } = fakeLink("1.2.0");
		await watchUpdates(link);
		expect(get(updateReady)).toBe("1.2.0");
		announce("1.3.0");
		expect(get(updateReady)).toBe("1.3.0");
	});

	test("nothing ready shows nothing, and a client is followed once however many times it's asked", async () => {
		updateReady.set(null);
		const { link, handlers } = fakeLink(null);
		await watchUpdates(link);
		await watchUpdates(link);
		expect(get(updateReady)).toBeNull();
		expect(handlers).toHaveLength(1);
	});

	test("the web, with no Bun, shows nothing and sends nothing", async () => {
		updateReady.set(null);
		await watchUpdates(null);
		await restartToUpdate(null);
		expect(get(updateReady)).toBeNull();
	});

	test("Restart to update asks Bun to apply the version", async () => {
		const { link, sent } = fakeLink("1.2.0");
		await restartToUpdate(link);
		expect(sent).toEqual(["applyUpdate"]);
	});
});
