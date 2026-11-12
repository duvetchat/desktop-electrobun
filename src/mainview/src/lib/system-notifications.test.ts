import { describe, expect, test } from "bun:test";
import type { MentionNotice } from "$lib/mention-notices";

// The browser's notifications, kept as they're made, and the window a click on one brings forward.
class FakeNotification {
	static made: FakeNotification[] = [];
	static permission: NotificationPermission = "granted";
	onclick: (() => void) | null = null;
	closed = false;
	constructor(
		readonly title: string,
		readonly options: NotificationOptions & { renotify?: boolean },
	) {
		FakeNotification.made.push(this);
	}
	close() {
		this.closed = true;
	}
}
let focused = 0;

// The stores' .svelte.ts modules use $state, which only Svelte's compiler knows: here it's the value itself.
Object.assign(globalThis, {
	$state: <T>(value: T) => value,
	Notification: FakeNotification,
	window: { focus: () => focused++ },
});
const { desktopNotifier, noticeText, webNotifier } = await import("$lib/system-notifications");

const ME = "01920000-0000-7000-8000-00000000b0b0";
const ROOM = "01920000-0000-7000-8000-0000000005a1";
const EMOJI = "01920000-0000-7000-8000-0000000000e1";
const link = {
	spaceId: "01920000-0000-7000-8000-0000000005a0",
	roomId: ROOM,
	messageId: "01a15f8c-0001-7000-8000-0000",
};

function notice(text: string, change: Partial<MentionNotice> = {}): MentionNotice {
	return {
		id: link.messageId,
		link,
		authorName: "Ana",
		authorAvatar: "https://api.test/attachments/a",
		where: "in #general · Alpha",
		text,
		mentionMap: { [ME]: "me" },
		customEmojiMap: { [EMOJI]: { name: "party", attachment_id: EMOJI } },
		...change,
	};
}

// A system notification shows a message's text as plain text, as Duvet's notice draws it but without its markup.
describe("a notification's text", () => {
	test("names people, rooms and custom emojis as the notice does, without markup", () => {
		const text = `**Hey** <@${ME}>, see <#${ROOM}> <:${EMOJI}:>`;
		expect(noticeText(notice(text), { [ROOM]: "general" })).toBe("Hey @me, see #general :party:");
	});

	test("keeps what others wrote as they wrote it, characters HTML escapes included", () => {
		expect(noticeText(notice('a < b & c > d "e"'), {})).toBe('a < b & c > d "e"');
	});

	test("hides a spoiler, which a notification would show to anyone looking", () => {
		expect(noticeText(notice("the end: ||he was the ghost|| !"), {})).toBe("the end: ▮▮▮ !");
	});

	test("says to click to see a message without text, as the notice does", () => {
		expect(noticeText(notice(""), {})).toBe("Click to see message");
	});
});

describe("the desktop's notifier", () => {
	// Bun answers whether the toast showed.
	const bun = (answer: () => Promise<boolean>) => {
		const sent: unknown[] = [];
		const showNotification = (request: unknown) => {
			sent.push(request);
			return answer();
		};
		return { sent, rpc: { request: { showNotification } } };
	};

	test("asks the Bun process for a toast: who, what, where, the photo, the message it opens, and its sound", async () => {
		const { sent, rpc } = bun(async () => true);
		const notifier = desktopNotifier(rpc);
		expect(notifier.available()).toBe(true);
		expect(await notifier.show(notice("Hello"), "#general · Alpha", true)).toBe(true);
		expect(sent).toEqual([
			{
				id: link.messageId,
				chatId: ROOM,
				title: "Ana",
				text: "Hello",
				place: "#general · Alpha",
				avatarUrl: "https://api.test/attachments/a",
				link,
				silent: true,
			},
		]);
	});

	test("groups a conversation's toasts by the conversation, and asks one for the system's sound", async () => {
		const { sent, rpc } = bun(async () => true);
		const dm = { spaceId: "", roomId: "", messageId: "m", conversationId: "dm-1" };
		await desktopNotifier(rpc).show(notice("Hi", { link: dm }), null, false);
		expect(sent).toEqual([expect.objectContaining({ chatId: "dm-1", silent: false })]);
	});

	// A toast that didn't show (Bun couldn't set them up, its helper failed, the request timed out) gets Duvet's notice.
	test("says a toast didn't show when Bun says so, or doesn't answer", async () => {
		expect(await desktopNotifier(bun(async () => false).rpc).show(notice("Hi"), null, true)).toBe(false);
		const timedOut = bun(() => Promise.reject(new Error("RPC request timed out.")));
		expect(await desktopNotifier(timedOut.rpc).show(notice("Hi"), null, true)).toBe(false);
	});
});

describe("the web's notifier", () => {
	// A chat's later notification replaces its earlier one (its tag), which a browser shows again only when told to.
	test("shows the browser's notification: who and where in its title, the text, the photo, one per chat, each popping", () => {
		webNotifier(() => {}).show(notice("Hello"), "#general · Alpha", true);
		const [shown] = FakeNotification.made.splice(0);
		expect(shown?.title).toBe("Ana (#general · Alpha)");
		expect(shown?.options).toEqual({
			body: "Hello",
			icon: "https://api.test/attachments/a",
			tag: ROOM,
			renotify: true,
			silent: true,
		});
	});

	test("makes the system's sound when asked", () => {
		webNotifier(() => {}).show(notice("Hello"), null, false);
		const [shown] = FakeNotification.made.splice(0);
		expect(shown?.options.silent).toBe(false);
	});

	// The browser's permission can change in another tab or in the site's settings, without a reload.
	test("can show one while the browser allows it, as it says each time", () => {
		const notifier = webNotifier(() => {});
		FakeNotification.permission = "default";
		expect(notifier.available()).toBe(false);
		FakeNotification.permission = "granted";
		expect(notifier.available()).toBe(true);
		FakeNotification.permission = "denied";
		expect(notifier.available()).toBe(false);
		FakeNotification.permission = "granted";
	});

	test("names only the author in a DM", () => {
		webNotifier(() => {}).show(notice("Hi", { authorAvatar: null }), null, true);
		const [shown] = FakeNotification.made.splice(0);
		expect(shown?.title).toBe("Ana");
		expect(shown?.options.icon).toBeUndefined();
	});

	test("a click brings the tab forward, opens the message and closes the notification", () => {
		const opened: unknown[] = [];
		webNotifier((opening) => opened.push(opening)).show(notice("Hello"), null, true);
		const [shown] = FakeNotification.made.splice(0);
		const before = focused;
		shown?.onclick?.();
		expect(focused - before).toBe(1);
		expect(opened).toEqual([link]);
		expect(shown?.closed).toBe(true);
	});
});
