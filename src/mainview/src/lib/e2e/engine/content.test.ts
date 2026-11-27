// oxlint-disable-next-line import/no-unassigned-import -- it has Bun load .svelte files compiled for the server
import "$lib/components/server-render";
import { describe, expect, test } from "bun:test";
import { base64Bytes } from "$lib/activity-thumbnail";
import type { DirectMessage } from "$lib/api/conversations";
import { formatDate } from "$lib/i18n/format";
import { bytesBase64 } from "$lib/staged-images";
import { directMessageToMessage } from "$lib/types";
import * as content from "../conversation-content.svelte";
import { drawnRows, pageRows, type Held, type MessageContent, type ShownMessage } from "./content";
import { notice, NOTICES } from "../notices";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import { firstDevice, restarted, sameGroup, useFake } from "../testing/engines";

// A conversation as the device draws it (PLAN-E2E-CLIENTES.md, «La vista de una conversación»): the API's rows, each
// with what this device's own database holds of it; a row it doesn't hold waits for it, rows from before the user joined
// give way to a notice, and a conversation from before the cutover says when its older messages went.
const SLOW = 180_000;
const { render } = await import("svelte/server");
const { default: ConversationStart } = await import("$lib/components/e2e/ConversationStart.svelte");

const drawn = (props: { legacy: boolean; cutoverAt: string | null; beforeJoining: boolean }) =>
	render(ConversationStart, { props })
		.body.replace(/<!--[^]*?-->/g, "")
		.replaceAll("&#39;", "'");

/** A row of the device's own database, as `messages` gives it. */
const shownRow = (id: string): ShownMessage => ({
	...{ conversation_id: "c", message_id: id, seq: 1, user_id: "a", device_id: "d", sent_at: 0, edited_at: null },
	...{ status: "ok", text: null, attachments: [], shared_by: null, reply_to: null },
});

/** What a view reads of a conversation on this device: these rows held, this text typed, its queue applied this far. */
const holding = (held: (id: string) => Held, typed: Record<string, string> = {}, through = 1_000): MessageContent => ({
	held,
	typed: (id) => typed[id],
	through: () => through,
});

/** An encrypted row of the API's, as a page of the conversation lists it. */
const row = (id: string, more: Partial<DirectMessage> = {}): DirectMessage => ({
	id,
	conversation_id: "c",
	author_id: "a",
	content: null,
	type: 0,
	created_at: "2026-11-25T00:00:00Z",
	updated_at: "2026-11-25T00:00:00Z",
	seq: 1,
	ciphertext: "Y2lwaGVy",
	...more,
});

