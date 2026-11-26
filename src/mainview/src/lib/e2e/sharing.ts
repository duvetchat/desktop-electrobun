// What the app says of a conversation's shared history (PLAN-E2E-CLIENTES.md, Task 30; its notices: shared, shared_by,
// range_*, share_history*): how far back each range goes, what a share's notice (type 4) says, and what the person's
// share came to. In the app's words (en.json), which say the notices' table's, in the language of the moment.
import { t, type MessageKey } from "$lib/i18n";
import { formatDate, formatRelativeTime } from "$lib/i18n/format";
import { SHARE_RANGES, type ShareOutcome, type ShareRange } from "./engine/history";
import { CoreError } from "./errors";

/** Each range's words: the dialog's choices, and what a notice says of how far back. */
export const RANGE_WORDS: Record<ShareRange, MessageKey> = {
	day: "e2e_range_day",
	week: "e2e_range_week",
	month: "e2e_range_month",
	all: "e2e_range_all",
};

/**
 * What a shared history's notice says: who (its author, as the chat names them) shared how far back with whom, "you"
 * for the person reading. A range that isn't one of the four reads as the whole history, as its words' `other` does.
 */
export function sharedLine(
	author: string,
	share: { to_user_id: string; range: string },
	me: string | undefined,
	nameOf: (userId: string) => string,
): string {
	if (share.to_user_id === me) return t("e2e_shared_with_you", { a: author, range: share.range });
	return t("e2e_shared", { a: author, range: share.range, b: nameOf(share.to_user_id) });
}

/**
 * What the person is told once their share was answered (`name`: whom it went to): nothing when it went whole; that it
 * was cut, from when the member gets every message; why it didn't go.
 */
export function outcomeLine(outcome: ShareOutcome, name: string): string | null {
	if (outcome.sent) {
		if (!outcome.truncated) return null;
		return t("e2e_share_history_truncated", { name, date: formatDate(new Date(outcome.start), { dateStyle: "long" }) });
	}
	switch (outcome.why) {
		case "limit": {
			const minutes = Math.max(1, Math.ceil(outcome.retryAfterMs / 60_000));
			return t("e2e_share_history_limit", { when: formatRelativeTime(minutes, "minute") });
		}
		case "no_device":
			return t("e2e_share_history_no_device", { name });
		case "refused":
			return outcome.error ?? t("e2e_share_history_failed");
	}
}

/** The range a radio's pick names, or the one picked before when it names none (the share dialog's binding). */
export const pickedRange = (picked: string, before: ShareRange): ShareRange =>
	SHARE_RANGES.find((one) => one === picked) ?? before;

/**
 * The share dialog's Share: the person's share as far back as they picked, then what the dialog says, `done` once it
 * went (cut), so nothing more is offered; nothing when it went whole, as the dialog closes.
 */
export async function shareFromDialog(
	share: (range: ShareRange) => Promise<ShareOutcome>,
	range: ShareRange,
	name: string,
): Promise<{ text: string; done: boolean } | null> {
	try {
		const outcome = await share(range);
		const text = outcomeLine(outcome, name);
		return text === null ? null : { text, done: outcome.sent };
	} catch (error) {
		console.error("[e2e] A conversation's history wasn't shared:", error);
		const notReady = error instanceof CoreError && error.code === "not_ready";
		return { text: t(notReady ? "e2e_not_ready" : "e2e_share_history_failed"), done: false };
	}
}
