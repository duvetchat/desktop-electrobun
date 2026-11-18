// What the sign-in pages decide before they ask the API (#357): whether a username, an email or a password reads
// right, which of sign-up's fields show, what the mascot does while a field is typed in, and where a page goes on to.
// The pages (routes/(auth)) draw it; nothing here touches the wire.

/** A password's shortest length, as the API's. */
export const PASSWORD_MIN = 8;

/** The same rule the mobile app checks before it asks the server: letters, numbers, dots and _, 2 to 32. */
export function usernameValid(username: string): boolean {
	return /^[a-zA-Z0-9_.]{2,32}$/.test(username.trim());
}

/** Whether it reads as an address: something, an @, something with a dot in it. The API has the last word. */
export function emailValid(email: string): boolean {
	return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
}

export interface SignUpForm {
	username: string;
	email: string;
	password: string;
	confirmPassword: string;
	acceptTerms: boolean;
}

/**
 * How many of sign-up's steps show, 1 to 4: the names; then the email once the username reads right; the password
 * once the email does; the confirmation, the terms and the button once the password is long enough. Breaking an
 * earlier answer hides the later steps again.
 */
export function signUpSteps(form: Pick<SignUpForm, "username" | "email" | "password">): number {
	if (!usernameValid(form.username)) return 1;
	if (!emailValid(form.email)) return 2;
	return form.password.length >= PASSWORD_MIN ? 4 : 3;
}

/** Whether "Create my account" can be pressed: every field filled, the passwords the same, the terms agreed to. */
export function canSignUp(form: SignUpForm): boolean {
	return (
		!!form.username.trim() &&
		!!form.email.trim() &&
		!!form.password &&
		!!form.confirmPassword &&
		form.password === form.confirmPassword &&
		form.acceptTerms
	);
}

/** Whether a new password can be saved: long enough, and typed the same twice. */
export function canResetPassword(password: string, confirmPassword: string): boolean {
	return password.length >= PASSWORD_MIN && password === confirmPassword;
}

/** The field the mascot watches: a text one, a password one, or none. */
export type FocusedField = "text" | "secret" | null;

/**
 * Awake: eyes open, looking toward `look`. Shy: eyes shut, while a password is typed. Peek: one eye open, while the
 * password is shown.
 */
export type MascotMood = "awake" | "shy" | "peek";

export function mascotMood(focused: FocusedField, passwordShown: boolean): MascotMood {
	return focused === "secret" ? (passwordShown ? "peek" : "shy") : "awake";
}

/** Where the mascot looks, -1 (left) to 1 (right): along a text field as its text grows, up to 28 characters. */
export function mascotLook(focused: FocusedField, typed: number): number {
	return focused === "text" ? Math.min(Math.max(typed, 0), 28) / 14 - 1 : 0;
}

/**
 * The `?redirect=` of a page's address, for the link to the other form: signing in and creating an account go on
 * to the same page (an invite's). Empty without one.
 */
export function redirectQuery(search: string): string {
	const redirect = new URLSearchParams(search).get("redirect");
	return redirect ? `?redirect=${encodeURIComponent(redirect)}` : "";
}
