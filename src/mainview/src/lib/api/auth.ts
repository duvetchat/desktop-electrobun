import api, { markSessionRefreshed, requestLimits } from "$lib/api/api";
import { route } from "$lib/common/common";
import { accessToken } from "$lib/stores/auth";
import { inAppWords } from "$lib/api/error-wording";
import { forgetUser } from "$lib/e2e/client";

/** Why the API refused, in the app's words (error-wording.ts), or the page's own message when it didn't say: the
 * sign-in pages show it as it comes. */
function reason(err: any, fallback: string): string {
	const said: unknown = err?.response?.data?.error;
	return typeof said === "string" && said ? inAppWords(said, fallback) : fallback;
}

// The routes that send an email answer once it's sent, which the API gives 40 s at most (#217).
const sendsEmail = { answerMs: requestLimits.slowAnswerMs };

const SIGN_UP_FAILED = "Couldn't create your account";

export async function signIn(options: { username: string; alias: string | null; password: string; email: string }) {
	try {
		await api.post("/api/auth/signin", options, sendsEmail);
	} catch (err: any) {
		// The API's reason stands alone ("That username is taken"); without one, what was tried and what went wrong.
		const said: unknown = err.response?.data?.error;
		const why =
			typeof said === "string" && said ? inAppWords(said, SIGN_UP_FAILED) : `${SIGN_UP_FAILED}: ${err.message}`;
		throw new Error(why, { cause: err });
	}
}

export async function verifyEmail(token: string) {
	try {
		await api.post("/api/auth/verify", { token });
	} catch (err: any) {
		throw new Error(reason(err, "Verification failed"), { cause: err });
	}
}

export async function sendVerificationEmail() {
	try {
		await api.post("/api/auth/verify/send", undefined, sendsEmail);
	} catch (err: any) {
		throw new Error(reason(err, "Failed to send verification email"), { cause: err });
	}
}

/** A new password, which ends every session; with `removeDevices`, every device of the user's goes too (decision 13). */
export async function resetPassword(token: string, password: string, removeDevices = false) {
	try {
		await api.post("/api/auth/reset-password", { token, password, ...(removeDevices ? { remove_devices: true } : {}) });
	} catch (err: any) {
		throw new Error(reason(err, "Password reset failed"), { cause: err });
	}
}

export async function forgotPassword(email: string) {
	try {
		await api.post("/api/auth/forgot-password", { email }, sendsEmail);
	} catch (err: any) {
		throw new Error(reason(err, "Failed to send reset email"), { cause: err });
	}
}

export async function sendResetPasswordEmail() {
	try {
		await api.post("/api/auth/reset-password/send", undefined, sendsEmail);
	} catch (err: any) {
		throw new Error(reason(err, "Failed to send reset password email"), { cause: err });
	}
}

export async function changeEmail(token: string, email: string) {
	try {
		await api.post("/api/auth/change-email", { token, email });
	} catch (err: any) {
		throw new Error(reason(err, "Email change failed"), { cause: err });
	}
}

export async function sendChangeEmail(email: string) {
	try {
		await api.post("/api/auth/change-email/send", { email }, sendsEmail);
	} catch (err: any) {
		throw new Error(reason(err, "Failed to send email change request"), { cause: err });
	}
}

// What closes before a sign-out leaves the page: the encryption engine's core (lib/e2e/engine.svelte.ts), whose
// database stays, as signing out only ends the session (decision 13). In the desktop app it stays open in Bun otherwise.
let beforeSignOut: (() => Promise<void>) | null = null;

/** How long a sign-out waits for that close: a core call that never answers mustn't keep anyone signed in. */
export const signOutLimits = { closeMs: 3_000 };

/** Runs `close` before each sign-out leaves the page, until what it gives takes it off. */
export function onSignOut(close: () => Promise<void>): () => void {
	beforeSignOut = close;
	return () => {
		if (beforeSignOut === close) beforeSignOut = null;
	};
}

export async function logout() {
	try {
		await api.post("/api/auth/logout");
	} catch {
		// Best effort — clear local state regardless
	} finally {
		const closing = beforeSignOut?.().catch((error: unknown) =>
			console.error("[e2e] The core didn't close on sign-out:", error),
		);
		await Promise.race([closing, new Promise((resolve) => setTimeout(resolve, signOutLimits.closeMs))]);
		accessToken.set(null);
		localStorage.removeItem("duvet_session_token");
		localStorage.removeItem("duvet_refresh_token");
		window.location.href = route("/sign-in.html"); // the packaged app only has the .html
	}
}

export async function logIn(options: { password: string; email: string }) {
	try {
		const res = await api.post("/api/auth/login", options);

		if (res.data && res.data.token) {
			const token = res.data.token;

			accessToken.set(token);
			localStorage.setItem("duvet_session_token", token);
			if (res.data.session_token) {
				localStorage.setItem("duvet_refresh_token", res.data.session_token);
			}
			markSessionRefreshed();
			// Maybe another account's session: its first identify names none of the device of whoever was here before.
			forgetUser();

			return res.data;
		} else {
			throw new Error("Server did not return a valid token");
		}
	} catch (err: any) {
		console.log(err);
		throw new Error(reason(err, "Couldn't sign you in. Try again."), { cause: err });
	}
}
