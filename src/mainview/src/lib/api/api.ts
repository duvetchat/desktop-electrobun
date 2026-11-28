import { getHostURL, route } from "$lib/common/common";
import { inAppWords } from "$lib/api/error-wording";
import { duvetClient, ownSession } from "$lib/e2e/client";
import { currentShell } from "$lib/platform";
import {
	renewalDue,
	renewalFirst,
	renewedByMainWindow,
	renewOnceMore,
	SESSION_CHANNEL,
	windowRenewsSession,
	type SessionCheck,
} from "$lib/session";
import { accessToken } from "$lib/stores/auth";
import { answerWindows, askMainWindow } from "$lib/window-hub";
import { currentLocale, t } from "$lib/i18n";
import { formatFileSize, formatNumber } from "$lib/i18n/format";
import { get } from "svelte/store";

export interface FetchRequestConfig extends Omit<RequestInit, "body"> {
	params?: Record<string, string | number | boolean | null | undefined>;
	data?: any;
	_retry?: boolean;
	/** A form's upload, or a Blob's, as it goes: the bytes of its body sent so far, and their total. sent reaches total once the whole
	 * body is up, and the request then waits for its answer. A form sent again (after a refresh) starts over from 0.
	 * Other requests report nothing. */
	onUploadProgress?: (sent: number, total: number) => void;
	/** How long a request other than a form's waits for its answer: requestLimits.answerMs unless its route needs longer
	 * (slowAnswerMs), and Infinity to wait as long as it takes. A form's upload has its own (uploadLimits). */
	answerMs?: number;
}

/** How long a request other than a form's goes without a sign of its answer (its headers, then each piece of its body)
 * before it's given up and fails with a NoAnswerError, as a network error fails, so its caller's error path or retry
 * runs (#217). An answer that keeps coming, however slowly, isn't cut, as the mobile app's client has it. */
export const requestLimits = {
	/** Every request's, the session's refresh included, as the mobile app's (duvet_client's defaultRequestTimeout): above
	 * the API's slowest answers to them, an interaction's (3 s for the bot's response, then 10 s more for one on its
	 * way) and a message search's (5 s for each of its two queries). A refresh given up is tried again 3 s later
	 * (renewOnceMore), inside the API's 30 s rotation grace. */
	answerMs: 20_000,
	/** The routes the API answers only once work it bounds itself is done: a bucket's check when it's registered or
	 * edited, a transfer's probe of its buckets and a file's deletion from its storage (30 s each), and an email it
	 * sends (40 s: 10 s to connect, then 30 s). */
	slowAnswerMs: 60_000,
	/** In a window that doesn't renew the session (lib/session.ts): how long a request waits for the main window's
	 * renewal, a refresh's own limit and its second try. */
	mainWindowRenewalMs: 30_000,
	/** How often a window waiting for that renewal looks at storage itself, should no storage event tell it. */
	renewalLookMs: 1000,
};

/** A request whose answer didn't come in time (requestLimits): it fails as a network error does, a TypeError. */
export class NoAnswerError extends TypeError {
	constructor() {
		super(t("error_no_answer"));
		this.name = "NoAnswerError";
	}
}

/** A request that failed on the network: no connection, or Duvet out of reach. fetch and XMLHttpRequest fail so with a
 * TypeError in the webview's own English ("Failed to fetch" in Chromium, "Load failed" in WebKit), which this one, a
 * TypeError still, says in the app's words in another language; in English, in the webview's, as the app always has.
 * It's made where the request failed (fetchWithin, sendForm), so a TypeError of any other making isn't taken for one. */
export class NetworkError extends TypeError {
	constructor(cause?: unknown) {
		const webview = cause instanceof TypeError && cause.message ? cause.message : null;
		super(currentLocale() === "en" && webview ? webview : t("error_network_failed"), { cause });
		this.name = "NetworkError";
	}
}

