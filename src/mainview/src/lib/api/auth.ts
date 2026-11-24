import api, { markSessionRefreshed, requestLimits } from "$lib/api/api";
import { route } from "$lib/common/common";
import { accessToken } from "$lib/stores/auth";
import { inAppWords } from "$lib/api/error-wording";
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

export async function resetPassword(token: string, password: string) {
	try {
		await api.post("/api/auth/reset-password", { token, password });
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

export async function logout() {
	try {
		await api.post("/api/auth/logout");
	} catch {
		// Best effort — clear local state regardless
	} finally {
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

			return res.data;
		} else {
			// For the log alone: the catch below shows the page's own message.
			throw new Error("Server did not return a valid token");
		}
	} catch (err: any) {
		console.log(err);
		throw new Error(reason(err, t("error_sign_in_failed")), { cause: err });
	}
}