describe.skipIf(!coreLibrary)("what the device holds of a conversation", () => {
	test(
		"a row the core doesn't hold waits, and an import fills it",
		async () => {
			const fake = new FakeApi();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			useFake(fake);
			const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
			const a = await firstDevice(fake, ana);
			let b = await firstDevice(fake, bo);
			await a.engine.openConversation(conversation);
			await sameGroup([a, b], conversation);

			// Ana sends a message, while Bo's device is away; its copy of it doesn't open there (one byte of it spoiled).
			await b.engine.stop();
			const sent = (await a.engine.sendMessage({
				conversation_id: conversation,
				nonce: crypto.randomUUID(),
				text: "kept for Bo",
			}))!;
			await b.host.open(bo);
			const { entries } = await a.api.queue(conversation, 0);
			const entry = entries.find((e) => e.message_id === sent.id)!;
			const spoiled = base64Bytes(entry.data ?? "");
			spoiled[spoiled.length - 1]! ^= 0xff;
			await b.host.handle({
				cmd: "apply",
				conversation_id: conversation,
				entries: [{ ...entry, data: bytesBase64(spoiled) }],
			});
			b = await restarted(fake, b);

			// The row waits on Bo's device: the view draws it as waiting, as one his core never had.
			const members = (await b.api.conversations()).find((c) => c.id === conversation)!.members;
			const [waiting] = await b.engine.messages(conversation, [sent.id]);
			expect(waiting).toMatchObject({ message_id: sent.id, status: "waiting", text: null });
			expect(
				directMessageToMessage(
					sent,
					members,
					holding(() => waiting),
				),
			).toMatchObject({ waiting: true, content: null });
			const unknown = crypto.randomUUID();
			expect(await b.engine.messages(conversation, [unknown])).toEqual([]);
			// The re-review's N4: a conversation the engine hasn't applied this session has no number yet, which isn't
			// null, «out of its group».
			expect((await b.engine.read(crypto.randomUUID(), [])).through).toBeUndefined();
			expect(
				directMessageToMessage(
					row(unknown),
					members,
					holding(() => null),
				),
			).toMatchObject({ waiting: true });
			// Not yet asked: neither waiting nor any text.
			expect(
				directMessageToMessage(
					sent,
					members,
					holding(() => undefined),
				),
			).toMatchObject({ waiting: false, content: null });

			// Ana shares the conversation's history with Bo: the import fills the row, which then shows its text.
			const certificates = (await a.api.identity(bo)).certificates;
			const made = await a.host.share({
				...{ cmd: "history_share", conversation_id: conversation, to_user: bo, range: "all" },
				devices: certificates,
			});
			const from = (await b.api.identity(ana)).certificates[0];
			for (const key of made.keys)
				await b.host.handle({ cmd: "receive_direct", message: key.message, from_certificate: from });
			const parts: Uint8Array[] = [];
			for (let n = 0; n < made.parts; n++) parts.push(await a.host.sharePart(made.share_id, n));
			expect(await b.host.importShare(made.share_id, parts)).toMatchObject({ imported: expect.any(Number) });
			const [filled] = await b.engine.messages(conversation, [sent.id]);
			expect(filled).toMatchObject({ status: "ok", text: "kept for Bo", shared_by: ana });
			expect(
				directMessageToMessage(
					sent,
					members,
					holding(() => filled),
				),
			).toMatchObject({
				waiting: false,
				content: "kept for Bo",
			});
		},
		SLOW,
	);

	test(
		"the line about the cutover shows on a legacy conversation, with the server's date",
		async () => {
			const fake = new FakeApi();
			fake.cutoverAt = "2026-12-01T09:30:00Z";
			const ana = fake.addUser();
			useFake(fake);
			const a = await firstDevice(fake, ana);
			expect(a.engine.cutoverAt).toBe("2026-12-01T09:30:00Z");
			const line = notice("cutover", { date: formatDate(new Date("2026-12-01T09:30:00Z"), { dateStyle: "long" }) });
			expect(drawn({ legacy: true, cutoverAt: a.engine.cutoverAt, beforeJoining: false })).toContain(line);
			expect(drawn({ legacy: false, cutoverAt: a.engine.cutoverAt, beforeJoining: false })).not.toContain(
				NOTICES.cutover.slice(0, 20),
			);
			expect(drawn({ legacy: true, cutoverAt: null, beforeJoining: false })).not.toContain(
				NOTICES.cutover.slice(0, 20),
			);
		},
		SLOW,
	);
});