/** What the sender of a form may follow it with: its upload's progress, and a signal that aborts it. */
export type UploadOptions = Pick<FetchRequestConfig, "onUploadProgress" | "signal">;

export interface FetchResponse<T = any> {
	data: T;
	status: number;
	statusText: string;
	headers: Headers;
}

export interface ApiClient {
	get: <T = any>(url: string, config?: FetchRequestConfig) => Promise<FetchResponse<T>>;
	delete: <T = any>(url: string, config?: FetchRequestConfig) => Promise<FetchResponse<T>>;
	head: <T = any>(url: string, config?: FetchRequestConfig) => Promise<FetchResponse<T>>;
	options: <T = any>(url: string, config?: FetchRequestConfig) => Promise<FetchResponse<T>>;
	post: <T = any>(url: string, data?: any, config?: FetchRequestConfig) => Promise<FetchResponse<T>>;
	put: <T = any>(url: string, data?: any, config?: FetchRequestConfig) => Promise<FetchResponse<T>>;
	patch: <T = any>(url: string, data?: any, config?: FetchRequestConfig) => Promise<FetchResponse<T>>;
}

export class FetchError extends Error {
	response?: FetchResponse;
	config: FetchRequestConfig;

	constructor(message: string, config: FetchRequestConfig, response?: FetchResponse) {
		super(message);
		this.name = "FetchError";
		this.config = config;
		this.response = response;
	}
}

/**
 * The API's 426 (PLAN-E2E-API.md, its e2eClient): a route of end-to-end encryption, or of a conversation, takes only a
 * client that has it, and this one isn't (its X-Duvet-Client is below E2E_MIN_CLIENTS). `client` is what the API read
 * it as, null when it couldn't; `minimum` is its platform's lowest version with encryption, null when the platform has
 * none yet (macOS and Linux, decisions 38 and 39).
 */
export class UpdateRequiredError extends FetchError {
	readonly client: string | null;
	readonly minimum: string | null;

	constructor(message: string, config: FetchRequestConfig, response: FetchResponse) {
		super(message, config, response);
		this.name = "UpdateRequiredError";
		const { client, minimum } = response.data ?? {};
		this.client = typeof client === "string" ? client : null;
		this.minimum = typeof minimum === "string" ? minimum : null;
	}
}

/** What the API's 503 says while encrypted conversations are paused (E2E_PAUSED, its e2eWrites). */
const PAUSED = "encrypted conversations are paused";

/**
 * The API's 503 while encrypted conversations are paused: a conversation's write waits `retryAfter` seconds, its
 * Retry-After (60, the API's own, when it doesn't read), and goes again as it was.
 */
export class PausedError extends FetchError {
	readonly retryAfter: number;

	constructor(message: string, config: FetchRequestConfig, response: FetchResponse) {
		super(message, config, response);
		this.name = "PausedError";
		const seconds = Number(response.headers.get("Retry-After") ?? Number.NaN);
		this.retryAfter = Number.isFinite(seconds) && seconds >= 0 ? seconds : 60;
	}
}

/** An answer of the API's that isn't a success, as the error it is: a 426 or a pause's 503 by its type, any other a
 * FetchError, read as it always was. */
function refusal(response: FetchResponse, config: FetchRequestConfig): FetchError {
	const message = t("error_request_failed", { status: String(response.status) });
	if (response.status === 426) return new UpdateRequiredError(message, config, response);
	if (response.status === 503 && response.data?.error === PAUSED) return new PausedError(message, config, response);
	return new FetchError(message, config, response);
}

class RefreshFailedError extends Error {
	status: number;

	constructor(status: number) {
		// A person can read it: a request the API refused with a 401 fails with it when the renewal it waited for did.
		super(t("error_session_refresh_failed", { status: String(status) }));
		this.name = "RefreshFailedError";
		this.status = status;
	}
}

