import axios from "axios";
import { getHostURL, route } from "$lib/common/common";
import { accessToken } from "$lib/stores/auth";
import { get } from "svelte/store";

const api = axios.create({
	baseURL: getHostURL(),
	withCredentials: true,
});

let isRefreshing = false;
let failedQueue: any[] = [];

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

api.interceptors.request.use((config) => {
	const token = get(accessToken) || localStorage.getItem("duvet_session_token");
	if (token) {
		config.headers.Authorization = `Bearer ${token}`;
	}
	const sessionToken = localStorage.getItem("duvet_refresh_token");
	if (sessionToken) {
		config.headers["X-Session-Token"] = sessionToken;
	}
	return config;
});

api.interceptors.response.use(
	(response) => response,
	async (error) => {
		const originalRequest = error.config;

		if (!originalRequest || (error.response?.status === 401 && originalRequest._retry)) {
			return Promise.reject(error);
		}

		if (error.response?.status === 401) {
			if (isRefreshing) {
				return new Promise((resolve, reject) => {
					failedQueue.push({ resolve, reject });
				})
					.then((token) => {
						originalRequest.headers.Authorization = `Bearer ${token}`;
						return api(originalRequest);
					})
					.catch((err) => Promise.reject(err));
			}

			originalRequest._retry = true;
			isRefreshing = true;

			return new Promise(async (resolve, reject) => {
				try {
					console.log("[API] Critical Refresh - Single Instance Only");

					const refreshHeaders: Record<string, string> = {};
					const currentSessionToken = localStorage.getItem("duvet_refresh_token");
					if (currentSessionToken) {
						refreshHeaders["X-Session-Token"] = currentSessionToken;
					}

					const res = await axios.post(
						`${getHostURL()}/api/auth/refresh`,
						{},
						{
							withCredentials: true,
							headers: refreshHeaders,
						},
					);

					const newToken = res.data.token;

					accessToken.set(newToken);
					localStorage.setItem("duvet_session_token", newToken);
					if (res.data.session_token) {
						localStorage.setItem("duvet_refresh_token", res.data.session_token);
					}

					originalRequest.headers.Authorization = `Bearer ${newToken}`;
					processQueue(null, newToken);

					resolve(api(originalRequest));
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
		return Promise.reject(error);
	},
);

export default api;
