// What the person reads of a change of a conversation's members, a leave or a restart (PLAN-E2E-CLIENTES.md, Task 22):
// the engine's and the core's refusals in the app's words, the API's in its own; and the restart's question, which
// names whom it leaves out before anything goes (#46's client rule).
import { getApiError } from "$lib/api/api";
import { t, type MessageKey } from "$lib/i18n";
import { formatList } from "$lib/i18n/format";
import { CoreError } from "./errors";

/**
 * The app's words for the engine's and the core's refusals, by code: a full group, a change with no answer yet, a
 * device not ready, a group this device can't change (blocked, or not joined yet), a user in it already (the core's
 * `exists`), a change of its own still waiting for its word (`pending_commit`), and a leave from outside the group.
 */
const WORDS: Partial<Record<string, MessageKey>> = {
	too_many_members: "e2e_group_full",
	unanswered: "e2e_change_unanswered",
	not_ready: "e2e_not_ready",
	blocked: "e2e_members_blocked",
	exists: "e2e_already_member",
	pending_commit: "e2e_change_waits",
	not_in_group: "e2e_leave_elsewhere",
};

/** What a refusal says: its code's words, the API's own, or `fallback` for any other of the engine's or the core's. */
export function refusalWords(error: unknown, fallback: string): string {
	if (!(error instanceof CoreError)) return getApiError(error, fallback);
	const key = WORDS[error.code];
	return key ? t(key) : fallback;
}

/** The steps of the person's Restart encryption, as the view takes them. */
export interface RestartSteps {
	/** The engine's restart: whom it leaves out that `confirmed` doesn't name, nothing restarted while there are some. */
	restart: (confirmed: string[]) => Promise<string[]>;
	/** A user's name as the app shows it. */
	nameOf: (userId: string) => Promise<string>;
	/** The person's yes, asked in a dialog with its text and its button: `go` runs on it, and what it throws shows there. */
	confirm: (text: string, label: string, go: () => Promise<void>) => Promise<void>;
	/** Says why it didn't go. */
	refused: (text: string) => void;
}

/**
 * The person's Restart encryption (#46's client rule): whom it leaves out, those the group holds that the conversation
 * no longer has, named first, and it goes only on the person's yes; with nobody left out it goes at once. Someone else
 * left meanwhile, the dialog says the members changed, and the person's next tap asks again. A restart the core can't
 * make yet (a successor's, without a leave statement it needs), or that the engine refused, says why.
 */
export async function confirmRestart({ restart, nameOf, confirm, refused }: RestartSteps): Promise<void> {
	const go = (confirmed: string[] = []) =>
		restart(confirmed).catch((error: unknown) => {
			const words =
				error instanceof CoreError && error.code === "rule_violation"
					? t("e2e_restart_refused")
					: refusalWords(error, t("e2e_restart_refused"));
			throw new Error(words, { cause: error });
		});
	let out: string[];
	try {
		out = await go();
	} catch (error) {
		refused(error instanceof Error ? error.message : t("e2e_restart_refused"));
		return;
	}
	if (!out.length) return;
	const names = formatList(await Promise.all(out.map(nameOf)));
	await confirm(t("e2e_restart_leaves_out", { names }), t("e2e_blocked_restart"), async () => {
		if ((await go(out)).length) throw new Error(t("e2e_members_changed"));
	});
}