/** The largest request body the API reads (MaxBodyBytes, duvet-api's internal/http/middlewares/body.go). It answers a
 * bigger one with a 413 before reading it, which Chromium never hands over HTTP/3, where the request then never ends
 * (#182): a form this big isn't sent at all. */
export const MAX_REQUEST_BYTES = 32 * 1024 * 1024;

// What a multipart body adds around each of its fields, at most: the boundary line (a boundary has 70 characters at
// most, RFC 2046), the Content-Disposition and Content-Type lines and the line ends. Names are counted three times,
// for the escapes a browser writes in them (%22 for a quote).
const PART_OVERHEAD = 256;

/** The size of form as the multipart body a browser sends, or a little more: never less, whatever its boundary. */
export function formBytes(form: FormData): number {
	const encoder = new TextEncoder();
	let bytes = PART_OVERHEAD; // the closing boundary
	form.forEach((value, name) => {
		bytes += PART_OVERHEAD + 3 * encoder.encode(name).length;
		if (typeof value === "string") {
			// A browser sends every line break of a text as CRLF: a lone LF or CR takes a byte more than it seems.
			bytes += encoder.encode(value.replace(/\r\n|\r|\n/g, "\r\n")).length;
		} else {
			// A file's part also names the file, and its type: the browser writes application/octet-stream for none.
			bytes += value.size + 3 * encoder.encode(value.name).length;
			bytes += (value.type || "application/octet-stream").length;
		}
	});
	return bytes;
}

/** A request refused before it's sent, as the API would refuse it: its body is over MAX_REQUEST_BYTES, or a file is over
 * its own cap where it goes. Its message says what was too large (what: files, a message with its files, or one file),
 * its size and how much of it is over the limit, which a size rounded to the limit's can't show. */
export class TooLargeError extends Error {
	bytes: number;

	/** `limit`: the request's 32 MiB, or a file's own cap where it goes. */
	constructor(bytes: number, what: "files" | "message" | "file" = "files", limit = MAX_REQUEST_BYTES) {
		const mib = 1024 * 1024;
		super(
			t("error_too_large", {
				what,
				size: formatFileSize(bytes),
				over: formatFileSize(bytes - limit),
				// The limit's whole megabytes (32 MB), or its size when it isn't whole.
				limit: limit % mib === 0 ? t("format_size_mb", { size: formatNumber(limit / mib) }) : formatFileSize(limit),
			}),
		);
		this.name = "TooLargeError";
		this.bytes = bytes;
	}
}

/** When an upload is given up (#182). idleMs: it has sent nothing for that long since its last progress, as when
 * Chromium leaves an HTTP/3 upload the server stopped early hanging, or a link stalls; one that keeps moving is never
 * cut, however slow. answerMs: its answer hasn't come that long after its last byte left, or after it was sent while
 * it reports no progress yet. The API stores a request's files one after another, each within copyTimeout (30 s, and
 * 1 s more per 256 KiB) and its commit's 30 s: 60 s a file and 1 s per 256 KiB, and as long again per 256 KiB for the
 * bytes still on their way when the last one left (in the connection's buffers, or a proxy's). */
export const uploadLimits = {
	idleMs: 30_000,
	answerMs: (bytes: number, files = 1) => 60_000 * Math.max(1, files) + 2_000 * Math.ceil(bytes / (256 * 1024)),
};

/** An upload given up: it stopped sending, or its answer didn't come (uploadLimits). */
export class UploadTimeoutError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UploadTimeoutError";
	}
}

// A null body status's answer can't hold a body, even an empty one.
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

// The XMLHttpRequest's answer as fetch's: its status, its headers and its body.
function responseOf(xhr: XMLHttpRequest): Response {
	const headers = new Headers();
	for (const line of xhr.getAllResponseHeaders().split("\r\n")) {
		const colon = line.indexOf(":");
		if (colon > 0) headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
	}
	const response: unknown = xhr.response;
	const body = response instanceof ArrayBuffer && !NULL_BODY_STATUSES.has(xhr.status) ? response : null;
	return new Response(body, { status: xhr.status, statusText: xhr.statusText, headers });
}

