import { expect, test } from "bun:test";
import type { SealedFile } from "$lib/e2e/engine/files";
import { MessageType, type Attachment, type Message } from "$lib/types";
import { tags } from "./server-render";

// The stores' module keeps the session token in a $state, which only Svelte's compiler knows: here it's the value itself.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const { default: MessageAttachments } = await import("./MessageAttachments.svelte");

const NOW = "2026-11-26T12:00:00.000Z";
/** A conversation's picture or video whose sender says it's `width` × `height`. */
function sealedFile(type: string, width: number, height: number): Attachment {
	const id = crypto.randomUUID();
	const sealed: SealedFile = {
		...{ id, key: "a2V5", sha256: "aGFzaA==", name: "a.png", said: type, size: 100, width, height },
		url: `/attachments/${id}?sig=test`,
	};
	return {
		id,
		message_id: "m",
		filename: "a.png",
		content_type: type,
		size_bytes: 100,
		width,
		height,
		created_at: NOW,
		sealed,
	};
}

/** The box a message draws its one picture or video in, as its style sets it. */
async function boxOf(attachment: Attachment): Promise<{ width: number; height: number }> {
	const message: Message = {
		...{ id: "m", content: null, type: MessageType.Text, author_id: "u", author_name: "Ana" },
		...{ author_avatar_url: null, author_is_bot: false, created_at: NOW, updated_at: NOW, attachments: [attachment] },
	};
	const styles = (await tags(MessageAttachments, { message, channelName: "", onPreview: () => {} }))
		.map((tag) => /width: (\d+)px; height: (\d+)px/.exec(tag.attributes.style ?? ""))
		.filter((found) => found !== null);
	expect(styles).toHaveLength(1);
	return { width: Number(styles[0]![1]), height: Number(styles[0]![2]) };
}

// Step 5's review, M3 (desktop-electrobun#544): the box is drawn from what the sender says before the bytes are here,
// and any sides from 1 to 65535 kept their ratio: 65535 × 1 was a box 0 px tall, which nothing showed in or took a tap.
test("a conversation's picture or video keeps a box to see and tap, whatever sides its sender says", async () => {
	for (const type of ["image/png", "video/mp4"]) {
		const wide = await boxOf(sealedFile(type, 65_535, 1));
		expect(wide.width).toBe(360);
		expect(wide.height).toBeGreaterThanOrEqual(44);
		const tall = await boxOf(sealedFile(type, 1, 65_535));
		expect(tall.height).toBe(380);
		expect(tall.width).toBeGreaterThanOrEqual(44);
		// A picture of a plain shape keeps it.
		expect(await boxOf(sealedFile(type, 640, 480))).toEqual({ width: 360, height: 270 });
	}
});
