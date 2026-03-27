import axios from 'axios';
import { getHostURL, route } from "$lib/common/common";
import { accessToken } from "$lib/stores/auth";
import { get } from 'svelte/store';

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
    const token = get(accessToken);
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
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
                    
                    const res = await axios.post(`${getHostURL()}/api/auth/refresh`, {}, { 
                        withCredentials: true 
                    });
                    
                    const newToken = res.data.token;
                    
                    accessToken.set(newToken);
                    localStorage.setItem("duvet_session_token", newToken);

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
    }
);

export default api;