/** Sends a form, or a Blob's bytes, as fetch sends it with init, through XMLHttpRequest, whose upload progress tells an
 * upload that stalled from a slow one (fetch has none): one that stops sending for uploadLimits.idleMs, or whose answer
 * hasn't come uploadLimits.answerMs after its last byte, is aborted and fails with an UploadTimeoutError. A network error,
 * or an abort of init.signal (with its reason), fails as fetch's does. bytes is the body's size (formBytes for a form).
 * onProgress gets the progress (FetchRequestConfig.onUploadProgress) until the request ends. */
function sendForm(
	url: string,
	init: RequestInit,
	form: FormData | Blob,
	bytes: number,
	onProgress?: (sent: number, total: number) => void,
): Promise<Response> {
	// A Blob is one file.
	let files = form instanceof Blob ? 1 : 0;
	if (form instanceof FormData) {
		form.forEach((value) => {
			if (typeof value !== "string") files++;
		});
	}
	return new Promise((resolve, reject) => {
		if (init.signal?.aborted) {
			reject(init.signal.reason);
			return;
		}
		const xhr = new XMLHttpRequest();
		let timer: ReturnType<typeof setTimeout> | undefined;
		let settled = false;
		const onAbort = () =>
			settle(() => {
				xhr.abort();
				reject(init.signal?.reason);
			});
		const settle = (done: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			init.signal?.removeEventListener("abort", onAbort);
			done();
		};
		// why: the error's words, asked for once the upload is given up.
		const giveUpIn = (ms: number, why: () => string) => {
			if (settled) return; // an upload event after the answer
			clearTimeout(timer);
			timer = setTimeout(
				() =>
					settle(() => {
						xhr.abort();
						reject(new UploadTimeoutError(why()));
					}),
				ms,
			);
		};
		// Before its first progress, an upload may still wait for a connection (HTTP/1.1 has 6 a host), and a webview may
		// report none at all: only the answer's limit applies then, from the start. From its first progress on, it may go
		// uploadLimits.idleMs without another.
		const waitForProgress = () =>
			giveUpIn(uploadLimits.idleMs, () =>
				t("error_upload_stalled", { seconds: Math.round(uploadLimits.idleMs / 1000) }),
			);
		const waitForAnswer = () => giveUpIn(uploadLimits.answerMs(bytes, files), () => t("error_upload_no_answer"));
		// The body's size as the webview counts it, or as formBytes does while it says none.
		let total = bytes;
		const report = (sent: number) => {
			if (!settled) onProgress?.(Math.min(sent, total), total);
		};

		xhr.open(init.method ?? "POST", url);
		xhr.withCredentials = init.credentials === "include";
		xhr.responseType = "arraybuffer";
		new Headers(init.headers).forEach((value, name) => xhr.setRequestHeader(name, value));
		xhr.upload.onprogress = (e) => {
			waitForProgress();
			if (e.lengthComputable && e.total > 0) total = e.total;
			report(e.loaded);
		};
		// Its last byte is out: from here on only the answer is awaited.
		xhr.upload.onload = () => {
			waitForAnswer();
			report(total);
		};
		xhr.onload = () =>
			settle(() => {
				// A status a Response can't hold (outside 200-599) fails, as fetch fails such an answer.
				try {
					resolve(responseOf(xhr));
				} catch (err) {
					reject(new NetworkError(err));
				}
			});
		xhr.onerror = () => settle(() => reject(new NetworkError()));
		xhr.onabort = () => settle(() => reject(new DOMException(t("error_upload_aborted"), "AbortError")));
		init.signal?.addEventListener("abort", onAbort);
		waitForAnswer();
		xhr.send(form);
	});
}