describe("a conversation's rows", () => {
	test("rows from before the user joined give way to one notice", () => {
		const joined = "0193a4b2-0000-7000-8000-000000000050";
		const [early, shared, notice2, later] = [
			row("0193a4b2-0000-7000-8000-000000000010"),
			row("0193a4b2-0000-7000-8000-000000000020"),
			row("0193a4b2-0000-7000-8000-000000000030", { seq: undefined, ciphertext: undefined, type: 3 }),
			row("0193a4b2-0000-7000-8000-000000000060"),
		];
		const held = (id: string): ShownMessage | null =>
			id === shared.id ? { ...shownRow(id), status: "ok", text: "shared" } : null;
		// The one the device doesn't hold goes; the one it holds (shared with it), the call notice and the row since stay.
		expect(drawnRows([early, shared, notice2, later], joined, holding(held))).toEqual({
			rows: [shared, notice2, later],
			beforeJoining: true,
		});
		// None from before: no notice.
		expect(drawnRows([later], joined, holding(held))).toEqual({ rows: [later], beforeJoining: false });
		// Without the membership, nothing goes.
		expect(drawnRows([early, later], undefined, holding(held))).toEqual({ rows: [early, later], beforeJoining: false });

		// The notice shows once, above the chat.
		const shown = drawn({ legacy: false, cutoverAt: null, beforeJoining: true });
		expect(shown.split(NOTICES.before_joining)).toHaveLength(2);
		expect(drawn({ legacy: false, cutoverAt: null, beforeJoining: false }).trim()).toBe("");
	});
});

