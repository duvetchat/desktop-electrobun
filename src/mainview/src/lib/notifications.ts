/** How a message notifies: not at all, with Duvet's own notice, or with the system's notification. */
export type NotificationKind = "none" | "notice" | "system";

export interface NotificationInput {
	/** The author is the user. */
	own: boolean;
	/** One of Duvet's notices (a pin's, a call's) or an ephemeral message. */
	notice: boolean;
	/** The place's level (lib/notification-levels.ts): 0 every message, 1 only mentions, 2 nothing. */
	level: 0 | 1 | 2;
	/** The message mentions the user. */
	mention: boolean;
	/** The user's status is do not disturb. */
	dnd: boolean;
	/** Duvet's window is visible and focused (pageVisible). */
	focused: boolean;
	/** A pane shows the message's chat (lib/on-screen.ts). */
	onScreen: boolean;
	/** A system notification can show here: the app on Windows, the web with the browser's permission. */
	system: boolean;
}

/**
 * What a message notifies (DISENO-NOTIFICACIONES.md, objectives 3 to 5 and 9): nothing for the user's own messages,
 * Duvet's notices, do not disturb or a place at nothing, and at only mentions, nothing but a mention. Otherwise, with
 * Duvet focused, its notice for another chat and nothing for the chat on screen; without the focus, the system's
 * notification where there is one, else Duvet's notice.
 */
export function notificationKind(i: NotificationInput): NotificationKind {
	if (i.own || i.notice || i.dnd || i.level === 2 || (i.level === 1 && !i.mention)) return "none";
	if (i.focused) return i.onScreen ? "none" : "notice";
	return i.system ? "system" : "notice";
}
