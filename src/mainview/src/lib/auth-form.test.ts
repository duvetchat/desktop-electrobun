import { describe, expect, test } from "bun:test";
import {
	canResetPassword,
	canSignUp,
	emailValid,
	mascotLook,
	mascotMood,
	redirectQuery,
	signInMissing,
	signUpSteps,
	usernameValid,
} from "./auth-form";
import { t } from "./i18n";

describe("what reads right", () => {
	test("a username is letters, numbers, dots and _, 2 to 32", () => {
		expect(usernameValid("al")).toBe(true);
		expect(usernameValid("a.b_c9")).toBe(true);
		expect(usernameValid("a".repeat(32))).toBe(true);
		expect(usernameValid("  alice  ")).toBe(true);
		expect(usernameValid("a")).toBe(false);
		expect(usernameValid("a!")).toBe(false);
		expect(usernameValid("a b")).toBe(false);
		expect(usernameValid("a".repeat(33))).toBe(false);
		expect(usernameValid("")).toBe(false);
	});

	test("an email is something, an @ and a dotted name", () => {
		expect(emailValid("a@b.c")).toBe(true);
		expect(emailValid(" you@example.com ")).toBe(true);
		expect(emailValid("a@b")).toBe(false);
		expect(emailValid("a b@c.d")).toBe(false);
		expect(emailValid("a@@b.c")).toBe(false);
		expect(emailValid("")).toBe(false);
	});
});

describe("sign-in", () => {
	// The API answers an empty form with its validator's words ("Key: 'AuthLogInPayload.Email' Error:Field validation
	// for 'Email' failed on the 'required' tag"): the page sends none, and says what it lacks instead (#357).
	// The key of what the form says, which the page draws with t(): in the language of the moment (#464).
	const said = (email: string, password: string) => {
		const key = signInMissing(email, password);
		return key && t(key);
	};

	test("says what it lacks, and nothing once both are there", () => {
		expect(signInMissing("", "")).toBe("auth_sign_in_missing_both");
		expect(signInMissing("   ", "hunter22")).toBe("auth_sign_in_missing_email");
		expect(signInMissing("you@example.com", "")).toBe("auth_sign_in_missing_password");
		expect(signInMissing("you@example.com", "hunter22")).toBeNull();
		expect(said("", "")).toBe("Enter your email and password");
		expect(said("   ", "hunter22")).toBe("Enter your email");
		expect(said("you@example.com", "")).toBe("Enter your password");
	});

	test("a password of spaces is a password: the API says whether it is right", () => {
		expect(signInMissing("you@example.com", "   ")).toBeNull();
	});

	test("the page asks the API nothing while something is missing", async () => {
		const page = await Bun.file(new URL("../routes/(auth)/sign-in/+page.svelte", import.meta.url)).text();
		expect(page).toMatch(
			/const missing = signInMissing\(email, password\);\s*if \(missing\) \{[^}]*errorKey = missing;[^}]*return;\s*\}[\s\S]*await logIn\(/,
		);
		expect(page).toContain("{errorKey ? t(errorKey) : errorMessage}");
	});
});

// Task 24 (decision 13): for an account someone else may have used, the new password can take every device with it.
describe("a new password", () => {
	test("its page offers to remove every device, and sends what the person picked", async () => {
		const page = await Bun.file(new URL("../routes/(auth)/reset-password/+page.svelte", import.meta.url)).text();
		expect(page).toMatch(/<input[^>]*type="checkbox"[^>]*bind:checked=\{removeDevices\}/);
		expect(page).toContain('t("auth_reset_remove_devices")');
		expect(page).toContain("await resetPassword(token, password, removeDevices);");
	});
});

describe("sign-up", () => {
	test("each step shows once the one before it reads right", () => {
		expect(signUpSteps({ username: "", email: "", password: "" })).toBe(1);
		expect(signUpSteps({ username: "a!", email: "a@b.c", password: "12345678" })).toBe(1);
		expect(signUpSteps({ username: "alice", email: "", password: "" })).toBe(2);
		expect(signUpSteps({ username: "alice", email: "a@b.c", password: "1234567" })).toBe(3);
		expect(signUpSteps({ username: "alice", email: "a@b.c", password: "12345678" })).toBe(4);
	});

	test("breaking an earlier answer hides the later steps again", () => {
		expect(signUpSteps({ username: "alice", email: "a@b", password: "12345678" })).toBe(2);
	});

	const filled = {
		username: "alice",
		email: "a@b.c",
		password: "12345678",
		confirmPassword: "12345678",
		acceptTerms: true,
	};

	test("the account can be created once everything is filled, the passwords match and the terms are agreed to", () => {
		expect(canSignUp(filled)).toBe(true);
		expect(canSignUp({ ...filled, acceptTerms: false })).toBe(false);
		expect(canSignUp({ ...filled, confirmPassword: "12345679" })).toBe(false);
		expect(canSignUp({ ...filled, confirmPassword: "" })).toBe(false);
		expect(canSignUp({ ...filled, username: "   " })).toBe(false);
		expect(canSignUp({ ...filled, email: "" })).toBe(false);
	});

	test("what the API would refuse is left to the API: the button doesn't wait for a username that reads right", () => {
		expect(canSignUp({ ...filled, username: "a!" })).toBe(true);
	});
});

test("a new password is saved once it has 8 characters and its confirmation matches", () => {
	expect(canResetPassword("12345678", "12345678")).toBe(true);
	expect(canResetPassword("1234567", "1234567")).toBe(false);
	expect(canResetPassword("12345678", "12345679")).toBe(false);
	expect(canResetPassword("", "")).toBe(false);
});

describe("the mascot", () => {
	test("shuts its eyes on a password, peeks while it's shown, and is awake otherwise", () => {
		expect(mascotMood("secret", false)).toBe("shy");
		expect(mascotMood("secret", true)).toBe("peek");
		expect(mascotMood("text", false)).toBe("awake");
		expect(mascotMood("text", true)).toBe("awake");
		expect(mascotMood(null, true)).toBe("awake");
	});

	test("looks along a text field as its text grows, up to 28 characters", () => {
		expect(mascotLook("text", 0)).toBe(-1);
		expect(mascotLook("text", 14)).toBe(0);
		expect(mascotLook("text", 28)).toBe(1);
		expect(mascotLook("text", 200)).toBe(1);
		expect(mascotLook("secret", 20)).toBe(0);
		expect(mascotLook(null, 20)).toBe(0);
	});
});

test("the redirect goes on to the other form's link, encoded", () => {
	expect(redirectQuery("?redirect=%2Finvite.html%3Fcode%3Dabc")).toBe("?redirect=%2Finvite.html%3Fcode%3Dabc");
	expect(redirectQuery("?redirect=/invite?code=a b")).toBe("?redirect=%2Finvite%3Fcode%3Da%20b");
	expect(redirectQuery("?other=1")).toBe("");
	expect(redirectQuery("")).toBe("");
});
