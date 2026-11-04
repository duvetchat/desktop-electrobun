import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import api, { formBytes, MAX_REQUEST_BYTES, TooLargeError } from "$lib/api/api";

// The requests the client sends, by URL; each answers as the API does for a message it took. Only while a test of this
// file runs: the next test, and the preload's check once the file is done, find the real fetch (#166).
const sent: string[] = [];
let fetched: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
beforeEach(() => {
	sent.length = 0;
	fetched = spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request) => {
		sent.push(input instanceof Request ? input.url : input.toString());
		return new Response(JSON.stringify({ id: "m" }), { status: 201, headers: { "Content-Type": "application/json" } });
	}) as typeof fetch);
});
afterEach(() => fetched.mockRestore());

const MiB = 1024 * 1024;
const file = (bytes: number, name = "big.bin", type = "") => new File([new Uint8Array(bytes)], name, { type });
function messageForm(...files: File[]) {
	const form = new FormData();
	form.append("content", "hello");
	form.append("nonce", "f3c1d7a2-5b6e-4c8d-9e0f-1a2b3c4d5e6f");
	for (const f of files) form.append("files", f);
	return form;
}

// The API answers a body over 32 MiB with a 413 before reading it, which Chromium never hands over HTTP/3: the send
// then never ended, with no error either (#182).
describe("a form over the API's 32 MiB", () => {
	test("is refused before anything is sent, with its size and the limit", async () => {
		const form = messageForm(file(33 * MiB));
		expect(formBytes(form)).toBeGreaterThan(MAX_REQUEST_BYTES);
		await expect(api.post("/api/rooms/r/messages", form)).rejects.toThrow("Files too large: 33.00 MB, 32 MB at most");
		await expect(api.patch("/api/users/@me", form)).rejects.toBeInstanceOf(TooLargeError);
		expect(sent).toEqual([]);
	});

	test("counts its files together", async () => {
		await expect(
			api.post("/api/rooms/r/messages", messageForm(file(17 * MiB), file(17 * MiB, "second.bin"))),
		).rejects.toThrow("Files too large: 34.00 MB, 32 MB at most");
		expect(sent).toEqual([]);
	});

	test("is refused by its whole body: files a little under 32 MiB with their fields around them are over", async () => {
		await expect(api.post("/api/rooms/r/messages", messageForm(file(MAX_REQUEST_BYTES - 100)))).rejects.toBeInstanceOf(
			TooLargeError,
		);
		expect(sent).toEqual([]);
	});

	test("isn't refused when it fits: it's sent as before", async () => {
		const res = await api.post("/api/rooms/r/messages", messageForm(file(31 * MiB)));
		expect(res.status).toBe(201);
		expect(sent).toEqual(["https://api.test/api/rooms/r/messages"]);
	});
});

describe("a form's size", () => {
	// Bun encodes a form as a browser does: the size counted is never under what goes out, and over it by a few hundred
	// bytes a field at most.
	test("is never under the multipart body sent for it", async () => {
		const quoted = new FormData();
		quoted.append('na"me', 'va"lue\r\nwith a line');
		quoted.append("files", file(1000, 'qu"oted\r\n名前.png', "image/png"));
		quoted.append("files", file(0, "", ""));
		const forms = [
			new FormData(),
			messageForm(),
			messageForm(file(5 * MiB)),
			messageForm(file(1), file(2, "ünïcödé.txt", "text/plain")),
			quoted,
		];
		for (const form of forms) {
			const body = await new Response(form).arrayBuffer();
			const fields = [...form.keys()].length;
			expect(formBytes(form)).toBeGreaterThanOrEqual(body.byteLength);
			expect(formBytes(form) - body.byteLength).toBeLessThan(512 * (fields + 1));
		}
	});
});
