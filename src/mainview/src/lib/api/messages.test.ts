import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { formBytes, MAX_REQUEST_BYTES } from "$lib/api/api";
import { messageTooLarge, sendMessage } from "$lib/api/messages";
import { MessageReferenceType } from "$lib/types";

// The requests the client sends, by URL, through fetch or XMLHttpRequest (a form's: Bun has none, this one stands in for
// the webview's); each answers as the API does for a message it took. Only while a test of this file runs (#166).
const sent: string[] = [];
const bodies: FormData[] = [];
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
	send(body: FormData) {
		sent.push(this.url);
		bodies.push(body);
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
	bodies.length = 0;
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
	test("is said so, with its size and how much of it is over the limit", () => {
		expect(messageTooLarge("hi", [file(33 * MiB)])).toBe("Message too large: 33.00 MB, 1.00 MB over the 32 MB limit");
	});

	test("is its files together", () => {
		expect(messageTooLarge("", [file(17 * MiB), file(17 * MiB, "second.bin")])).toBe(
			"Message too large: 34.00 MB, 2.00 MB over the 32 MB limit",
		);
	});

	// A conversation's files go up sealed, each part of 64 KiB with its tag, beside a ciphertext of 32 KiB at most
	// (PLAN-E2E-CLIENTES.md, «Adjuntos»): the cap is the sealed size's.
	test("is a conversation's by its files' sealed size, beside its ciphertext", () => {
		const near = 32 * MiB - 20 * 1024;
		expect(messageTooLarge("hi", [file(near)])).toBeNull();
		expect(messageTooLarge("hi", [file(near)], true)).toStartWith("Message too large:");
		expect(messageTooLarge("hi", [file(31 * MiB)], true)).toBeNull();
		expect(messageTooLarge("x".repeat(4000), [], true)).toBeNull();
	});

	// Each file is held to the cap of where it goes, sealed: 20 MiB in Duvet's storage, or the bucket's own (task 18's
	// review, Missing 1). The API's 413 stays the last word.
	test("is a conversation's file past the cap of where it goes, by its sealed size", () => {
		const cap = 20 * MiB;
		const over = messageTooLarge("hi", [file(1000), file(cap, "video.mp4")], true, cap);
		expect(over).toStartWith("File too large: 20.00 MB,");
		expect(over).toEndWith("over the 20 MB limit");
		// Its bytes fit, but not once sealed.
		expect(messageTooLarge("hi", [file(cap - 4096)], true, cap)).toStartWith("File too large:");
		expect(messageTooLarge("hi", [file(cap - 6 * 1024)], true, cap)).toBeNull();
		// A room's file is the API's to check, and so is one where no cap is known (a bucket without one).
		expect(messageTooLarge("hi", [file(cap)], false, cap)).toBeNull();
		expect(messageTooLarge("hi", [file(cap)], true, null)).toBeNull();
	});

	test("isn't one that fits, nor one without files", () => {
		expect(messageTooLarge("hi", [file(31 * MiB)])).toBeNull();
		expect(messageTooLarge("x".repeat(4000), [])).toBeNull();
	});

	// What the box lets through goes out whole, its reply and mentions with it, and within the API's 32 MiB on the wire:
	// the largest file it takes, also beside a text of 3000 line breaks, which a browser sends as CRLF (#182). A byte
	// more is refused, saying how much is over: its size rounds to the limit's (#182's review).
	test("is one the box refuses, and only those: what it lets through reaches the API within its limit", async () => {
		const reply = {
			type: MessageReferenceType.Reply,
			message_id: "0192f3a1-0000-7000-8000-000000000001",
			room_id: "0192f3a1-0000-7000-8000-000000000002",
		};
		for (const content of ["a reply", "line\n".repeat(3000).trim()]) {
			// The largest file the box takes: the form's count without it, and the 2 KiB kept for the other fields.
			const without = new FormData();
			without.append("content", content);
			without.append("files", file(0, "photo.jpg"));
			const largest = MAX_REQUEST_BYTES - 2048 - formBytes(without);
			expect(messageTooLarge(content, [file(largest + 1, "photo.jpg")])).toBe(
				"Message too large: 32.00 MB, 1 B over the 32 MB limit",
			);
			const fits = file(largest, "photo.jpg");
			expect(messageTooLarge(content, [fits])).toBeNull();
			bodies.length = 0;
			await sendMessage("r", content, "f3c1d7a2-5b6e-4c8d-9e0f-1a2b3c4d5e6f", reply, [fits], undefined, undefined, {
				replied_user: true,
			});
			expect(sent.at(-1)).toBe("https://api.test/api/rooms/r/messages");
			const onTheWire = (await new Response(bodies[0]).arrayBuffer()).byteLength;
			expect(onTheWire).toBeLessThanOrEqual(MAX_REQUEST_BYTES);
		}
	});
});
