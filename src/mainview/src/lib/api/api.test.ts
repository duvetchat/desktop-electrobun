import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import api, {
	FetchError,
	formBytes,
	getApiError,
	MAX_REQUEST_BYTES,
	NetworkError,
	NoAnswerError,
	refreshSession,
	requestLimits,
	TooLargeError,
	UploadTimeoutError,
	uploadLimits,
} from "$lib/api/api";
import { forgotPassword, sendChangeEmail, sendResetPasswordEmail, sendVerificationEmail, signIn } from "$lib/api/auth";
import { createSpaceBucket, createSpaceTransfer, deleteSpaceBucket, updateSpaceBucket } from "$lib/api/space-buckets";
import { deleteAllSpaceAttachments, deleteSpaceAttachment, getSpaceMembers } from "$lib/api/spaces";
import {
	createMyBucket,
	createMyTransfer,
	deleteAllMyAttachments,
	deleteMyAttachment,
	deleteMyBucket,
	updateMyBucket,
	type CreateBucketPayload,
} from "$lib/api/user";
import { accessToken } from "$lib/stores/auth";

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
	response: ArrayBuffer | string | null = null;
	responseHeaders = "";
	upload: {
		onprogress: ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null;
		onload: (() => void) | null;
	} = { onprogress: null, onload: null };
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
	// Bytes of its body going out, as a browser reports them: loaded of total, which it may not know.
	sends(loaded: number, total = 1024, lengthComputable = true) {
		this.upload.onprogress?.({ loaded, total: lengthComputable ? total : 0, lengthComputable });
	}
	// An answer of the API, JSON, or empty without json (a 204's).
	respond(status: number, json?: unknown) {
		this.upload.onload?.();
		this.status = status;
		this.responseHeaders = "content-type: application/json; charset=utf-8\r\nx-ratelimit-remaining: 4\r\n";
		const text = json === undefined ? "" : JSON.stringify(json);
		// As a browser does, by responseType: text by default.
		this.response = this.responseType === "arraybuffer" ? new TextEncoder().encode(text).buffer : text;
		// As a browser does with an exception in an event handler: it's reported, and nothing else happens.
		try {
			this.onload?.();
		} catch (e) {
			FakeXHR.thrown.push(e);
		}
	}
	static thrown: unknown[] = [];
}

// Whether the promise settles within ms, and how.
const within = (promise: Promise<unknown>, ms: number) =>
	Promise.race([
		promise.then(
			(value) => ({ settled: "resolved", value }),
			(error: unknown) => ({ settled: "rejected", error }),
		),
		new Promise((resolve) => setTimeout(() => resolve({ settled: `pending after ${ms} ms` }), ms)),
	]);

