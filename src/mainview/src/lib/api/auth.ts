import api from "$lib/api/api";
import { accessToken } from "$lib/stores/auth";
import { get } from "svelte/store";

export async function signIn(options: {
    username: string;
    alias: string | null;
    password: string;
    email: string;
}) {
    try {
        await api.post("/api/auth/signin", options);
    } catch (err: any) {
        throw new Error(`Sign-in failed: ${err.response?.data?.error || err.message}`);
    }
}

export async function logIn(options: {
    password: string;
    email: string;
}) {
    try {
        const res = await api.post("/api/auth/login", options);

        if (res.data && res.data.token) {
            const token = res.data.token;
            
            accessToken.set(token);
            localStorage.setItem("duvet_session_token", token);
            
            return res.data;
        } else {
            throw new Error("El servidor no devolvió un token válido");
        }
    } catch (err: any) {
        const message = err.response?.data?.error || "Error al iniciar sesión";
        throw new Error(message);
    }
}