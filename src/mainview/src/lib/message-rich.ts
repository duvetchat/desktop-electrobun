import { EMOJI_REGEX, toTwemojiUrl } from "$lib/emoji";
import { escapeHtml } from "$lib/markdown";
import { lineBreaksHtml } from "$lib/message-box";

/** A member's or a room's chip in a message box: one node the caret can't enter, standing for its raw form. */
export const MENTION_CHIP =
	"inline cursor-default rounded px-1 py-px font-medium select-all bg-duvet-accent-tint text-duvet-accent-text";

export interface RichTextLookups {
	/** What a mention of this member reads, "@name" included. */
	mentionText: (id: string) => string;
	/** What a mention of this room reads, "#name" included. */
	roomText: (id: string) => string;
	/** A Space's custom emoji, or null when it isn't known: its raw form stays text. */
	customEmoji: (id: string) => { name: string; url: string } | null;
}

/**
 * A message box's HTML for its raw text: mentions, rooms, custom emoji and Unicode emoji become the chips and pictures
 * the app draws, and line breaks stay lines. What the box's `rawOf` (lib/message-box.ts) reads back is the raw text.
 */
export function richTextHtml(text: string, lookups: RichTextLookups): string {
	if (!text) return "";
	const html = text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(
			/&lt;@([a-f0-9-]+)&gt;/g,
			(_, id) =>
				`<span class="${MENTION_CHIP}" contenteditable="false" data-mention="${id}">${escapeHtml(lookups.mentionText(id))}</span>`,
		)
		.replace(
			/&lt;#([a-f0-9-]+)&gt;/g,
			(_, id) =>
				`<span class="${MENTION_CHIP}" contenteditable="false" data-room="${id}">${escapeHtml(lookups.roomText(id))}</span>`,
		)
		.replace(/&lt;:([a-f0-9-]+):&gt;/g, (_, id) => {
			const emoji = lookups.customEmoji(id);
			if (!emoji) return `&lt;:${id}:&gt;`;
			return `<img class="emoji-img custom-emoji-chip" src="${emoji.url}" alt=":${escapeHtml(emoji.name)}:" data-cemoji="${id}" draggable="false" contenteditable="false">`;
		})
		.replace(
			EMOJI_REGEX,
			(e) => `<span class="emoji-img" style="--tw:url('${toTwemojiUrl(e)}')" aria-label="${e}">${e}</span>`,
		);
	return lineBreaksHtml(html);
}
