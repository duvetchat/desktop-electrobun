import type { TypingUser } from "$lib/stores.svelte";

/** How long a notice of someone typing or recording shows with nothing after it. */
export const TYPING_TIMEOUT = 5000;

/** How often the user's own notice goes out to a chat, at most: the API lets one through every 2 s per user and chat. */
export const NOTICE_INTERVAL = 3000;

/** The notice the user last sent a chat: when, and whether it said they were recording a voice message. */
export interface SentNotice {
	at: number;
	recording: boolean;
}

/**
 * Whether the user's notice of typing, or of recording a voice message, goes out to a chat now: at most every
 * NOTICE_INTERVAL in each chat, as the API's limit is per user and chat, but at once when typing turns into recording
 * or back. One that goes is recorded in sent, by chat.
 */
export function noticeDue(sent: Map<string, SentNotice>, chatId: string, recording: boolean, now: number): boolean {
	const last = sent.get(chatId);
	if (last && now - last.at < NOTICE_INTERVAL && last.recording === recording) return false;
	sent.set(chatId, { at: now, recording });
	return true;
}

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
	if (users.length === 1) return `${nameOf(users[0]!)} is typing`;
	if (users.length === 2) return `${nameOf(users[0]!)} and ${nameOf(users[1]!)} are typing`;
	return "Several people are typing";
}

export function recordingPhrase(users: TypingUser[]): string {
	if (users.length === 1) return `${nameOf(users[0]!)} is recording a voice note`;
	if (users.length === 2) return `${nameOf(users[0]!)} and ${nameOf(users[1]!)} are recording voice notes`;
	return "Several people are recording voice notes";
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