/** fetch, given up once ms pass without a sign of its answer (requestLimits): its headers, then each piece of its body,
 * which is read here, so a server that stops halfway through it is given up too. Given up, the request is aborted and
 * fails with a NoAnswerError; the answer comes back with its body in memory. An abort of init.signal fails as fetch's
 * does, and a failure on the network with a NetworkError. `piece` hears how much of the body came, at each piece:
 * what it throws stops the reading, and fails the fetch with it. Not AbortSignal.any and AbortSignal.timeout: an older
 * Mac's WebKit, which the app runs on there, lacks them (GifPicker). */
export async function fetchWithin(
	url: string,
	init: RequestInit,
	ms: number,
	piece?: (received: number) => void,
): Promise<Response> {
	if (!Number.isFinite(ms))
		return fetch(url, init).catch((err: unknown) => {
			throw err instanceof TypeError ? new NetworkError(err) : err;
		});
	const request = new AbortController();
	const own = init.signal;
	const stop = () => request.abort(own?.reason);
	let late = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const alive = () => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			late = true;
			request.abort();
		}, ms);
	};
	alive();
	if (own?.aborted) stop();
	else own?.addEventListener("abort", stop);
	try {
		const res = await fetch(url, { ...init, signal: request.signal });
		alive();
		const body = NULL_BODY_STATUSES.has(res.status) || !res.body ? null : await readBody(res.body, alive, piece);
		return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
	} catch (err) {
		if (late) throw new NoAnswerError();
		// fetch's, or its body's read's: the network failed.
		if (err instanceof TypeError) throw new NetworkError(err);
		throw err;
	} finally {
		clearTimeout(timer);
		own?.removeEventListener("abort", stop);
	}
}

// A body's bytes, read whole, with alive() and onPiece() at each piece; what onPiece() throws stops the reading.
async function readBody(
	body: ReadableStream<Uint8Array>,
	alive: () => void,
	onPiece?: (received: number) => void,
): Promise<ArrayBuffer> {
	const reader = body.getReader();
	const pieces: Uint8Array[] = [];
	let length = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		alive();
		pieces.push(value);
		length += value.length;
		try {
			onPiece?.(length);
		} catch (error) {
			await reader.cancel().catch(() => {});
			throw error;
		}
	}
	const bytes = new Uint8Array(length);
	let at = 0;
	for (const piece of pieces) {
		bytes.set(piece, at);
		at += piece.length;
	}
	return bytes.buffer;
}

// When the session's tokens were issued: keepSessionFresh renews them by their age (renewalDue).
const REFRESHED_AT_KEY = "duvet_session_refreshed_at";
// A renewal that failed without an answer goes once more after this, well inside the API's 30 s rotation grace.
const LOST_RENEWAL_RETRY_MS = 3000;

/** Notes that the session's tokens were just issued, by logging in or refreshing. */
export function markSessionRefreshed(): void {
	localStorage.setItem(REFRESHED_AT_KEY, String(Date.now()));
}

let refreshing: Promise<string> | null = null;

/** What a request or renewal that would go out with another account's session gives (#612): nothing, ever, as the page
 * loads again as that account (ownSession). Failing would only show an error for a moment. */
const neverAnswered = <T>(): Promise<T> => new Promise<T>(() => {});

/** Rotates the session's tokens and resolves to the new access token. Concurrent callers share one
 * request, its retry included. A rejected session (401/403) signs out; rate limits, server and network
 * errors don't, and a network error goes once more first. Only the main window does it: any other of
 * the app's windows takes the main window's renewal instead (windowRenewsSession, lib/session.ts). */
export function refreshSession(refused: string | null = null): Promise<string> {
	const renew = windowRenewsSession(currentShell().window) ? requestRefresh : () => takeMainWindowsRenewal(refused);
	refreshing ??= renew().finally(() => {
		refreshing = null;
	});
	return refreshing;
}

/** In a window that doesn't renew: the token the main window's renewal leaves in localStorage, which the
 * windows share, in place of `refused` (the one a request was just refused with, else this page's copy).
 * This page's own copy of it follows. No request is made, and nobody is signed out. */
