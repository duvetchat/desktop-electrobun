import api, { markSessionRefreshed, requestLimits } from "$lib/api/api";
import { route } from "$lib/common/common";
import { accessToken } from "$lib/stores/auth";
import { inAppWords } from "$lib/api/error-wording";

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

export async function resetPassword(token: string, password: string) {
	try {
		await api.post("/api/auth/reset-password", { token, password });
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
			throw new Error("Server did not return a valid token");
		}
	} catch (err: any) {
		console.log(err);
		throw new Error(reason(err, "Couldn't sign you in. Try again."), { cause: err });
	}
}
