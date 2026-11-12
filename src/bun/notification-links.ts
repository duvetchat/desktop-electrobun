/** A message a notification opens, as the webview's MessageLink (lib/urls.ts) has it: a conversation's has no room. */
export interface NotificationLink {
	spaceId: string;
	roomId: string;
	conversationId?: string;
	messageId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The link a notification opens through the channel's scheme (notification-setup.ts): duvet…://open/?… */
export function openUrl(scheme: string, link: NotificationLink): string {
	const query = link.conversationId
		? new URLSearchParams({ conversation: link.conversationId })
		: new URLSearchParams({ space: link.spaceId, room: link.roomId });
	if (link.messageId) query.set("message", link.messageId);
	return `${scheme}://open/?${query}`;
}

/**
 * The message a link opens, or null. Any process on the computer can hand one to the forwarder or the pipe, so only
 * the scheme's own open link counts, with or without the slash Windows adds after it, and only with IDs that are
 * UUIDs: a room's with its Space, or a conversation's, and a message or none.
 */
export function parseOpenUrl(url: string, scheme: string): NotificationLink | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (parsed.protocol !== `${scheme}:` || parsed.hostname !== "open") return null;
	if (parsed.pathname !== "" && parsed.pathname !== "/") return null;
	const query = parsed.searchParams;
	const message = query.get("message");
	if (message !== null && !UUID.test(message)) return null;
	const messageId = message === null ? {} : { messageId: message };
	const conversation = query.get("conversation");
	if (conversation !== null) {
		return UUID.test(conversation) ? { spaceId: "", roomId: "", conversationId: conversation, ...messageId } : null;
	}
	const space = query.get("space") ?? "";
	const room = query.get("room") ?? "";
	return UUID.test(space) && UUID.test(room) ? { spaceId: space, roomId: room, ...messageId } : null;
}