async function takeMainWindowsRenewal(refused: string | null): Promise<string> {
	const token = await renewedByMainWindow({
		read: () => localStorage.getItem("duvet_session_token"),
		watch: (changed) => {
			const onStorage = (event: StorageEvent) => {
				if (event.key === null || event.key === "duvet_session_token") changed();
			};
			window.addEventListener("storage", onStorage);
			// And looked at once a second: that one window's write raises the storage event in another was only ever
			// seen on macOS, and the token is there to read either way.
			const looking = setInterval(changed, requestLimits.renewalLookMs);
			return () => {
				window.removeEventListener("storage", onStorage);
				clearInterval(looking);
			};
		},
		stale: refused ?? get(accessToken),
		timeoutMs: requestLimits.mainWindowRenewalMs,
		// The main window renews by the tokens' age, and a sleeping one hasn't yet: it is asked to now. Its answer is
		// the token it writes, so a main window that doesn't hear this is only waited for, as before.
		ask: () => void askMainWindow(SESSION_CHANNEL, "renew").catch(() => undefined),
	});
	accessToken.set(token);
	return token;
}

async function requestRefresh(): Promise<string> {
	if (!ownSession()) return neverAnswered();
	const refreshHeaders = new Headers({ "X-Duvet-Client": duvetClient() });
	const currentSessionToken = localStorage.getItem("duvet_refresh_token");
	if (currentSessionToken) {
		refreshHeaders.set("X-Session-Token", currentSessionToken);
	}
	const refresh = () =>
		fetchWithin(
			`${getHostURL()}/api/auth/refresh`,
			{ method: "POST", credentials: "include", headers: refreshHeaders },
			requestLimits.answerMs,
		);
	const renew = async () => {
		let res = await refresh();
		// A 429 means "try again later", not an invalid session: wait as long as the API says,
		// up to 20s per attempt so queued requests aren't held for minutes.
		for (let attempt = 0; res.status === 429 && attempt < 3; attempt++) {
			const waitSeconds = Number(res.headers.get("Retry-After") ?? res.headers.get("X-RateLimit-Reset-After")) || 1;
			await new Promise((r) => setTimeout(r, Math.min(Math.ceil(waitSeconds), 20) * 1000));
			res = await refresh();
		}
		if (!res.ok) throw new RefreshFailedError(res.status);
		return res.json();
	};
	try {
		// Failed without an answer, it goes once more with the same session token, inside the API's rotation grace.
		const resData = await renewOnceMore(
			renew,
			(err) => err instanceof RefreshFailedError,
			() => new Promise((r) => setTimeout(r, LOST_RENEWAL_RETRY_MS)),
		);
		const newToken: string = resData.token;
		accessToken.set(newToken);
		localStorage.setItem("duvet_session_token", newToken);
		if (resData.session_token) {
			localStorage.setItem("duvet_refresh_token", resData.session_token);
		}
		markSessionRefreshed();
		return newToken;
	} catch (refreshError) {
		if (refreshError instanceof RefreshFailedError && (refreshError.status === 401 || refreshError.status === 403)) {
			accessToken.set(null);
			localStorage.removeItem("duvet_session_token");
			window.location.replace(route("/sign-in.html")); // the packaged app only has the .html
		}
		throw refreshError;
	}
}

/** Renews the session before it expires: checked as the app starts, every 10 minutes and whenever
 * the app comes back into view (timers don't run while the computer sleeps), each with its own age
 * (renewalDue). Open the gateway connection once `ready` settles: at once, unless the tokens are in
 * their last hour (renewalFirst), which the gateway would refuse; then once they're renewed. A
 * renewal due otherwise as the app starts waits for `connected` (the app is up), as the gateway
 * follows a connection through a renewal, where a renewal mid-identify would fail it (#281). */
