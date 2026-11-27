import { beforeEach, describe, expect, test } from "bun:test";
import {
	ACCOUNTS_KEY,
	accountForUser,
	activateAccount,
	forgetAccount,
	readAccounts,
	rememberAccount,
} from "./accounts";

const ana = {
	id: "a1",
	name: "Ana",
	username: "ana",
	avatar: "avatar-1",
	accessToken: "access-a",
	refreshToken: "refresh-a",
};
const ben = {
	id: "b2",
	name: "Ben",
	username: "ben",
	avatar: null,
	accessToken: "access-b",
	refreshToken: null,
};

beforeEach(() => localStorage.clear());

describe("the accounts saved on a device", () => {
	test("are added once, and take their latest name and tokens", () => {
		expect(rememberAccount(ana)).toEqual([ana]);
		expect(rememberAccount(ben)).toEqual([ana, ben]);
		const renamed = { ...ana, name: "Ana María", accessToken: "access-a2", refreshToken: "refresh-a2" };
		expect(rememberAccount(renamed)).toEqual([renamed, ben]);
		expect(readAccounts()).toEqual([renamed, ben]);
	});

	test("are forgotten one at a time", () => {
		rememberAccount(ana);
		rememberAccount(ben);
		expect(forgetAccount(ana.id)).toEqual([ben]);
		expect(readAccounts()).toEqual([ben]);
	});

	test("ignore storage that isn't their list", () => {
		localStorage.setItem(ACCOUNTS_KEY, "{not json");
		expect(readAccounts()).toEqual([]);
		localStorage.setItem(ACCOUNTS_KEY, JSON.stringify([{ id: 1 }, ana]));
		expect(readAccounts()).toEqual([ana]);
	});
});

describe("the account in use", () => {
	test("is read from the session's tokens", () => {
		expect(accountForUser({ id: "a1", username: "ana" })).toBeNull();
		localStorage.setItem("duvet_session_token", "access-a");
		localStorage.setItem("duvet_refresh_token", "refresh-a");
		expect(accountForUser({ id: "a1", username: "ana", alias: "Ana", avatar: "avatar-1" })).toEqual(ana);
	});

	test("taking a saved account puts its tokens in the session's keys", () => {
		activateAccount(ana);
		expect(localStorage.getItem("duvet_session_token")).toBe("access-a");
		expect(localStorage.getItem("duvet_refresh_token")).toBe("refresh-a");
		expect(localStorage.getItem("duvet_session_refreshed_at")).not.toBeNull();
		activateAccount(ben);
		expect(localStorage.getItem("duvet_session_token")).toBe("access-b");
		expect(localStorage.getItem("duvet_refresh_token")).toBeNull();
	});
});
