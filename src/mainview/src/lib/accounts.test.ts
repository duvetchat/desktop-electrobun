import { beforeEach, describe, expect, test } from "bun:test";
import {
	ACCOUNTS_KEY,
	accountForUser,
	activateAccount,
	forgetAccount,
	readAccounts,
	rememberAccount,
} from "./accounts";
import { followAccount, identifyDevice, keepDevice, keepUser } from "$lib/e2e/client";

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

	// The next page's first identify names the device this installation keeps for the account taken, and none of the
	// account it left (lib/e2e/client.ts): it identifies before READY says whose session it is.
	test("taking a saved account makes its device the one the next identify names", () => {
		keepDevice(ana.id, "device-a");
		keepUser(ana.id);
		activateAccount(ben);
		expect(identifyDevice()).toBeNull();
		keepDevice(ben.id, "device-b");
		activateAccount(ana);
		expect(identifyDevice()).toBe("device-a");
		activateAccount(ben);
		expect(identifyDevice()).toBe("device-b");
	});

	// #620's review, M5: Settings saves the account in use whenever the user changes (a USER_UPDATE about them). Once
	// another page switched to another account, storage's tokens are that account's, and saving them under this page's
	// account would have a later switch to it land on the other. Last in the file: the page it follows stays.
	test("is none once another page switched to another account", () => {
		localStorage.setItem("duvet_session_token", "access-a");
		localStorage.setItem("duvet_refresh_token", "refresh-a");
		keepUser(ana.id);
		let reloads = 0;
		followAccount(
			() => {},
			() => reloads++,
		);
		const user = { id: ana.id, username: "ana", alias: "Ana", avatar: "avatar-1" };
		expect(accountForUser(user)).toEqual(ana);
		activateAccount(ben);
		expect(accountForUser(user)).toBeNull();
		expect(reloads).toBe(1);
	});
});