export function keepSessionFresh(): { ready: Promise<void>; connected: () => void; stop: () => void } {
	// The main window keeps the session fresh for every window: another one checks nothing.
	if (!windowRenewsSession(currentShell().window)) {
		return { ready: Promise.resolve(), connected: () => {}, stop: () => {} };
	}
	// And renews when another window asks: one whose request the API refused, while this one saw no reason to yet.
	answerWindows(SESSION_CHANNEL, { renew: () => refreshSession().then(() => true) });
	const check = async (when: SessionCheck) => {
		if (!localStorage.getItem("duvet_refresh_token")) return;
		const refreshedAt = Number(localStorage.getItem(REFRESHED_AT_KEY)) || 0;
		if (!renewalDue(when, refreshedAt, Date.now())) return;
		await refreshSession().catch((err) => console.error("[API] Session refresh ahead of expiry failed:", err));
	};
	const onVisible = () => {
		if (!document.hidden) void check("visible");
	};
	const refreshedAt = Number(localStorage.getItem(REFRESHED_AT_KEY)) || 0;
	const first = renewalFirst(refreshedAt, Date.now());
	const ready = first ? check("start") : Promise.resolve();
	let startChecked = first;
	const timer = setInterval(() => void check("tick"), 10 * 60 * 1000);
	document.addEventListener("visibilitychange", onVisible);
	return {
		ready,
		connected: () => {
			if (startChecked) return;
			startChecked = true;
			void check("start");
		},
		stop: () => {
			clearInterval(timer);
			document.removeEventListener("visibilitychange", onVisible);
		},
	};
}

const buildFetchResponse = async (res: Response): Promise<FetchResponse> => {
	let responseData = null;
	const contentType = res.headers.get("Content-Type");
	if (contentType && contentType.includes("application/json")) {
		responseData = await res.json().catch(() => null);
	} else {
		responseData = await res.text().catch(() => null);
	}
	return {
		data: responseData,
		status: res.status,
		statusText: res.statusText,
		headers: res.headers,
	};
};

/** A session's tokens, as a login gives them: its access token and its session token. */
export interface SessionTokens {
	token: string;
	sessionToken: string | null;
}

/** `given`: another session's tokens, whose requests go as the app's do but for the app's session renewal, which a
 * 401 of theirs leaves alone. Without them, the session the app keeps. */
