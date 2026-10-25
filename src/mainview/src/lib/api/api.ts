import { getHostURL, route } from "$lib/common/common";
import { renewalDue, renewOnceMore, type SessionCheck } from "$lib/session";
import { accessToken } from "$lib/stores/auth";
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

	let response = await fetch(url, fetchOptions);

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
			const retryResponse = await fetch(url, { ...fetchOptions, headers });
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
