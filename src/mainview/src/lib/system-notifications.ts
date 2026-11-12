import { get } from "svelte/store";
import { setSystemNotifier, type SystemNotifier } from "$lib/api/ws/connection";
import { getElectrobunRpc, isElectrobunWindow, type NotificationRequest } from "$lib/electrobun-rpc";
import { renderMarkdownLine } from "$lib/markdown";
import type { MentionNotice } from "$lib/mention-notices";
import { roomNames } from "$lib/stores.svelte";
import { startTabCoordination } from "$lib/tab-notifications";
import type { MessageLink } from "$lib/urls";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"' };

/**
 * A message's text as a system notification shows it: plain, with the people, rooms and custom emojis it names as
 * Duvet's notice draws them (renderMarkdownLine), a spoiler hidden, as anyone near the screen can read a notification,
 * and "Click to see message" for a message without text, as the notice says.
 */
export function noticeText(notice: MentionNotice, rooms: Record<string, string>): string {
	const spoilersHidden = notice.text.replace(/\|\|(.+?)\|\|/gs, "▮▮▮");
	const text = renderMarkdownLine(spoilersHidden, notice.mentionMap, notice.customEmojiMap, rooms)
		.replace(/<img\b[^>]*\btitle="([^"]*)"[^>]*>/g, "$1")
		.replace(/<[^>]*>/g, "")
		.replace(/&(amp|lt|gt|quot);/g, (_, name: string) => ENTITIES[name] ?? "")
		.replace(/\s+/g, " ")
		.trim();
	return text || "Click to see message";
}

/** The desktop app's notifier (Windows): each notification goes to the Bun process as a toast (src/bun/toasts.ts),
 * grouped by its chat. */
export function desktopNotifier(rpc: {
	send: { showNotification: (request: NotificationRequest) => void };
}): SystemNotifier {
	return {
		available: () => true,
		show: (notice, place, silent) =>
			rpc.send.showNotification({
				id: notice.id,
				chatId: notice.link.conversationId || notice.link.roomId,
				title: notice.authorName,
				text: noticeText(notice, get(roomNames)),
				place,
				avatarUrl: notice.authorAvatar,
				link: notice.link,
				silent,
			}),
	};
}

/**
 * The web's notifier, while the browser allows it (NotificationPermissionBar asks; it's read each time, as another tab
 * or the site's settings can change it): the browser's own notification, with who and where in its title, as the
 * browser signs it with its own name, and one per chat (its tag), each new one shown again (renotify). A click brings
 * the tab forward and opens the message.
 */
export function webNotifier(open: (link: MessageLink) => void): SystemNotifier {
	return {
		available: () => Notification.permission === "granted",
		show: (notice, place, silent) => {
			// renotify, which TypeScript's DOM types leave out: Chromium's, the browsers others ignore.
			const options: NotificationOptions & { renotify: boolean } = {
				body: noticeText(notice, get(roomNames)),
				icon: notice.authorAvatar ?? undefined,
				tag: notice.link.conversationId || notice.link.roomId,
				renotify: true,
				silent,
			};
			const shown = new Notification(place ? `${notice.authorName} (${place})` : notice.authorName, options);
			shown.onclick = () => {
				window.focus();
				open(notice.link);
				shown.close();
			};
		},
	};
}

// What a click on a notification opens a message with: the app page's, the latest one mounted.
let opener: ((link: MessageLink) => void) | null = null;
let wired = false;

/**
 * Sets up the system's notifications where there are (lib/notifications.ts): the web's, with the browser's permission,
 * and the app's on Windows, whose clicks come back as the message to open. Elsewhere (macOS, Linux), what notifies
 * without the focus shows as Duvet's notice. The RPC is wired once; a page mounted again (HMR) only hands its opener.
 */
export async function startSystemNotifications(open: (link: MessageLink) => void) {
	opener = open;
	if (!isElectrobunWindow()) {
		// One of a browser's tabs notifies (lib/tab-notifications.ts).
		startTabCoordination();
		if (typeof Notification !== "undefined") setSystemNotifier(webNotifier((link) => opener?.(link)));
		return;
	}
	if (wired || !navigator.userAgent.includes("Windows")) return;
	wired = true;
	const rpc = await getElectrobunRpc();
	if (!rpc) return;
	rpc.on.openMessage((link) => opener?.(link));
	setSystemNotifier(desktopNotifier(rpc));
}
