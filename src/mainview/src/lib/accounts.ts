// The accounts signed in on this device (#?): each keeps its own tokens, so Settings can switch between them without
// asking for a password again. Plain functions over localStorage, so the page and the settings window share them.
import { keepNextUser } from "$lib/e2e/client";

export const ACCOUNTS_KEY = "duvet.accounts.v1";
const SESSION_KEY = "duvet_session_token";
const REFRESH_KEY = "duvet_refresh_token";
const REFRESHED_KEY = "duvet_session_refreshed_at";

/** An account saved on this device: who it is, and the session that lets the app be it. */
export interface StoredAccount {
	id: string;
	/** The name the account shows: its alias, or its username. */
	name: string;
	username: string;
	avatar: string | null;
	accessToken: string;
	refreshToken: string | null;
}

/** What a user is, as the store has them, for remembering the account in use. */
export interface AccountUser {
	id: string;
	username: string;
	alias?: string | null;
	avatar?: string | null;
}

function parseAccount(value: unknown): StoredAccount | null {
	if (typeof value !== "object" || value === null) return null;
	const fields: Record<string, unknown> = { ...value };
	const { id, name, username, avatar, accessToken, refreshToken } = fields;
	if (
		typeof id !== "string" ||
		typeof name !== "string" ||
		typeof username !== "string" ||
		typeof accessToken !== "string" ||
		!(avatar === null || typeof avatar === "string") ||
		!(refreshToken === null || typeof refreshToken === "string")
	)
		return null;
	return { id, name, username, avatar, accessToken, refreshToken };
}

/** The accounts saved on this device, in the order they were added. */
export function readAccounts(): StoredAccount[] {
	try {
		const raw = localStorage.getItem(ACCOUNTS_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.flatMap((entry) => parseAccount(entry) ?? []) : [];
	} catch {
		return [];
	}
}

function writeAccounts(accounts: StoredAccount[]) {
	try {
		localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
	} catch {
		// No storage: the accounts last while this page does.
	}
}

function same(a: StoredAccount, b: StoredAccount): boolean {
	return (
		a.name === b.name &&
		a.username === b.username &&
		a.avatar === b.avatar &&
		a.accessToken === b.accessToken &&
		a.refreshToken === b.refreshToken
	);
}

/** Adds an account, or takes its latest name and tokens when it is already here. */
export function rememberAccount(account: StoredAccount): StoredAccount[] {
	const accounts = readAccounts();
	const at = accounts.findIndex((saved) => saved.id === account.id);
	if (at === -1) {
		const next = [...accounts, account];
		writeAccounts(next);
		return next;
	}
	if (same(accounts[at]!, account)) return accounts;
	const next = [...accounts];
	next[at] = account;
	writeAccounts(next);
	return next;
}

/** Forgets an account on this device: its saved tokens go; its session elsewhere is untouched. */
export function forgetAccount(id: string): StoredAccount[] {
	const next = readAccounts().filter((account) => account.id !== id);
	writeAccounts(next);
	return next;
}

/** The account in use, with the tokens in storage: null when no one is signed in. */
export function accountForUser(user: AccountUser): StoredAccount | null {
	const accessToken = localStorage.getItem(SESSION_KEY);
	if (!accessToken) return null;
	return {
		id: user.id,
		name: user.alias ?? user.username,
		username: user.username,
		avatar: user.avatar ?? null,
		accessToken,
		refreshToken: localStorage.getItem(REFRESH_KEY),
	};
}

/** Makes a saved account the one the app uses, when its next page loads. */
export function activateAccount(account: StoredAccount) {
	// As this account: its first identify names this installation's device of its own, never the one of the account it
	// leaves (lib/e2e/client.ts). Named before its tokens are written, so every page of the app that finds them finds
	// that they're another account's than its own, and sends nothing with them (#612), this one included as it goes.
	keepNextUser(account.id);
	localStorage.setItem(SESSION_KEY, account.accessToken);
	if (account.refreshToken) localStorage.setItem(REFRESH_KEY, account.refreshToken);
	else localStorage.removeItem(REFRESH_KEY);
	// The next page starts a session from now: an old rotation stamp would renew it before its time.
	localStorage.setItem(REFRESHED_KEY, String(Date.now()));
}