let fetched: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
const limits = { ...uploadLimits };
const answerLimits = { ...requestLimits };
beforeEach(() => {
	sent.length = 0;
	localStorage.clear();
	accessToken.set(null);
	FakeXHR.last = null;
	FakeXHR.onSend = (xhr) => queueMicrotask(() => xhr.respond(201, { id: "m" }));
	Object.assign(globalThis, { XMLHttpRequest: FakeXHR });
	Object.assign(uploadLimits, limits);
	Object.assign(requestLimits, answerLimits);
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
	test("is refused before anything is sent, with its size and how much of it is over the limit", async () => {
		const form = messageForm(file(33 * MiB));
		expect(formBytes(form)).toBeGreaterThan(MAX_REQUEST_BYTES);
		await expect(api.post("/api/rooms/r/messages", form)).rejects.toThrow(
			"Files too large: 33.00 MB, 1.00 MB over the 32 MB limit",
		);
		await expect(api.patch("/api/users/@me", form)).rejects.toBeInstanceOf(TooLargeError);
		expect(sent).toEqual([]);
	});

	test("counts its files together", async () => {
		await expect(
			api.post("/api/rooms/r/messages", messageForm(file(17 * MiB), file(17 * MiB, "second.bin"))),
		).rejects.toThrow("Files too large: 34.00 MB, 2.00 MB over the 32 MB limit");
		expect(sent).toEqual([]);
	});

	test("is refused by its whole body: files a little under 32 MiB with their fields around them are over", async () => {
		await expect(api.post("/api/rooms/r/messages", messageForm(file(MAX_REQUEST_BYTES - 100)))).rejects.toBeInstanceOf(
			TooLargeError,
		);
		expect(sent).toEqual([]);
	});

	// The API refuses a body over 32 MiB, and reads one of 32 MiB exactly (middlewares.RequestBody).
	test("isn't refused at the limit itself: one counted at 32 MiB exactly is sent", async () => {
		const form = messageForm(file(MAX_REQUEST_BYTES - formBytes(messageForm(file(0)))));
		expect(formBytes(form)).toBe(MAX_REQUEST_BYTES);
		expect((await api.post("/api/rooms/r/messages", form)).status).toBe(201);
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
		// A browser sends each lone LF or CR of a text as CRLF, a byte more each: 2000 of them were counted 1,262 bytes
		// short.
		const lineBreaks = (content: string) => {
			const form = new FormData();
			form.append("content", content);
			form.append("files", file(1024));
			return form;
		};
		// Each part's own lines, a name's escapes and a file name's, each with little else around it: none of them may
		// be counted short (#182's review).
		const manyParts = new FormData();
		for (let i = 0; i < 100; i++) manyParts.append("a", file(0, "a"));
		const quotedName = new FormData();
		quotedName.append('"'.repeat(500), "v");
		const quotedFileName = new FormData();
		quotedFileName.append("files", file(0, '"'.repeat(500)));
		const forms = [
			new FormData(),
			messageForm(),
			messageForm(file(5 * MiB)),
			messageForm(file(1), file(2, "ünïcödé.txt", "text/plain")),
			quoted,
			lineBreaks("a\n".repeat(2000)),
			lineBreaks("a\r".repeat(2000)),
			lineBreaks("a\r\n".repeat(2000)),
			lineBreaks("x\n\ny\r\rz\r\n\n"),
			manyParts,
			quotedName,
			quotedFileName,
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

	// As a fetch's: a refresh, then the same form again through XMLHttpRequest with the new tokens (#182's review).
	test("refused for its session's tokens goes again with the refreshed ones", async () => {
		localStorage.setItem("duvet_session_token", "access-1");
		localStorage.setItem("duvet_refresh_token", "session-1");
		fetched.mockImplementation((async (input: string | URL | Request) => {
			sent.push(input instanceof Request ? input.url : input.toString());
			const tokens = { token: "access-2", session_token: "session-2" };
			return new Response(JSON.stringify(tokens), { status: 200, headers: { "Content-Type": "application/json" } });
		}) as typeof fetch);
		const xhrs: FakeXHR[] = [];
		FakeXHR.onSend = (xhr) => {
			xhrs.push(xhr);
			queueMicrotask(() =>
				xhrs.length === 1 ? xhr.respond(401, { error: "expired" }) : xhr.respond(201, { id: "m" }),
			);
		};
		const form = messageForm(file(1024));
		const res = await api.post("/api/rooms/r/messages", form);
		expect(res).toMatchObject({ status: 201, data: { id: "m" } });
		expect(sent).toEqual([
			"https://api.test/api/rooms/r/messages",
			"https://api.test/api/auth/refresh",
			"https://api.test/api/rooms/r/messages",
		]);
		expect(xhrs).toHaveLength(2);
		expect(xhrs[1]!.headers).toMatchObject({ authorization: "Bearer access-2", "x-session-token": "session-2" });
		expect(xhrs[1]!.body).toBe(form);
	});

	// A 204 holds no body: a browser's Response refuses one for it, even empty, where Bun's takes it.
	test("answered without a body, as a 204 is, is read as fetch reads it", async () => {
		const BunResponse = globalThis.Response;
		class BrowserResponse extends BunResponse {
			constructor(body?: BodyInit | null, init?: ResponseInit) {
				if (body != null && init?.status === 204)
					throw new TypeError("Response with null body status cannot have body");
				super(body, init);
			}
		}
		globalThis.Response = BrowserResponse;
		try {
			FakeXHR.onSend = (xhr) => queueMicrotask(() => xhr.respond(204));
			const res = await api.patch("/api/users/@me", messageForm(file(1024)));
			expect(res).toMatchObject({ status: 204, data: null });
		} finally {
			globalThis.Response = BunResponse;
		}
	});

	test("refused by the API fails with its error, as a fetch's does", async () => {
		FakeXHR.onSend = (xhr) =>
			queueMicrotask(() =>
				xhr.respond(413, {
					error: "failed to upload attachment: file is too large: 26214400 bytes, your limit is 20971520",
				}),
			);
		const failure = await api.post("/api/rooms/r/messages", messageForm(file(1024))).catch((e: unknown) => e);
		if (!(failure instanceof FetchError)) throw new Error(`not the API's error: ${String(failure)}`);
		expect(failure.response?.status).toBe(413);
		// In the app's words (error-wording.ts): the API's, its numbers grouped.
		expect(getApiError(failure, "")).toBe(
			"Failed to upload attachment: file is too large: 26,214,400 bytes, your limit is 20,971,520",
		);
	});

	test("that stops sending once it started is aborted after its idle time, and fails", async () => {
		uploadLimits.idleMs = 40;
		FakeXHR.onSend = (xhr) => queueMicrotask(() => xhr.sends(512));
		const failure = await api.post("/api/rooms/r/messages", messageForm(file(1024))).catch((e: unknown) => e);
		expect(failure).toBeInstanceOf(UploadTimeoutError);
		expect(getApiError(failure, "")).toStartWith("Upload stalled: nothing went out for");
		expect(FakeXHR.last!.aborted).toBe(true);
	});

	// The idle time counted from the send failed an upload that waited for a connection: Chromium opens 6 a host over
	// HTTP/1.1, and the seventh upload waits for one of them with nothing sent (#182's review).
	test("that waits longer than its idle time before it starts isn't given up for it", async () => {
		uploadLimits.idleMs = 40;
		FakeXHR.onSend = (xhr) =>
			setTimeout(() => {
				xhr.sends(512);
				setTimeout(() => xhr.respond(201, { id: "m" }), 10);
			}, 120);
		const res = await api.post("/api/rooms/r/messages", messageForm(file(1024)));
		expect(res.status).toBe(201);
		expect(FakeXHR.last!.aborted).toBe(false);
	});

	// A webview that reports no upload progress (WebKit's are unchecked) only gives up an upload on its answer's time.
	test("that reports no progress at all is given up only when its answer doesn't come in its time", async () => {
		uploadLimits.idleMs = 40;
		uploadLimits.answerMs = () => 300;
		FakeXHR.onSend = (xhr) => setTimeout(() => xhr.respond(201, { id: "m" }), 120);
		expect((await api.post("/api/rooms/r/messages", messageForm(file(1024)))).status).toBe(201);

		FakeXHR.onSend = () => {};
		const upload = api.post("/api/rooms/r/messages", messageForm(file(1024)));
		expect(await within(upload, 120)).toEqual({ settled: "pending after 120 ms" });
		const failure = await upload.catch((e: unknown) => e);
		expect(failure).toBeInstanceOf(UploadTimeoutError);
		expect(getApiError(failure, "")).toBe("No answer to the upload in time");
		expect(FakeXHR.last!.aborted).toBe(true);
	});

	test("that keeps sending is never given up, however long it takes", async () => {
		uploadLimits.idleMs = 40;
		FakeXHR.onSend = (xhr) => {
			let ticks = 0;
			const tick = setInterval(() => {
				if (++ticks < 12) return xhr.sends(ticks * 80);
				clearInterval(tick);
				xhr.respond(201, { id: "m" });
			}, 15);
		};
		const res = await api.post("/api/rooms/r/messages", messageForm(file(1024)));
		expect(res.status).toBe(201);
		expect(FakeXHR.last!.aborted).toBe(false);
	});

	test("waits for its answer after its last byte, not its idle time; one that doesn't come in its time fails", async () => {
		uploadLimits.idleMs = 40;
		uploadLimits.answerMs = () => 300;
		// Its bytes go out, and the API takes longer than the idle time to store them.
		const sendsAll = (xhr: FakeXHR) => {
			xhr.sends(1024);
			xhr.upload.onload?.();
		};
		FakeXHR.onSend = (xhr) =>
			queueMicrotask(() => {
				sendsAll(xhr);
				setTimeout(() => xhr.respond(201, { id: "m" }), 120);
			});
		expect((await api.post("/api/rooms/r/messages", messageForm(file(1024)))).status).toBe(201);

		FakeXHR.onSend = (xhr) => queueMicrotask(() => sendsAll(xhr));
		const failure = await api.post("/api/rooms/r/messages", messageForm(file(1024))).catch((e: unknown) => e);
		expect(failure).toBeInstanceOf(UploadTimeoutError);
		expect(getApiError(failure, "")).toBe("No answer to the upload in time");
		expect(FakeXHR.last!.aborted).toBe(true);
	});

	// The API stores a request's files one after another, each in its own time: ten small files may take ten times
	// what one does (#182's review).
	test("waits for its answer as long as the API may take to store its files, one after another", async () => {
		expect(uploadLimits.answerMs(0)).toBe(60_000);
		expect(uploadLimits.answerMs(32 * MiB)).toBe(60_000 + 2 * 128_000);
		expect(uploadLimits.answerMs(10 * 1024, 10)).toBe(10 * 60_000 + 2_000);
		expect(uploadLimits.answerMs(10 * 1024, 0)).toBe(60_000 + 2_000);

		const asked: [number, number | undefined][] = [];
		uploadLimits.answerMs = (bytes, files) => {
			asked.push([bytes, files]);
			return 60_000;
		};
		const form = messageForm(file(1024), file(2048, "second.bin"), file(0, "third.bin"));
		await api.post("/api/rooms/r/messages", form);
		expect(asked).toContainEqual([formBytes(form), 3]);
	});

	// fetch fails an answer whose status a Response can't hold; new Response() threw inside the settled upload, which
	// then stayed pending for good.
	test("answered with a status outside 200-599 fails as a fetch does, at once", async () => {
		FakeXHR.thrown = [];
		FakeXHR.onSend = (xhr) => queueMicrotask(() => xhr.respond(999, { error: "weird" }));
		const outcome = await within(api.patch("/api/users/@me", messageForm(file(1024))), 500);
		// A NetworkError, a TypeError as fetch's is.
		expect(outcome).toMatchObject({ settled: "rejected", error: expect.any(NetworkError) });
		expect(NetworkError.prototype).toBeInstanceOf(TypeError);
		expect(FakeXHR.thrown).toEqual([]);
	});

	// As a fetch's: an abort of its signal fails it with the signal's reason, and a signal that outlives it keeps
	// nothing of it (#182's review).
	test("aborted by its signal fails with the signal's reason, and leaves no listener on it", async () => {
		const before = new AbortController();
		before.abort(new Error("left before"));
		const form = messageForm(file(1024));
		await expect(api.post("/api/rooms/r/messages", form, { signal: before.signal })).rejects.toThrow("left before");
		expect(FakeXHR.last).toBeNull();

		FakeXHR.onSend = () => {};
		const during = new AbortController();
		const upload = api.post("/api/rooms/r/messages", form, { signal: during.signal });
		during.abort(new Error("left during"));
		await expect(upload).rejects.toThrow("left during");
		expect(FakeXHR.last!.aborted).toBe(true);

		FakeXHR.onSend = (xhr) => queueMicrotask(() => xhr.respond(201, { id: "m" }));
		const kept = new AbortController();
		const added = spyOn(kept.signal, "addEventListener");
		const removed = spyOn(kept.signal, "removeEventListener");
		expect((await api.post("/api/rooms/r/messages", form, { signal: kept.signal })).status).toBe(201);
		expect(added).toHaveBeenCalledTimes(1);
		expect(removed).toHaveBeenCalledWith("abort", added.mock.calls[0]![1]);
	});

	test("cut by the network fails as a fetch does", async () => {
		FakeXHR.onSend = (xhr) => queueMicrotask(() => xhr.onerror?.());
		const failure = api.post("/api/rooms/r/messages", messageForm(file(1024)));
		await expect(failure).rejects.toBeInstanceOf(NetworkError);
		await expect(failure).rejects.toThrow("Failed to fetch");
	});

	test("isn't what a JSON request is: that one still goes through fetch", async () => {
		await api.post("/api/rooms/r/messages", { content: "hi" });
		expect(fetched).toHaveBeenCalledTimes(1);
		expect(FakeXHR.last).toBeNull();
	});
});

// #464: a request that failed on the network showed the webview's own English, "Failed to fetch" in Chromium and "Load
// failed" in WebKit (macOS). getApiError took any TypeError for one, a bug's too; the network's is marked where fetch
// fails instead.
describe("a request the network failed", () => {
	test("fails with a NetworkError, in the app's words, whatever the webview said, its limit or none", async () => {
		requestLimits.answerMs = 10_000;
		// Chromium's, WebKit's and Firefox's.
		for (const said of ["Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource."]) {
			fetched.mockRejectedValue(new TypeError(said));
			for (const failure of [api.get("/api/rooms/r/messages"), deleteAllMyAttachments()]) {
				const err = await failure.catch((e: unknown) => e);
				expect(err, said).toBeInstanceOf(NetworkError);
				// A TypeError still, as a fetch's network error is.
				expect(err, said).toBeInstanceOf(TypeError);
				expect(getApiError(err, "Failed"), said).toBe("Failed to fetch");
			}
		}
	});

	test("is only what fetch failed with: an abort stays an abort, and an error of the caller's stays its own", async () => {
		const caller = new AbortController();
		fetched.mockImplementation(
			((_input: string | URL | Request, init?: RequestInit) =>
				new Promise<Response>((_, reject) =>
					init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
				)) as typeof fetch,
		);
		const aborted = api.get("/api/rooms/r/messages", { signal: caller.signal });
		caller.abort();
		const err = await aborted.catch((e: unknown) => e);
		expect(err).not.toBeInstanceOf(NetworkError);
		expect(err).toMatchObject({ name: "AbortError" });
		// A bug's TypeError in a caller's try block gives way to what the caller was doing.
		const bug = new TypeError("Cannot read properties of null (reading 'type')");
		expect(getApiError(bug, "This interaction failed")).toBe("This interaction failed");
	});
});

// A cropped avatar, banner, icon, emoji or sticker went up saying only "Saving…" or "Uploading…" (#78): its sender now
// gets the bytes of its body sent and their total as they go, which the image's Save or Upload shows in percent.
describe("an upload's progress", () => {
	test("reaches its sender as the bytes go out, all of them once the body is up, and nothing after the answer", async () => {
		const seen: [number, number][] = [];
		FakeXHR.onSend = (xhr) =>
			queueMicrotask(() => {
				xhr.sends(0, 4000);
				xhr.sends(1500, 4000);
				xhr.sends(4000, 4000);
				// Its last byte out (respond's upload.onload), then its answer.
				xhr.respond(201, { id: "m" });
				xhr.sends(4000, 4000);
			});
		const res = await api.patch("/api/users/@me", messageForm(file(1024)), {
			onUploadProgress: (up, total) => seen.push([up, total]),
		});
		expect(res.status).toBe(201);
		expect(seen).toEqual([
			[0, 4000],
			[1500, 4000],
			[4000, 4000],
			[4000, 4000],
		]);
	});

	test("counts the form's own size while the webview doesn't give the total", async () => {
		const seen: [number, number][] = [];
		const form = messageForm(file(1024));
		FakeXHR.onSend = (xhr) =>
			queueMicrotask(() => {
				xhr.sends(100, 0, false);
				xhr.respond(201, { id: "m" });
			});
		await api.post("/api/spaces/s/emojis", form, { onUploadProgress: (up, total) => seen.push([up, total]) });
		expect(seen).toEqual([
			[100, formBytes(form)],
			[formBytes(form), formBytes(form)],
		]);
	});

	test("starts over from 0 when the form goes again after a refresh", async () => {
		localStorage.setItem("duvet_session_token", "access-1");
		localStorage.setItem("duvet_refresh_token", "session-1");
		fetched.mockImplementation((async (input: string | URL | Request) => {
			sent.push(input instanceof Request ? input.url : input.toString());
			const tokens = { token: "access-2", session_token: "session-2" };
			return new Response(JSON.stringify(tokens), { status: 200, headers: { "Content-Type": "application/json" } });
		}) as typeof fetch);
		let tries = 0;
		FakeXHR.onSend = (xhr) =>
			queueMicrotask(() => {
				if (++tries === 1) {
					xhr.sends(4000, 4000);
					xhr.respond(401, { error: "expired" });
				} else {
					xhr.sends(0, 4000);
					xhr.respond(201, { id: "m" });
				}
			});
		const seen: number[] = [];
		const res = await api.post("/api/spaces/s/stickers", messageForm(file(1024)), {
			onUploadProgress: (up) => seen.push(up),
		});
		expect(res.status).toBe(201);
		// The first try's body, all up, then the second's from its own start.
		expect(seen).toEqual([4000, 4000, 0, 4000]);
	});

	test("isn't reported for a request that isn't a form, which changes nothing else", async () => {
		const seen: number[] = [];
		const res = await api.patch("/api/users/@me", { alias: "a" }, { onUploadProgress: (up) => seen.push(up) });
		expect(res.status).toBe(201);
		expect(seen).toEqual([]);
		expect(fetched).toHaveBeenCalledTimes(1);
		expect(FakeXHR.last).toBeNull();
	});
});

// #217: a request other than a form's went through fetch with no time limit, unless its caller passed a signal: one the
// API or the network left hanging held whatever waited on it (a page of messages, a member list, the reactions dialog's
// lookups) until the connection itself failed.
describe("a request the API doesn't answer", () => {
	// fetch as a browser's: what a signal aborts fails with its reason, the body's read too. answerIn: when the answer
	// comes, never without; bodyEnds: false, an answer whose body never ends.
	function answering(answerIn: number | null, bodyEnds = true) {
		fetched.mockImplementation(((input: string | URL | Request, init?: RequestInit) => {
			sent.push(input instanceof Request ? input.url : input.toString());
			const signal = init?.signal;
			return new Promise<Response>((resolve, reject) => {
				signal?.addEventListener("abort", () => reject(signal.reason));
				if (answerIn === null) return;
				setTimeout(() => {
					const body = new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(new TextEncoder().encode(JSON.stringify({ id: "m" })));
							if (bodyEnds) controller.close();
							signal?.addEventListener("abort", () => controller.error(signal.reason));
						},
					});
					resolve(new Response(body, { status: 200, headers: { "Content-Type": "application/json" } }));
				}, answerIn);
			});
		}) as typeof fetch);
	}
	const errorOf = (outcome: unknown) =>
		outcome && typeof outcome === "object" && "error" in outcome ? outcome.error : undefined;

	test("fails after its limit as a network error does, a TypeError, which its caller's error path takes", async () => {
		requestLimits.answerMs = 40;
		answering(null);
		const outcome = await within(api.get("/api/rooms/r/messages"), 1000);
		expect(outcome).toMatchObject({ settled: "rejected" });
		expect(errorOf(outcome)).toBeInstanceOf(NoAnswerError);
		expect(errorOf(outcome)).toBeInstanceOf(TypeError);
		expect(getApiError(errorOf(outcome), "fallback")).toBe("No answer from the server in time");
	});

	test("an answer whose body stops coming fails too", async () => {
		requestLimits.answerMs = 40;
		answering(0, false);
		expect(errorOf(await within(api.get("/api/spaces/s/members"), 1000))).toBeInstanceOf(NoAnswerError);
	});

	// As the mobile app's client has it: what counts is how long nothing comes, not how long it all takes.
	test("an answer that keeps coming, however slowly, isn't cut", async () => {
		requestLimits.answerMs = 60;
		const pieces = ["[", '{"id":"a"}', ",", '{"id":"b"}', "]"];
		fetched.mockImplementation(((_input: string | URL | Request, init?: RequestInit) => {
			const body = new ReadableStream<Uint8Array>({
				async start(controller) {
					init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
					for (const piece of pieces) {
						await Bun.sleep(30);
						controller.enqueue(new TextEncoder().encode(piece));
					}
					controller.close();
				},
			});
			return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "application/json" } }));
		}) as typeof fetch);
		const res = await api.get("/api/users/@me/attachments");
		expect(res.data).toEqual([{ id: "a" }, { id: "b" }]);
	});

	test("one answered in time is as before, and its limit doesn't fire after", async () => {
		requestLimits.answerMs = 40;
		answering(5);
		const res = await api.get("/api/rooms/r/messages");
		expect(res).toMatchObject({ status: 200, data: { id: "m" } });
		await Bun.sleep(60);
	});

	// The views pass their own signals to drop what a newer request replaced (a page, the member list, the pins, a
	// search): those bound nothing, and their aborts stay theirs.
	test("one with its caller's signal has the limit too, and that signal's abort fails as an abort", async () => {
		requestLimits.answerMs = 40;
		answering(null);
		const late = await within(getSpaceMembers("s", undefined, new AbortController().signal), 1000);
		expect(errorOf(late)).toBeInstanceOf(NoAnswerError);

		requestLimits.answerMs = 10_000;
		const caller = new AbortController();
		const aborted = within(getSpaceMembers("s", undefined, caller.signal), 1000);
		caller.abort();
		const err = errorOf(await aborted);
		expect(err).not.toBeInstanceOf(NoAnswerError);
		expect(err).toMatchObject({ name: "AbortError" });
	});

	test("the routes the API answers only after slower work wait longer", async () => {
		requestLimits.answerMs = 20;
		requestLimits.slowAnswerMs = 10_000;
		answering(60);
		const bucket: CreateBucketPayload = {
			name: "b",
			endpoint: "https://s3.test",
			bucket_name: "b",
			access_key_id: "k",
			secret_access_key: "s",
		};
		const slow: [string, () => Promise<unknown>][] = [
			["a bucket registered", () => createMyBucket(bucket)],
			["a bucket edited", () => updateMyBucket("b", bucket)],
			["a space's bucket registered", () => createSpaceBucket("s", bucket)],
			["a space's bucket edited", () => updateSpaceBucket("s", "b", bucket)],
			["a transfer", () => createMyTransfer({ source: "default", target: "b" })],
			["a space's transfer", () => createSpaceTransfer("s", { source: "a", target: "b" })],
			["a file deleted", () => deleteMyAttachment("f")],
			["a space's file deleted", () => deleteSpaceAttachment("s", "f")],
			["a sign-up", () => signIn({ username: "u", alias: null, password: "p", email: "e@x.test" })],
			["a verification email", () => sendVerificationEmail()],
			["a reset email", () => forgotPassword("e@x.test")],
			["a reset email from the settings", () => sendResetPasswordEmail()],
			["an email change", () => sendChangeEmail("e@x.test")],
		];
		for (const [what, call] of slow) {
			expect([what, await within(call(), 1000)]).toMatchObject([what, { settled: "resolved" }]);
		}
		// Any other gives up at the usual limit.
		expect(await within(api.get("/api/users/@me/buckets"), 1000)).toMatchObject({ settled: "rejected" });
	});

	test("a deletion of every file waits as long as it takes: it lasts as long as their number", async () => {
		requestLimits.answerMs = 20;
		requestLimits.slowAnswerMs = 20;
		answering(60);
		for (const call of [
			() => deleteAllMyAttachments(),
			() => deleteAllSpaceAttachments("s"),
			() => deleteMyBucket("b", true),
			() => deleteSpaceBucket("s", "b", true),
		]) {
			expect(await within(call(), 1000)).toMatchObject({ settled: "resolved" });
		}
		expect(await within(deleteMyBucket("b"), 1000)).toMatchObject({ settled: "rejected" });
	});

	// A refresh whose answer is lost may have rotated the session: it goes once more with the same token, which the API
	// answers with the new tokens for 30 s (renewOnceMore).
	test("a refresh given up goes once more, inside the API's rotation grace, and the request then goes through", async () => {
		requestLimits.answerMs = 40;
		localStorage.setItem("duvet_session_token", "access-1");
		localStorage.setItem("duvet_refresh_token", "session-1");
		let refreshes = 0;
		fetched.mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
			const url = input instanceof Request ? input.url : input.toString();
			sent.push(url);
			if (url.endsWith("/api/auth/refresh") && ++refreshes === 1) {
				return new Promise<Response>((_, reject) =>
					init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
				);
			}
			if (url.endsWith("/api/auth/refresh")) return Response.json({ token: "access-2", session_token: "session-2" });
			const token = new Headers(init?.headers).get("Authorization");
			return token === "Bearer access-2"
				? Response.json({ id: "m" })
				: Response.json({ error: "expired" }, { status: 401 });
		}) as typeof fetch);
		const res = await api.get("/api/users/@me");
		expect(res).toMatchObject({ status: 200, data: { id: "m" } });
		expect(refreshes).toBe(2);
		expect(localStorage.getItem("duvet_refresh_token")).toBe("session-2");
	}, 10_000);

	test("a refresh that never gets an answer fails, and signs nobody out", async () => {
		requestLimits.answerMs = 40;
		localStorage.setItem("duvet_session_token", "access-1");
		localStorage.setItem("duvet_refresh_token", "session-1");
		answering(null);
		expect(errorOf(await within(refreshSession(), 8000))).toBeInstanceOf(NoAnswerError);
		expect(localStorage.getItem("duvet_session_token")).toBe("access-1");
	}, 10_000);

	test("its limits stay above the API's slowest answers, and a refresh's second try inside the rotation grace", () => {
		// An interaction: 3 s for the bot's response, and 10 s more for one on its way.
		expect(answerLimits.answerMs).toBeGreaterThan(13_000);
		// A refresh given up is tried again 3 s later, and the API keeps a rotation's tokens 30 s.
		expect(answerLimits.answerMs + 3000).toBeLessThan(30_000);
		// An email: 10 s to connect, then 30 s.
		expect(answerLimits.slowAnswerMs).toBeGreaterThan(40_000);
	});
});
