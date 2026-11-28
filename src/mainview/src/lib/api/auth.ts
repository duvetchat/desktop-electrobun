import api, { markSessionRefreshed, requestLimits } from "$lib/api/api";
import { getHostURL } from "$lib/common/common";
import { route } from "$lib/common/common";
import { accessToken } from "$lib/stores/auth";
import { inAppWords } from "$lib/api/error-wording";
import { forgetUser } from "$lib/e2e/client";
import { t } from "$lib/i18n";

/** Why the API refused, in the app's words (error-wording.ts), or the page's own message when it didn't say: the
 * sign-in pages show it as it comes. */
function reason(err: any, fallback: string): string {
	const said: unknown = err?.response?.data?.error;
	return typeof said === "string" && said ? inAppWords(said, fallback) : fallback;
}

// The routes that send an email answer once it's sent, which the API gives 40 s at most (#217).
const sendsEmail = { answerMs: requestLimits.slowAnswerMs };

export async function signIn(options: { username: string; alias: string | null; password: string; email: string }) {
	try {
		await api.post("/api/auth/signin", options, sendsEmail);
	} catch (err: any) {
		// The API's reason stands alone ("That username is taken"); without one, what was tried and what went wrong.
		const said: unknown = err.response?.data?.error;
		const why =
			typeof said === "string" && said
				? inAppWords(said, t("error_sign_up_failed"))
				: t("error_sign_up_failed_because", { reason: err.message });
		throw new Error(why, { cause: err });
	}
}

export async function verifyEmail(token: string) {
	try {
		await api.post("/api/auth/verify", { token });
	} catch (err: any) {
		throw new Error(reason(err, t("error_email_verification_failed")), { cause: err });
	}
}

export async function sendVerificationEmail() {
	try {
		await api.post("/api/auth/verify/send", undefined, sendsEmail);
	} catch (err: any) {
		throw new Error(reason(err, t("error_verification_email_not_sent")), { cause: err });
	}
}

/** A new password, which ends every session; with `removeDevices`, every device of the user's goes too (decision 13). */
export async function resetPassword(token: string, password: string, removeDevices = false) {
	try {
		await api.post("/api/auth/reset-password", { token, password, ...(removeDevices ? { remove_devices: true } : {}) });
	} catch (err: any) {
		throw new Error(reason(err, t("error_password_reset_failed")), { cause: err });
	}
}

export async function forgotPassword(email: string) {
	try {
		await api.post("/api/auth/forgot-password", { email }, sendsEmail);
	} catch (err: any) {
		throw new Error(reason(err, t("error_reset_email_not_sent")), { cause: err });
	}
}

export async function sendResetPasswordEmail() {
	try {
		await api.post("/api/auth/reset-password/send", undefined, sendsEmail);
	} catch (err: any) {
		throw new Error(reason(err, t("error_reset_password_email_not_sent")), { cause: err });
	}
}

export async function changeEmail(token: string, email: string) {
	try {
		await api.post("/api/auth/change-email", { token, email });
	} catch (err: any) {
		throw new Error(reason(err, t("error_email_change_failed")), { cause: err });
	}
}

export async function sendChangeEmail(email: string) {
	try {
		await api.post("/api/auth/change-email/send", { email }, sendsEmail);
	} catch (err: any) {
		throw new Error(reason(err, t("error_email_change_not_sent")), { cause: err });
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

/** The API's tokens for an email and password, without changing the session this page has. */
async function logInRequest(options: { password: string; email: string }): Promise<any> {
	try {
		const res = await api.post("/api/auth/login", options);
		if (res.data && res.data.token) return res.data;
		// For the log alone: the catch below shows the page's own message.
		throw new Error("Server did not return a valid token");
	} catch (err: any) {
		console.log(err);
		throw new Error(reason(err, t("error_sign_in_failed")), { cause: err });
	}
}

export async function logIn(options: { password: string; email: string }) {
	const data = await logInRequest(options);
	const token = data.token;

	accessToken.set(token);
	localStorage.setItem("duvet_session_token", token);
	if (data.session_token) {
		localStorage.setItem("duvet_refresh_token", data.session_token);
	}
	markSessionRefreshed();
	// Maybe another account's session: its first identify names none of the device of whoever was here before.
	forgetUser();

	return data;
}

/** Who an account is, from /users/@me: only what the account list shows. */
export interface AccountProfile {
	id: string;
	username: string;
	alias: string | null;
	avatar: string | null;
}

function profileOf(value: unknown): AccountProfile | null {
	if (typeof value !== "object" || value === null) return null;
	const fields: Record<string, unknown> = { ...value };
	const { id, username, alias, avatar } = fields;
	if (typeof id !== "string" || typeof username !== "string") return null;
	if (!(alias === undefined || alias === null || typeof alias === "string")) return null;
	if (!(avatar === undefined || avatar === null || typeof avatar === "string")) return null;
	return { id, username, alias: alias ?? null, avatar: avatar ?? null };
}

/** An account's session for the multi-account list: its tokens and who they are, without replacing the one in use. */
export async function logInForAccount(options: {
	password: string;
	email: string;
}): Promise<{ token: string; sessionToken: string | null; user: AccountProfile }> {
	const data = await logInRequest(options);
	const token: string = data.token;
	try {
		const res = await fetch(`${getHostURL()}/api/users/@me`, {
			headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
		});
		if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
		const user = profileOf(await res.json());
		if (!user) throw new Error("The API returned no user");
		return { token, sessionToken: data.session_token ?? null, user };
	} catch (err) {
		throw new Error(reason(err, t("error_sign_in_failed")), { cause: err });
	}
}
