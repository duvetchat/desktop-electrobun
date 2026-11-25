// oxlint-disable-next-line import/no-unassigned-import -- it has Bun load .svelte files compiled for the server
import "$lib/components/server-render";
import { describe, expect, test } from "bun:test";
import { base64Bytes } from "$lib/activity-thumbnail";
import type { DirectMessage } from "$lib/api/conversations";
import { formatDate } from "$lib/i18n/format";
import { bytesBase64 } from "$lib/staged-images";
import { directMessageToMessage } from "$lib/types";
import * as content from "../conversation-content.svelte";
import { drawnRows, type Held, type MessageContent, type ShownMessage } from "./content";
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
		expect(drawnRows([early, shared, notice2, later], joined, held)).toEqual({
			rows: [shared, notice2, later],
			beforeJoining: true,
		});
		// None from before: no notice.
		expect(drawnRows([later], joined, held)).toEqual({ rows: [later], beforeJoining: false });
		// Without the membership, nothing goes.
		expect(drawnRows([early, later], undefined, held)).toEqual({ rows: [early, later], beforeJoining: false });

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
		).toMatchObject({
			content: null,
		});
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
});
