import { describe, expect, test } from "bun:test";
import { FetchError } from "$lib/api/api";
import en from "../../../messages/en.json";
import { CoreError } from "./errors";
import { confirmRestart, refusalWords } from "./member-changes";

// What the person reads of a change of a conversation's members, a leave or a restart (Task 22; its review's M3 and
// M4 (c)).

/** An API's refusal, as the API client throws it. */
const refusalOf = (status: number, error: string) =>
	new FetchError(
		`Request failed with status ${status}`,
		{},
		{ status, statusText: "", headers: new Headers(), data: { error } },
	);

describe("a refusal's words", () => {
	test("the engine's and the core's are the app's own, each by its code", () => {
		const said = (code: string) => refusalWords(new CoreError(code, "the engine's own words"), "Couldn't do it");
		expect(said("too_many_members")).toBe(en.e2e_group_full);
		expect(said("unanswered")).toBe(en.e2e_change_unanswered);
		expect(said("not_ready")).toBe(en.e2e_not_ready);
		expect(said("blocked")).toBe(en.e2e_members_blocked);
		expect(said("exists")).toBe(en.e2e_already_member);
		expect(said("pending_commit")).toBe(en.e2e_change_waits);
		expect(said("not_in_group")).toBe(en.e2e_leave_elsewhere);
		// Any other of theirs, the fallback: never the engine's or the core's own English.
		expect(said("bad_command")).toBe("Couldn't do it");
	});

	test("the API's are its own, and anything else the fallback", () => {
		// As the app writes them (getApiError): their first letter up.
		expect(refusalWords(refusalOf(403, "only the group's owner adds members"), "x")).toBe(
			"Only the group's owner adds members",
		);
		expect(refusalWords("no reason", en.e2e_remove_failed)).toBe("Couldn't remove them from the group");
	});
});

describe("restarting encryption", () => {
	/** The steps, the engine's restart answering `answers` in turn; what the person was asked and told. */
	function steps(answers: (string[] | Error)[]) {
		const asked: { text: string; label: string }[] = [];
		const shown: string[] = [];
		const told: string[] = [];
		const restarts: string[][] = [];
		return {
			asked,
			shown,
			told,
			restarts,
			given: {
				restart: async (confirmed: string[]) => {
					restarts.push(confirmed);
					const answer = answers.shift()!;
					if (answer instanceof Error) throw answer;
					return answer;
				},
				nameOf: async (user: string) => ({ cy: "Cy", dee: "Dee" })[user] ?? user,
				// As the dialog does: it runs the yes, and shows what it throws.
				confirm: async (text: string, label: string, go: () => Promise<void>) => {
					asked.push({ text, label });
					await go().catch((error: unknown) => shown.push(error instanceof Error ? error.message : String(error)));
				},
				refused: (text: string) => told.push(text),
			},
		};
	}

	test("with nobody left out, it restarts at once, asking nothing", async () => {
		const { given, asked, restarts } = steps([[]]);
		await confirmRestart(given);
		expect(restarts).toEqual([[]]);
		expect(asked).toEqual([]);
	});

	test("it names whom it leaves out, and goes on the person's yes to them", async () => {
		const { given, asked, shown, restarts } = steps([["cy"], []]);
		await confirmRestart(given);
		expect(asked).toEqual([
			{ text: "Restarting leaves out Cy, who are no longer in this conversation.", label: en.e2e_blocked_restart },
		]);
		expect(restarts).toEqual([[], ["cy"]]);
		expect(shown).toEqual([]);
	});

	test("someone else left between the question and the yes: it says so, and the next tap asks again", async () => {
		const first = steps([["cy"], ["cy", "dee"]]);
		await confirmRestart(first.given);
		expect(first.restarts).toEqual([[], ["cy"]]);
		expect(first.shown).toEqual([en.e2e_members_changed]);
		const again = steps([["cy", "dee"], []]);
		await confirmRestart(again.given);
		expect(again.asked.map(({ text }) => text)).toEqual([
			"Restarting leaves out Cy and Dee, who are no longer in this conversation.",
		]);
		expect(again.restarts).toEqual([[], ["cy", "dee"]]);
	});

	test("one the core or the engine refuses says why, in the app's words", async () => {
		const refused = steps([new CoreError("rule_violation", "a reset this device can't found", { rule: "x" })]);
		await confirmRestart(refused.given);
		expect(refused.told).toEqual([en.e2e_restart_refused]);
		const notReady = steps([new CoreError("not_ready", "encrypted conversations aren't ready on this device")]);
		await confirmRestart(notReady.given);
		expect(notReady.told).toEqual([en.e2e_not_ready]);
		// Refused once the person said yes, the dialog says it.
		const late = steps([["cy"], new CoreError("rule_violation", "a reset this device can't found", { rule: "x" })]);
		await confirmRestart(late.given);
		expect(late.shown).toEqual([en.e2e_restart_refused]);
	});
});
