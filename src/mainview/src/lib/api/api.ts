import { getHostURL, route } from "$lib/common/common";
import { renewalDue, renewOnceMore, type SessionCheck } from "$lib/session";
import { accessToken } from "$lib/stores/auth";
import { formatFileSize } from "$lib/utils/format";
import { get } from "svelte/store";

export interface FetchRequestConfig extends Omit<RequestInit, "body"> {
	params?: Record<string, string | number | boolean | null | undefined>;
	data?: any;
	_retry?: boolean;
}

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

class RefreshFailedError extends Error {
	status: number;

	constructor(status: number) {
		super(`Refresh token request failed with status ${status}`);
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

/** A request refused before it's sent, as the API would refuse it: its body is over MAX_REQUEST_BYTES. Its message
 * says what was too large (what), its size and how much of it is over the limit, which a size rounded to the limit's
 * can't show. */
export class TooLargeError extends Error {
	bytes: number;

	constructor(bytes: number, what = "Files") {
		const over = formatFileSize(bytes - MAX_REQUEST_BYTES);
		super(
			`${what} too large: ${formatFileSize(bytes)}, ${over} over the ${MAX_REQUEST_BYTES / (1024 * 1024)} MB limit`,
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

/** Sends a form as fetch sends it with init, through XMLHttpRequest, whose upload progress tells an upload that stalled
 * from a slow one (fetch has none): one that stops sending for uploadLimits.idleMs, or whose answer hasn't come
 * uploadLimits.answerMs after its last byte, is aborted and fails with an UploadTimeoutError. A network error, or an
 * abort of init.signal (with its reason), fails as fetch's does. bytes is the form's size (formBytes). */
function sendForm(url: string, init: RequestInit, form: FormData, bytes: number): Promise<Response> {
	let files = 0;
	form.forEach((value) => {
		if (typeof value !== "string") files++;
	});
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
		const giveUpIn = (ms: number, why: string) => {
			if (settled) return; // an upload event after the answer
			clearTimeout(timer);
			timer = setTimeout(
				() =>
					settle(() => {
						xhr.abort();
						reject(new UploadTimeoutError(why));
					}),
				ms,
			);
		};
		// Before its first progress, an upload may still wait for a connection (HTTP/1.1 has 6 a host), and a webview may
		// report none at all: only the answer's limit applies then, from the start. From its first progress on, it may go
		// uploadLimits.idleMs without another.
		const waitForProgress = () =>
			giveUpIn(uploadLimits.idleMs, `Upload stalled: nothing went out for ${Math.round(uploadLimits.idleMs / 1000)} s`);
		const waitForAnswer = () => giveUpIn(uploadLimits.answerMs(bytes, files), "No answer to the upload in time");

		xhr.open(init.method ?? "POST", url);
		xhr.withCredentials = init.credentials === "include";
		xhr.responseType = "arraybuffer";
		new Headers(init.headers).forEach((value, name) => xhr.setRequestHeader(name, value));
		xhr.upload.onprogress = waitForProgress;
		xhr.upload.onload = waitForAnswer;
		xhr.onload = () =>
			settle(() => {
				// A status a Response can't hold (outside 200-599) fails, as fetch fails such an answer.
				try {
					resolve(responseOf(xhr));
				} catch {
					reject(new TypeError("Failed to fetch"));
				}
			});
		xhr.onerror = () => settle(() => reject(new TypeError("Failed to fetch")));
		xhr.onabort = () => settle(() => reject(new DOMException("The upload was aborted", "AbortError")));
		init.signal?.addEventListener("abort", onAbort);
		waitForAnswer();
		xhr.send(form);
	});
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

/** Rotates the session's tokens and resolves to the new access token. Concurrent callers share one
 * request, its retry included. A rejected session (401/403) signs out; rate limits, server and network
 * errors don't, and a network error goes once more first. */
export function refreshSession(): Promise<string> {
	refreshing ??= requestRefresh().finally(() => {
		refreshing = null;
	});
	return refreshing;
}

async function requestRefresh(): Promise<string> {
	const refreshHeaders = new Headers();
	const currentSessionToken = localStorage.getItem("duvet_refresh_token");
	if (currentSessionToken) {
		refreshHeaders.set("X-Session-Token", currentSessionToken);
	}
	const refresh = () =>
		fetch(`${getHostURL()}/api/auth/refresh`, {
			method: "POST",
			credentials: "include",
			headers: refreshHeaders,
		});
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

/** Renews the session before it expires: checked now, every 10 minutes and whenever the app comes
 * back into view (timers don't run while the computer sleeps), each with its own age (renewalDue).
 * `ready` settles once a renewal due right away is done: open the gateway connection after it,
 * since a refresh revokes the old access token mid-identify otherwise. */
export function keepSessionFresh(): { ready: Promise<void>; stop: () => void } {
	const check = async (when: SessionCheck) => {
		if (!localStorage.getItem("duvet_refresh_token")) return;
		const refreshedAt = Number(localStorage.getItem(REFRESHED_AT_KEY)) || 0;
		if (!renewalDue(when, refreshedAt, Date.now())) return;
		await refreshSession().catch((err) => console.error("[API] Session refresh ahead of expiry failed:", err));
	};
	const onVisible = () => {
		if (!document.hidden) void check("visible");
	};
	const ready = check("start");
	const timer = setInterval(() => void check("tick"), 10 * 60 * 1000);
	document.addEventListener("visibilitychange", onVisible);
	return {
		ready,
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

const coreFetch = async <T = any>(endpoint: string, options: FetchRequestConfig = {}): Promise<FetchResponse<T>> => {
	const form = options.data instanceof FormData ? options.data : null;
	const bytes = form ? formBytes(form) : 0;
	if (bytes > MAX_REQUEST_BYTES) throw new TooLargeError(bytes);
	// A form goes up through XMLHttpRequest, which gives up an upload that stalls (sendForm); the rest through fetch.
	const send = (url: string, init: RequestInit): Promise<Response> =>
		form ? sendForm(url, init, form, bytes) : fetch(url, init);

	const token = get(accessToken) || localStorage.getItem("duvet_session_token");
	const sessionToken = localStorage.getItem("duvet_refresh_token");

	const headers = new Headers(options.headers);
	if (token) headers.set("Authorization", `Bearer ${token}`);
	if (sessionToken) headers.set("X-Session-Token", sessionToken);

	const fetchOptions: RequestInit = {
		...options,
		headers,
		credentials: "include",
	};

	if (options.data !== undefined) {
		if (!headers.has("Content-Type") && !(options.data instanceof FormData)) {
			headers.set("Content-Type", "application/json");
		}
		fetchOptions.body = options.data instanceof FormData ? options.data : JSON.stringify(options.data);
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

		if (response.status === 401 && !options._retry) {
			options._retry = true;
			// Sent before a refresh that has finished since: retry with its tokens. Refreshing again
			// would revoke them under the requests already retrying with them.
			const current = get(accessToken) || localStorage.getItem("duvet_session_token");
			const newToken = current && current !== token ? current : await refreshSession();
			headers.set("Authorization", `Bearer ${newToken}`);
			const newSessionToken = localStorage.getItem("duvet_refresh_token");
			if (newSessionToken) headers.set("X-Session-Token", newSessionToken);
			const retryResponse = await send(url, { ...fetchOptions, headers });
			const parsedRetry = await buildFetchResponse(retryResponse);
			if (!retryResponse.ok) {
				throw new FetchError(`Request failed with status ${retryResponse.status}`, options, parsedRetry);
			}
			return parsedRetry;
		}

		return Promise.reject(new FetchError(`Request failed with status ${response.status}`, options, fetchResp));
	}

	return buildFetchResponse(response);
};

const api: ApiClient = {
	get: (url, config) => coreFetch(url, { ...config, method: "GET" }),
	delete: (url, config) => coreFetch(url, { ...config, method: "DELETE" }),
	head: (url, config) => coreFetch(url, { ...config, method: "HEAD" }),
	options: (url, config) => coreFetch(url, { ...config, method: "OPTIONS" }),
	post: (url, data, config) => coreFetch(url, { ...config, method: "POST", data }),
	put: (url, data, config) => coreFetch(url, { ...config, method: "PUT", data }),
	patch: (url, data, config) => coreFetch(url, { ...config, method: "PATCH", data }),
};

export default api;

export function getApiError(err: unknown, fallback: string): string {
	if (err instanceof FetchError && err.response?.data?.error) {
		return err.response.data.error;
	}
	if (err instanceof Error) return err.message;
	return fallback;
}
