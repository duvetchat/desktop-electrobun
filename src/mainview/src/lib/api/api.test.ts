import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import api, {
	FetchError,
	formBytes,
	getApiError,
	MAX_REQUEST_BYTES,
	TooLargeError,
	UploadTimeoutError,
	uploadLimits,
} from "$lib/api/api";

// The requests the client sends, by URL, through fetch or XMLHttpRequest; each answers as the API does for a message it
// took, unless a test says otherwise. Only while a test of this file runs: the next test, and the preload's check once
// the file is done, find the real fetch (#166). Bun has no XMLHttpRequest: the fake stands in for the webview's.
const sent: string[] = [];

class FakeXHR {
	static last: FakeXHR | null = null;
	// What a test has the upload do once it's sent; by default, the API takes it.
	static onSend: (xhr: FakeXHR) => void = (xhr) => queueMicrotask(() => xhr.respond(201, { id: "m" }));
	method = "";
	url = "";
	headers: Record<string, string> = {};
	withCredentials = false;
	responseType = "";
	body: unknown = null;
	aborted = false;
	status = 0;
	statusText = "";
	response: ArrayBuffer | null = null;
	responseHeaders = "";
	upload: { onprogress: (() => void) | null; onload: (() => void) | null } = { onprogress: null, onload: null };
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	onabort: (() => void) | null = null;
	constructor() {
		FakeXHR.last = this;
	}
	open(method: string, url: string) {
		this.method = method;
		this.url = url;
	}
	setRequestHeader(name: string, value: string) {
		this.headers[name] = value;
	}
	send(body: unknown) {
		this.body = body;
		sent.push(this.url);
		FakeXHR.onSend(this);
	}
	abort() {
		this.aborted = true;
		this.onabort?.();
	}
	getAllResponseHeaders() {
		return this.responseHeaders;
	}
	respond(status: number, json: unknown) {
		this.upload.onload?.();
		this.status = status;
		this.responseHeaders = "content-type: application/json; charset=utf-8\r\nx-ratelimit-remaining: 4\r\n";
		this.response = new TextEncoder().encode(JSON.stringify(json)).buffer;
		this.onload?.();
	}
}

let fetched: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
const limits = { ...uploadLimits };
beforeEach(() => {
	sent.length = 0;
	FakeXHR.last = null;
	FakeXHR.onSend = (xhr) => queueMicrotask(() => xhr.respond(201, { id: "m" }));
	Object.assign(globalThis, { XMLHttpRequest: FakeXHR });
	Object.assign(uploadLimits, limits);
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

// An upload whose request never ends left its message pending for good, with no error (#182): a form goes up through
// XMLHttpRequest, whose upload progress tells a stalled upload from a slow one, and one that stalls or gets no answer
// is aborted and fails, so the app shows it as failed, to retry or dismiss.
describe("an upload", () => {
	test("goes up through XMLHttpRequest with the session's headers and cookies, and reads its answer as fetch's", async () => {
		localStorage.setItem("duvet_session_token", "access-1");
		localStorage.setItem("duvet_refresh_token", "session-1");
		const form = messageForm(file(1024));
		const res = await api.post("/api/rooms/r/messages", form);
		expect(res).toMatchObject({ status: 201, data: { id: "m" } });
		expect(res.headers.get("x-ratelimit-remaining")).toBe("4");
		const xhr = FakeXHR.last!;
		expect(xhr).toMatchObject({ method: "POST", url: "https://api.test/api/rooms/r/messages", withCredentials: true });
		expect(xhr.headers).toMatchObject({ authorization: "Bearer access-1", "x-session-token": "session-1" });
		expect(xhr.headers["content-type"]).toBeUndefined();
		expect(xhr.body).toBe(form);
		expect(fetched).not.toHaveBeenCalled();
	});

	test("refused by the API fails with its error, as a fetch's does", async () => {
		FakeXHR.onSend = (xhr) =>
			queueMicrotask(() => xhr.respond(413, { error: "failed to upload attachment: file is too large" }));
		const failure = await api.post("/api/rooms/r/messages", messageForm(file(1024))).catch((e: unknown) => e);
		if (!(failure instanceof FetchError)) throw new Error(`not the API's error: ${String(failure)}`);
		expect(failure.response?.status).toBe(413);
		expect(getApiError(failure, "")).toBe("failed to upload attachment: file is too large");
	});

	test("that sends nothing for its idle time is aborted, and fails", async () => {
		uploadLimits.idleMs = 40;
		FakeXHR.onSend = () => {};
		const failure = await api.post("/api/rooms/r/messages", messageForm(file(1024))).catch((e: unknown) => e);
		expect(failure).toBeInstanceOf(UploadTimeoutError);
		expect(getApiError(failure, "")).toStartWith("Upload stalled: nothing went out for");
		expect(FakeXHR.last!.aborted).toBe(true);
	});

	test("that keeps sending is never given up, however long it takes", async () => {
		uploadLimits.idleMs = 40;
		FakeXHR.onSend = (xhr) => {
			let ticks = 0;
			const tick = setInterval(() => {
				if (++ticks < 12) return xhr.upload.onprogress?.();
				clearInterval(tick);
				xhr.respond(201, { id: "m" });
			}, 15);
		};
		const res = await api.post("/api/rooms/r/messages", messageForm(file(1024)));
		expect(res.status).toBe(201);
		expect(FakeXHR.last!.aborted).toBe(false);
	});

	test("whose answer doesn't come in its time is aborted, and fails", async () => {
		uploadLimits.idleMs = 5_000;
		uploadLimits.answerMs = () => 40;
		FakeXHR.onSend = (xhr) => queueMicrotask(() => xhr.upload.onload?.());
		const failure = await api.post("/api/rooms/r/messages", messageForm(file(1024))).catch((e: unknown) => e);
		expect(failure).toBeInstanceOf(UploadTimeoutError);
		expect(getApiError(failure, "")).toBe("No answer to the upload in time");
		expect(FakeXHR.last!.aborted).toBe(true);
	});

	test("waits for its answer as long as the API may take to store it", () => {
		expect(uploadLimits.answerMs(0)).toBe(60_000);
		expect(uploadLimits.answerMs(32 * MiB)).toBe(2 * (30_000 + 128_000));
	});

	test("cut by the network fails as a fetch does", async () => {
		FakeXHR.onSend = (xhr) => queueMicrotask(() => xhr.onerror?.());
		await expect(api.post("/api/rooms/r/messages", messageForm(file(1024)))).rejects.toThrow("Failed to fetch");
	});

	test("isn't what a JSON request is: that one still goes through fetch", async () => {
		await api.post("/api/rooms/r/messages", { content: "hi" });
		expect(fetched).toHaveBeenCalledTimes(1);
		expect(FakeXHR.last).toBeNull();
	});
});
