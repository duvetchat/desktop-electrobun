// What this device's own database holds of a conversation's messages (PLAN-E2E-CLIENTES.md, «La vista de una
// conversación»): the core's rows by the API's IDs, its own messages still being sent, and which of the API's rows a
// conversation draws. The API lists a conversation's messages; their text and files come from here.
import type { CoreHost } from "../host";

/**
 * A message as the core shows it (its `messages`): `waiting` while its copy couldn't be opened, `pending` while it's this
 * device's own still being sent. Times are Unix milliseconds; a message without text (a sticker, a file alone) has none.
 */
export interface ShownMessage {
	conversation_id: string;
	message_id: string | null;
	/** This device's own message's nonce. */
	nonce?: string;
	seq: number | null;
	user_id: string;
	device_id: string;
	sent_at: number;
	edited_at: number | null;
	status: "ok" | "waiting" | "pending";
	text: string | null;
	attachments: unknown[];
	/** Who shared it with this device, when a shared history brought it. */
	shared_by: string | null;
	reply_to: string | null;
}

/** What the core holds of a row: undefined while it hasn't been asked, null when it doesn't hold it. */
export type Held = ShownMessage | null | undefined;

/**
 * What a view reads of one conversation's messages on this device: the row the core holds of each, the text the person
 * typed of their own just sent (until its row is there), and how far the engine applied the conversation's queue (null
 * while it hasn't this session). Never what the API writes in a message.
 */
export interface MessageContent {
	held(id: string): Held;
	typed(id: string): string | undefined;
	through(): number | null;
}

/** The row the core holds of a message, to draw as it: one sent by the author the API names, opened. */
export function shownOf(content: MessageContent, id: string, author: string): ShownMessage | null {
	const row = content.held(id);
	return row?.status === "ok" && row.user_id === author ? row : null;
}

/** The most IDs one `messages` takes. */
const IDS_MOST = 200;

/** The core's rows of these messages of the conversation: none for one it doesn't hold, or one deleted. */
export async function shownMessages(host: CoreHost, conversationId: string, ids: string[]): Promise<ShownMessage[]> {
	const shown: ShownMessage[] = [];
	for (let at = 0; at < ids.length; at += IDS_MOST) {
		const { messages } = await host.handle<{ messages: ShownMessage[] }>({
			...{ cmd: "messages", conversation_id: conversationId, ids: ids.slice(at, at + IDS_MOST) },
		});
		shown.push(...messages);
	}
	return shown;
}

/** This device's own messages of the conversation still being sent, in the order they were made. */
export async function pendingRows(host: CoreHost, conversationId: string): Promise<ShownMessage[]> {
	// A page lists them first, the newest first.
	const { messages } = await host.handle<{ messages: ShownMessage[] }>({
		...{ cmd: "messages", conversation_id: conversationId, limit: 100 },
	});
	return messages.filter((message) => message.status === "pending").reverse();
}

/** Whether the device holds a row of the conversation older than this number: the list pages on to it (Ruling 15). */
export async function heldBefore(host: CoreHost, conversationId: string, seq: number): Promise<boolean> {
	const { messages } = await host.handle<{ messages: ShownMessage[] }>({
		...{ cmd: "messages", conversation_id: conversationId, before: seq, limit: 1 },
	});
	return messages.length > 0;
}

/**
 * The rows a conversation draws (Ruling 15): an encrypted row from before the user joined it (its ID below their
 * membership's) that this device doesn't hold goes, and the one notice above the chat says why (`beforeJoining`). A
 * notice of the server's, a row since, and one the device holds (shared with it) stay. Without the membership, all stay.
 */
export function drawnRows<T extends { id: string; seq?: number }>(
	rows: T[],
	joinedAs: string | undefined,
	held: (id: string) => Held,
): { rows: T[]; beforeJoining: boolean } {
	if (!joinedAs) return { rows, beforeJoining: false };
	const drawn = rows.filter((row) => row.seq === undefined || row.id > joinedAs || !!held(row.id));
	return drawn.length === rows.length ? { rows, beforeJoining: false } : { rows: drawn, beforeJoining: true };
}
