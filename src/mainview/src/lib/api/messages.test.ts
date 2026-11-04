import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { MAX_REQUEST_BYTES } from "$lib/api/api";
import { messageTooLarge, sendMessage } from "$lib/api/messages";
import { MessageReferenceType } from "$lib/types";

// The requests the client sends, by URL, through fetch or XMLHttpRequest (a form's: Bun has none, this one stands in for
// the webview's); each answers as the API does for a message it took. Only while a test of this file runs (#166).
const sent: string[] = [];
class FakeXHR {
	url = "";
	status = 0;
	statusText = "";
	response: ArrayBuffer | null = null;
	upload = { onprogress: null, onload: null };
	onload: (() => void) | null = null;
	open(_method: string, url: string) {
		this.url = url;
	}
	setRequestHeader() {}
	getAllResponseHeaders() {
		return "content-type: application/json\r\n";
	}
	send() {
		sent.push(this.url);
		queueMicrotask(() => {
			this.status = 201;
			this.response = new TextEncoder().encode(JSON.stringify({ id: "m" })).buffer;
			this.onload?.();
		});
	}
	abort() {}
}
let fetched: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
beforeEach(() => {
	sent.length = 0;
	Object.assign(globalThis, { XMLHttpRequest: FakeXHR });
	fetched = spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request) => {
		sent.push(input instanceof Request ? input.url : input.toString());
		return new Response(JSON.stringify({ id: "m" }), { status: 201, headers: { "Content-Type": "application/json" } });
	}) as typeof fetch);
});
afterEach(() => {
	fetched.mockRestore();
	delete (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
});

const MiB = 1024 * 1024;
const file = (bytes: number, name = "big.bin") => new File([new Uint8Array(bytes)], name);

// The message box asks before it sends: a message the API would refuse for its size stays in the box with this (#182).
describe("a message too large for the API", () => {
	test("is said so, with its size and the limit per message", () => {
		expect(messageTooLarge("hi", [file(33 * MiB)])).toBe("Files too large: 33.00 MB, 32 MB at most per message");
	});

	test("is its files together", () => {
		expect(messageTooLarge("", [file(17 * MiB), file(17 * MiB, "second.bin")])).toBe(
			"Files too large: 34.00 MB, 32 MB at most per message",
		);
	});

	test("isn't one that fits, nor one without files", () => {
		expect(messageTooLarge("hi", [file(31 * MiB)])).toBeNull();
		expect(messageTooLarge("x".repeat(4000), [])).toBeNull();
	});

	// What the box lets through goes out whole, its reply and mentions with it: the request isn't refused after the
	// message shows as sent.
	test("is one the box refuses, and only those: what it lets through is sent", async () => {
		const reply = {
			type: MessageReferenceType.Reply,
			message_id: "0192f3a1-0000-7000-8000-000000000001",
			room_id: "0192f3a1-0000-7000-8000-000000000002",
		};
		const fits = file(MAX_REQUEST_BYTES - 8 * 1024);
		expect(messageTooLarge("a reply", [fits])).toBeNull();
		await sendMessage("r", "a reply", "f3c1d7a2-5b6e-4c8d-9e0f-1a2b3c4d5e6f", reply, [fits], undefined, undefined, {
			replied_user: true,
		});
		expect(sent).toEqual(["https://api.test/api/rooms/r/messages"]);
		expect(messageTooLarge("a reply", [file(MAX_REQUEST_BYTES - 1024)])).not.toBeNull();
	});
});