const coreFetch = async <T = any>(
	endpoint: string,
	options: FetchRequestConfig = {},
	given?: SessionTokens,
): Promise<FetchResponse<T>> => {
	// A form, or a Blob's bytes (a sealed part, a day of the backup), goes up through XMLHttpRequest, which gives up an
	// upload that stalls (sendForm) and reports how far it is; the rest through fetch, given up when its answer doesn't
	// come in time (fetchWithin).
	const upload = options.data instanceof FormData || options.data instanceof Blob ? options.data : null;
	const bytes = upload instanceof FormData ? formBytes(upload) : (upload?.size ?? 0);
	if (bytes > MAX_REQUEST_BYTES) throw new TooLargeError(bytes);
	const send = (url: string, init: RequestInit): Promise<Response> =>
		upload
			? sendForm(url, init, upload, bytes, options.onUploadProgress)
			: fetchWithin(url, init, options.answerMs ?? requestLimits.answerMs);

	// The session storage holds is another account's once another page switched accounts (#612).
	if (!given && !ownSession()) return neverAnswered();
	const token = given ? given.token : get(accessToken) || localStorage.getItem("duvet_session_token");
	const sessionToken = given ? given.sessionToken : localStorage.getItem("duvet_refresh_token");

	const headers = new Headers(options.headers);
	// What the app is: the API takes encryption's routes and a conversation's only from a client that has it (426).
	headers.set("X-Duvet-Client", duvetClient());
	if (token) headers.set("Authorization", `Bearer ${token}`);
	if (sessionToken) headers.set("X-Session-Token", sessionToken);

	const fetchOptions: RequestInit = {
		...options,
		headers,
		// Another session's requests carry none of the app's cookies, which name the app's own session.
		credentials: given ? "omit" : "include",
	};

	if (options.data !== undefined) {
		if (!headers.has("Content-Type") && !(upload instanceof FormData)) {
			headers.set("Content-Type", upload ? "application/octet-stream" : "application/json");
		}
		fetchOptions.body = upload ?? JSON.stringify(options.data);
	}

	let url = endpoint.startsWith("http") ? endpoint : `${getHostURL()}${endpoint}`;
	if (options.params) {
		const urlObj = new URL(url);
		Object.entries(options.params).forEach(([key, value]) => {
			if (value !== undefined && value !== null && value !== "") {
				urlObj.searchParams.append(key, String(value));
			}
		});
		url = urlObj.toString();
	}

	if (import.meta.env.DEV) console.log(`[duvet-api] Requesting: ${url}`);

	let response = await send(url, fetchOptions);

	if (!response.ok) {
		const fetchResp = await buildFetchResponse(response);

		if (response.status === 401 && !options._retry && !given) {
			options._retry = true;
			// Sent before a refresh that has finished since: retry with its tokens. Refreshing again
			// would revoke them under the requests already retrying with them.
			const current = get(accessToken) || localStorage.getItem("duvet_session_token");
			const newToken = current && current !== token ? current : await refreshSession(token);
			// The main window's renewal another window took may be another account's (#612).
			if (!ownSession()) return neverAnswered();
			headers.set("Authorization", `Bearer ${newToken}`);
			const newSessionToken = localStorage.getItem("duvet_refresh_token");
			if (newSessionToken) headers.set("X-Session-Token", newSessionToken);
			const retryResponse = await send(url, { ...fetchOptions, headers });
			const parsedRetry = await buildFetchResponse(retryResponse);
			if (!retryResponse.ok) throw refusal(parsedRetry, options);
			return parsedRetry;
		}

		return Promise.reject(refusal(fetchResp, options));
	}

	return buildFetchResponse(response);
};

/** The requests of a session: the one the app keeps without `given`. */
const clientOf = (given?: SessionTokens): ApiClient => ({
	get: (url, config) => coreFetch(url, { ...config, method: "GET" }, given),
	delete: (url, config) => coreFetch(url, { ...config, method: "DELETE" }, given),
	head: (url, config) => coreFetch(url, { ...config, method: "HEAD" }, given),
	options: (url, config) => coreFetch(url, { ...config, method: "OPTIONS" }, given),
	post: (url, data, config) => coreFetch(url, { ...config, method: "POST", data }, given),
	put: (url, data, config) => coreFetch(url, { ...config, method: "PUT", data }, given),
	patch: (url, data, config) => coreFetch(url, { ...config, method: "PATCH", data }, given),
});

const api: ApiClient = clientOf();

export default api;

/** The requests of a session the app doesn't keep (an encryption engine's in the live tests, one per account), sent
 * as the app sends its own: X-Duvet-Client, the API's refusals as their errors, and the same time limits. */
export const sessionApi = (tokens: SessionTokens): ApiClient => clientOf(tokens);

export function getApiError(err: unknown, fallback: string): string {
	if (err instanceof FetchError && err.response?.data?.error) {
		const reason: unknown = err.response.data.error;
		// The API's own words, but for the few texts that say what the app never does (error-wording.ts).
		return typeof reason === "string" ? inAppWords(reason, fallback) : err.response.data.error;
	}
	// A TypeError that is neither the network's (NetworkError) nor a lost answer's (NoAnswerError) is the engine's, in
	// its own English ("Cannot read properties of undefined"): what the caller was doing says more.
	if (err instanceof TypeError && !(err instanceof NetworkError) && !(err instanceof NoAnswerError)) return fallback;
	if (err instanceof Error) return err.message;
	return fallback;
}
