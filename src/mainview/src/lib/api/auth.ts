import api from "$lib/api/api";
import { accessToken } from "$lib/stores/auth";
import { get } from "svelte/store";

export async function signIn(options: { username: string; alias: string | null; password: string; email: string }) {
	try {
		await api.post("/api/auth/signin", options);
	} catch (err: any) {
		throw new Error(`Sign-in failed: ${err.response?.data?.error || err.message}`, { cause: err });
	}
}

export async function verifyEmail(token: string) {
	try {
		await api.post("/api/auth/verify", { token });
	} catch (err: any) {
		throw new Error(err.response?.data?.error || "Verification failed", { cause: err });
	}
}

export async function sendVerificationEmail() {
	try {
		await api.post("/api/auth/verify/send");
	} catch (err: any) {
		throw new Error(err.response?.data?.error || "Failed to send verification email", { cause: err });
	}
}

export async function resetPassword(token: string, password: string) {
	try {
		await api.post("/api/auth/reset-password", { token, password });
	} catch (err: any) {
		throw new Error(err.response?.data?.error || "Password reset failed", { cause: err });
	}
}

export async function forgotPassword(email: string) {
	try {
		await api.post("/api/auth/forgot-password", { email });
	} catch (err: any) {
		throw new Error(err.response?.data?.error || "Failed to send reset email", { cause: err });
	}
}

export async function sendResetPasswordEmail() {
	try {
		await api.post("/api/auth/reset-password/send");
	} catch (err: any) {
		throw new Error(err.response?.data?.error || "Failed to send reset password email", { cause: err });
	}
}

export async function logout() {
	try {
		await api.post("/api/auth/logout");
	} catch {
		// Best effort — clear local state regardless
	} finally {
		accessToken.set(null);
		localStorage.removeItem("duvet_session_token");
		window.location.href = "/";
	}
}

export async function logIn(options: { password: string; email: string }) {
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
		console.log(err);
		const message = err.response?.data?.error || "Error al iniciar sesión";
		throw new Error(message, { cause: err });
	}
}
