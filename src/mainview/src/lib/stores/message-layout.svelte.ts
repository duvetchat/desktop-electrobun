import { defaultMessageLayout, MESSAGE_LAYOUT_KEY, parseMessageLayout, type MessageLayout } from "$lib/message-layout";

function readSaved(): MessageLayout {
	if (typeof localStorage === "undefined") return defaultMessageLayout();
	try {
		return parseMessageLayout(localStorage.getItem(MESSAGE_LAYOUT_KEY));
	} catch {
		return defaultMessageLayout();
	}
}

let layout = $state(readSaved());

/** How chats draw their messages: every message list reads `value`, and the appearance settings set it. A change is
 * saved at once, and shows in every chat on screen. */
export const messageLayout = {
	get value(): MessageLayout {
		return layout;
	},
	set value(next: MessageLayout) {
		layout = next;
		try {
			localStorage.setItem(MESSAGE_LAYOUT_KEY, next);
		} catch {
			// no storage (private mode, or a full quota): the choice lasts until the app closes
		}
	},
};
