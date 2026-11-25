// This device's search of its conversations' messages (decision 42; PLAN-E2E-CLIENTES.md, task 20): the core's `search`
// over its own database, by what a message's text says (its words, mentions) and what its envelope holds (the kinds of
// its files), and by its author and when the API took it. The API can't read a message, so it never gets words: it only
// knows what it keeps in the clear, which pins and stickers are.
import type { MessageSearch } from "$lib/api/messages";
import type { CoreHost } from "../host";
import type { ShownMessage } from "./content";

/** The kinds of files the core tells a message's apart by, from what its envelope says of them; `file` is any file. */
export type DeviceKind = "image" | "video" | "audio" | "file";

/** What the core's search takes: every conversation's messages without `conversation_id`, newest first. */
export interface DeviceSearch {
	/** Its words, each the start of one of a message's words (a one-letter one whole), its case and accents aside. */
	text?: string;
	conversation_id?: string;
	/** Written by one of these users. */
	from?: string[];
	/** Mentioning one of these users, in its text or in the list its sender gave the API. */
	mentions?: string[];
	/** Taken by the API at this time or later, and before this one, in Unix milliseconds. */
	after?: number;
	before?: number;
	/** With a file of one of these kinds. */
	has?: DeviceKind[];
	/** A page: 100 at most. */
	limit: number;
	offset?: number;
}

/** A page of what the core found, and how many it found in all: neither a deleted message nor one that waits. */
export interface DeviceFound {
	total: number;
	messages: ShownMessage[];
}

/** The core's search: the one way this device's database is searched. */
export function searchDevice(host: CoreHost, search: DeviceSearch): Promise<DeviceFound> {
	return host.handle<DeviceFound>({ cmd: "search", ...search });
}

/** Whether a search's text has words: a letter or a digit, as the core's search and the API's read words. */
const hasWords = (text: string | undefined) => !!text && /[\p{L}\p{N}]/u.test(text);

/** The search box's has: values the device finds, as the core names them. */
const DEVICE_KINDS: Partial<Record<string, DeviceKind>> = {
	image: "image",
	video: "video",
	sound: "audio",
	file: "file",
};

/**
 * What a search box's search takes to the device: its words, authors, mentions, dates and kinds of files. Null when it
 * needs what only the API knows (pinned:, has:sticker), names only kinds of files the device can't tell (link, embed:
 * a conversation's message has no preview, and its links aren't searched), or has nothing to search for (no filter,
 * and no words: punctuation alone is none, for which the core adds no filter and would list every message), which the
 * API answers as it answers a Space's.
 */
export function deviceSearchOf(search: MessageSearch): Omit<DeviceSearch, "limit" | "offset"> | null {
	const has = search.has ?? [];
	const kinds = has.flatMap((value) => DEVICE_KINDS[value] ?? []);
	if (search.pinned !== undefined || has.includes("sticker") || (has.length && !kinds.length)) return null;
	const [after, before] = [search.after, search.before].map((time) => (time ? Date.parse(time) : undefined));
	const found = {
		...(hasWords(search.query) ? { text: search.query } : {}),
		...(search.authorIds?.length ? { from: search.authorIds } : {}),
		...(search.mentions?.length ? { mentions: search.mentions } : {}),
		...(after === undefined ? {} : { after }),
		...(before === undefined ? {} : { before }),
		...(kinds.length ? { has: kinds } : {}),
	};
	return Object.keys(found).length ? found : null;
}

/**
 * Whether the API's search of a conversation takes it, as its e2e answers one: never words, and of has: only file and
 * sticker (ConversationController.SearchMessages). A text without words goes to it as no text.
 */
export const apiTakes = (search: MessageSearch) =>
	!hasWords(search.query) && (search.has ?? []).every((value) => value === "file" || value === "sticker");