// The review of task 16: what a conversation draws comes from the device alone (I1, M4), a row not applied yet is
// loading (M2), one conversation's rows never show in another, and the cache lets go of what its lists let go (M1).
describe("what a conversation draws", () => {
	const members = [] as Parameters<typeof directMessageToMessage>[1];
	const ID = "0193a4b2-0000-7000-8000-000000000070";
	const QUOTED = "0193a4b2-0000-7000-8000-000000000060";
	const held = (rows: Record<string, ShownMessage>) => (id: string) => rows[id] ?? null;

	test("an encrypted row draws only what the device holds of it, or the text the person typed", () => {
		const served = row(ID, {
			content: "words put in a mouth",
			embeds: [{ title: "a preview" }],
			referenced_message: {
				...{ type: 0, message_id: QUOTED, room_id: null, space_id: null, content: "a quote's lie" },
				...{ author_id: "a", created_at: "2026-11-25T00:00:00Z" },
			},
		});
		// Nothing held: waiting, with none of the API's words, its preview or its quote's text.
		expect(directMessageToMessage(served, members, holding(held({})))).toMatchObject({
			...{ content: null, waiting: true, embeds: null },
			referenced_message: { message_id: QUOTED, content: null },
		});
		// The person's own, just sent: the text they typed, until the row is there.
		expect(directMessageToMessage(served, members, holding(held({}), { [ID]: "typed" }))).toMatchObject({
			content: "typed",
			waiting: false,
		});
		// Held: its text, and its quote's from the quoted row.
		const rows = { [ID]: { ...shownRow(ID), text: "held" }, [QUOTED]: { ...shownRow(QUOTED), text: "quoted" } };
		expect(directMessageToMessage(served, members, holding(held(rows)))).toMatchObject({
			content: "held",
			referenced_message: { content: "quoted" },
		});
		// A held row whose sender isn't the author the API names: waiting, never its text under another's name.
		const other = { [ID]: { ...shownRow(ID), text: "held", user_id: "someone else" } };
		expect(directMessageToMessage(served, members, holding(held(other)))).toMatchObject({
			content: null,
			waiting: true,
		});
		// A text row without its number draws nothing.
		expect(
			directMessageToMessage(row(ID, { seq: undefined, content: "plain" }), members, holding(held({}))),
		).toBeNull();
	});

	// #575 (I1): an honest API serves a conversation only numbered messages and its notices. Any other row is no message
	// a member sent: drawn nowhere, whatever it carries, and a sealed file is the core's alone.
	test("a row neither numbered nor a notice draws nothing, from a page or from an event", () => {
		const sealed = {
			...{ id: ID, key: "a2V5", sha256: "c2hh", size: 3, name: "photo.png", said: "image/png" },
			...{ url: "/attachments/a?sig=s", thumbnailUrl: null },
		};
		const file = {
			...{ id: ID, message_id: ID, filename: "photo.png", content_type: "image/png", size_bytes: 3 },
			...{ created_at: "2026-11-25T00:00:00Z", url: "/attachments/a?sig=s", sealed },
		};
		const served = row(ID, { seq: undefined, type: 1, attachments: [file] });
		expect(drawnRows([served], undefined, holding(held({}))).rows).toEqual([]);
		// Pins, threads, results and link cards draw a row through the mapper: none of it either.
		expect(directMessageToMessage(served, members, holding(held({})))).toBeNull();
		// The person's own being sent, whose typed text this client keeps, shows with its files' bars, never sealed ones.
		const own = directMessageToMessage(served, members, holding(held({}), { [ID]: "" }));
		expect(own?.attachments?.map((attachment) => attachment.sealed)).toEqual([undefined]);
		// The server's notices show as they are, with no file of the API's.
		const callNotice = row(ID, { seq: undefined, type: 3, attachments: [file] });
		expect(drawnRows([callNotice], undefined, holding(held({}))).rows).toEqual([callNotice]);
		expect(directMessageToMessage(callNotice, members, holding(held({})))?.attachments).toBeNull();
	});

	// #575 (N-M4): the API's rows never stand for one being sent. A page's row neither numbered nor a notice goes as the
	// page comes in, as the live event's does, whatever ID it carries: the typed text vouches only for the row this client
	// built, never for one of the API's that names it.
	test("a page's row neither numbered nor a notice goes as the page comes in, whatever ID it carries", () => {
		const NOTICE = "0193a4b2-0000-7000-8000-000000000071";
		const page = [
			row(ID, { seq: undefined, type: 1 }),
			row(QUOTED, { seq: 2 }),
			row(NOTICE, { seq: undefined, type: 3 }),
		];
		expect(pageRows(page).map(({ id }) => id)).toEqual([QUOTED, NOTICE]);
	});

	// #575 (N-M5): the person's typed text shows only under their own ID: a row naming another author, by the pending
	// row's ID or as the send's own answer, draws none of it.
	test("typed text shows only under the person's own ID", () => {
		const conversation = "0193a4b2-0000-7000-8000-0000000000c5";
		const [me, other] = ["0193a4b2-0000-7000-8000-0000000000a1", "0193a4b2-0000-7000-8000-0000000000b2"];
		try {
			content.keepTyped(conversation, ID, "what I typed");
			const reader = content.contentOf(conversation, me);
			expect(reader.typed(ID, me)).toBe("what I typed");
			expect(reader.typed(ID, other)).toBeUndefined();
			expect(directMessageToMessage(row(ID, { author_id: other }), members, reader)?.content).toBeNull();
			expect(directMessageToMessage(row(ID, { author_id: me }), members, reader)?.content).toBe("what I typed");
		} finally {
			content.dropTyped(conversation, ID);
		}
	});

	test("a row the engine hasn't applied yet is loading, neither empty nor waiting", () => {
		const late = row(ID, { seq: 7 });
		expect(directMessageToMessage(late, members, holding(held({}), {}, 5))).toMatchObject({
			loading: true,
			waiting: false,
		});
		expect(directMessageToMessage(late, members, holding(held({}), {}, 7))).toMatchObject({
			loading: false,
			waiting: true,
		});
	});

	test("one conversation's rows never show in another's, and a change reads again only what it touched", async () => {
		const reads: string[][] = [];
		content.useReader(async (conversationId, ids) => {
			reads.push([conversationId, ...ids]);
			const rows = conversationId === "A" ? ids.map((id) => ({ ...shownRow(id), text: `${id} of A` })) : [];
			return { rows, through: 99 };
		});
		const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
		content.want("A", ["x", "y"]);
		content.want("B", ["x"]);
		await settled();
		expect(content.heldRow("A", "x")?.text).toBe("x of A");
		expect(content.heldRow("B", "x")).toBeNull();
		// An apply touched y: only y is read again.
		content.refresh("A", ["y"]);
		await settled();
		expect(reads.at(-1)).toEqual(["A", "y"]);
		// The list let x go: so does the cache; and all of B as its view goes.
		content.letGo("A", new Set(["y"]));
		expect(content.heldRow("A", "x")).toBeUndefined();
		expect(content.heldRow("A", "y")?.text).toBe("y of A");
		content.letGo("B");
		expect(content.heldRow("B", "x")).toBeUndefined();
		content.useReader(null);
	});

	// The re-review's N2: only a text or voice row has text, the device's; a conversation's other rows draw none of the
	// API's (a notice's words come from its own fields).
	test("a row of another type draws none of the API's content", () => {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the API's types beyond the client's: 4, a share's, and 7
		const types = [2, 3, 4, 7] as DirectMessage["type"][];
		for (const type of types) {
			const served = row(ID, { type, content: "words put in a mouth" });
			expect(directMessageToMessage(served, members, holding(held({})))?.content).toBeNull();
			// Without its number, a notice draws none of it, and a row of a type no notice has draws nothing at all.
			const noNumber = row(ID, { type, seq: undefined, content: "words" });
			expect(directMessageToMessage(noNumber, members, holding(held({})))?.content ?? null).toBeNull();
		}
	});

	// N4: out of its group (null) the device holds nothing more of a row, which waits; before the engine applied the
	// conversation this session (undefined), it's loading.
	test("out of its group a row the device doesn't hold waits, and before any apply it's loading", () => {
		const late = row(ID, { seq: 7 });
		const at = (through: number | null | undefined): MessageContent => ({
			held: held({}),
			typed: () => undefined,
			through: () => through,
		});
		expect(directMessageToMessage(late, members, at(null))).toMatchObject({ loading: false, waiting: true });
		expect(directMessageToMessage(late, members, at(undefined))).toMatchObject({ loading: true, waiting: false });
	});

	// N4: a read that began before an apply doesn't set the applied number back: the higher stays.
	test("a read that began before an apply leaves the applied number the apply gave", async () => {
		let answer: (value: { rows: ShownMessage[]; through: number | null }) => void = () => {};
		content.useReader(() => new Promise((resolve) => (answer = resolve)));
		const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
		content.want("C", ["x"]);
		await settled();
		content.refresh("C", [], 9);
		answer({ rows: [], through: 5 });
		await settled();
		expect(content.contentOf("C", "a").through()).toBe(9);
		content.useReader(null);
	});

	// The person's own text, typed, shows until its row is there: by the nonce it's sent with, then by its ID, never in
	// another conversation, and it goes with its pending row or once the row is read.
	test("the person's typed text goes from its nonce to its ID, until its row is read", async () => {
		content.useReader(async (conversationId, ids) => ({
			rows: conversationId === "D" ? ids.map((id) => ({ ...shownRow(id), text: `held ${id}` })) : [],
			through: 9,
		}));
		const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
		const d = content.contentOf("D", "a");
		content.keepTyped("D", "nonce", "typed");
		expect(d.typed("nonce", "a")).toBe("typed");
		expect(content.contentOf("E", "a").typed("nonce", "a")).toBeUndefined();
		content.moveTyped("D", "nonce", "id");
		expect(d.typed("nonce", "a")).toBeUndefined();
		expect(d.typed("id", "a")).toBe("typed");
		content.want("D", ["id"]);
		await settled();
		expect(d.held("id")?.text).toBe("held id");
		expect(d.typed("id", "a")).toBeUndefined();
		// Its row there already, the text doesn't move on; dropped, it goes.
		content.keepTyped("D", "again", "typed again");
		content.moveTyped("D", "again", "id");
		expect(d.typed("id", "a")).toBeUndefined();
		content.keepTyped("D", "dismissed", "gone");
		content.dropTyped("D", "dismissed");
		expect(d.typed("dismissed", "a")).toBeUndefined();
		content.useReader(null);
	});
});
