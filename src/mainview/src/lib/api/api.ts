import { getHostURL, route } from "$lib/common/common";
import { accessToken } from "$lib/stores/auth";
import { get } from "svelte/store";

export interface FetchRequestConfig extends Omit<RequestInit, "body"> {
	params?: Record<string, string | number | boolean>;
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

let isRefreshing = false;
let failedQueue: Array<{ resolve: (value: any) => void; reject: (reason?: any) => void }> = [];

const processQueue = (error: any, token: string | null = null) => {
	failedQueue.forEach((prom) => {
		if (error) {
			prom.reject(error);
		} else {
			prom.resolve(token);
		}
	});
	failedQueue = [];
};

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
			if (isRefreshing) {
				return new Promise<string>((resolve, reject) => {
					failedQueue.push({ resolve, reject });
				})
					.then((newToken) => {
						headers.set("Authorization", `Bearer ${newToken}`);
						fetchOptions.headers = headers;
						return fetch(url, fetchOptions).then(buildFetchResponse);
					})
					.catch((err) => Promise.reject(err));
			}

			options._retry = true;
			isRefreshing = true;

			return new Promise(async (resolve, reject) => {
				try {
					console.log("[API] Critical Refresh - Single Instance Only");

					const refreshHeaders = new Headers();
					const currentSessionToken = localStorage.getItem("duvet_refresh_token");
					if (currentSessionToken) {
						refreshHeaders.set("X-Session-Token", currentSessionToken);
					}

					const res = await fetch(`${getHostURL()}/api/auth/refresh`, {
						method: "POST",
						credentials: "include",
						headers: refreshHeaders,
					});

					if (!res.ok) throw new Error("Refresh token request failed");

					const resData = await res.json();
					const newToken = resData.token;

					accessToken.set(newToken);
					localStorage.setItem("duvet_session_token", newToken);
					if (resData.session_token) {
						localStorage.setItem("duvet_refresh_token", resData.session_token);
					}

					headers.set("Authorization", `Bearer ${newToken}`);
					fetchOptions.headers = headers;
					processQueue(null, newToken);

					const retryResponse = await fetch(url, fetchOptions);
					const parsedRetry = await buildFetchResponse(retryResponse);

					if (!retryResponse.ok) {
						reject(new FetchError(`Request failed with status ${retryResponse.status}`, options, parsedRetry));
					} else {
						resolve(parsedRetry);
					}
				} catch (refreshError: any) {
					processQueue(refreshError, null);

					accessToken.set(null);
					localStorage.removeItem("duvet_session_token");

					window.location.replace(route("/sign-in"));
					reject(refreshError);
				} finally {
					isRefreshing = false;
				}
			});
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
