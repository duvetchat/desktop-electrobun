import type { TypingUser } from "$lib/stores.svelte";

/** How long a notice of someone typing or recording shows with nothing after it. */
export const TYPING_TIMEOUT = 5000;

/**
 * Who shows as typing or recording in each chat at a moment: everyone but the user, until their notice gets old,
 * which no event says; and when the next of them ends, or null when nobody shows.
 */
export function typersAt(
	notices: Record<string, TypingUser[]>,
	me: string | undefined,
	now: number,
): { typers: Record<string, TypingUser[]>; nextEnd: number | null } {
	const typers: Record<string, TypingUser[]> = {};
	let nextEnd: number | null = null;
	for (const [chatId, users] of Object.entries(notices)) {
		const shown = users.filter((u) => u.user_id !== me && now - u.timestamp < TYPING_TIMEOUT);
		if (shown.length === 0) continue;
		typers[chatId] = shown;
		for (const u of shown) nextEnd = Math.min(nextEnd ?? Infinity, u.timestamp + TYPING_TIMEOUT);
	}
	return { typers, nextEnd };
}

const nameOf = (u: Pick<TypingUser, "alias" | "username">) => u.alias ?? u.username;

export function typingPhrase(users: TypingUser[]): string {
	if (users.length === 1) return `${nameOf(users[0])} is typing`;
	if (users.length === 2) return `${nameOf(users[0])} and ${nameOf(users[1])} are typing`;
	return "Several people are typing";
}

export function recordingPhrase(users: TypingUser[]): string {
	if (users.length === 1) return `${nameOf(users[0])} is recording a voice message`;
	if (users.length === 2) return `${nameOf(users[0])} and ${nameOf(users[1])} are recording voice messages`;
	return "Several people are recording voice messages";
}

/** What a chat's row says of those typing and recording there, as the mobile app has it; null with nobody. */
export function typingSentence(users: TypingUser[] | undefined): string | null {
	if (!users?.length) return null;
	const typing = users.filter((u) => !u.recording);
	const recording = users.filter((u) => u.recording);
	return [
		...(typing.length ? [`${typingPhrase(typing)}…`] : []),
		...(recording.length ? [recordingPhrase(recording)] : []),
	].join(" · ");
}
