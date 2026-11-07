import { describe, expect, test } from "bun:test";
import { reactorOf, reactorsToAsk, type ReactorProfile } from "$lib/reactors";

const ANA = "0190a3b2-0000-7000-8000-000000000002";
const LEFT = "0190a3b2-0000-7000-8000-000000000003";
const GONE = "0190a3b2-0000-7000-8000-000000000004";
const members = [{ id: ANA, username: "Ana", raw_username: "ana", avatar_url: "https://api.test/attachments/a" }];
const left: ReactorProfile = {
	id: LEFT,
	username: "lefty",
	alias: "Lefty",
	avatar: "0190a3b2-0000-7000-8000-00000000aaaa",
};

// Who reacted shows by the names the view knows, and the API says who anyone else is (desktop#92).
describe("reactorOf", () => {
	test("is a member as the view knows them: their name, username and avatar", () => {
		expect(reactorOf(ANA, members, new Map())).toEqual({
			id: ANA,
			name: "Ana",
			username: "ana",
			avatar: "https://api.test/attachments/a",
		});
	});

	test("is anyone else as the API gave them, by their alias", () => {
		expect(reactorOf(LEFT, members, new Map([[LEFT, left]]))).toEqual({
			id: LEFT,
			name: "Lefty",
			username: "lefty",
			avatar: "https://api.test/attachments/0190a3b2-0000-7000-8000-00000000aaaa",
		});
		expect(reactorOf(LEFT, members, new Map([[LEFT, { ...left, alias: null, avatar: null }]]))).toMatchObject({
			name: "lefty",
			avatar: null,
		});
	});

	test("is Someone, with no username, while the API is asked, and when it can't say", () => {
		const someone = { name: "Someone", username: null, avatar: null };
		expect(reactorOf(LEFT, members, new Map())).toEqual({ id: LEFT, ...someone });
		expect(reactorOf(GONE, members, new Map([[GONE, null]]))).toEqual({ id: GONE, ...someone });
	});
});

describe("reactorsToAsk", () => {
	test("is whom no member is, not asked already, in order, each once", () => {
		expect(reactorsToAsk([GONE, ANA, LEFT, GONE], members, new Set())).toEqual([GONE, LEFT]);
		expect(reactorsToAsk([GONE, ANA, LEFT], members, new Set([GONE]))).toEqual([LEFT]);
		expect(reactorsToAsk([ANA], members, new Set())).toEqual([]);
	});

	test("asks about IDs only, as they go into the request's path", () => {
		expect(reactorsToAsk(["..", "../../users/@me", "x/y", LEFT], [], new Set())).toEqual([LEFT]);
	});
});
