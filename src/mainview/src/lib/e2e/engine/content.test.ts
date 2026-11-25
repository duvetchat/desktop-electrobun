// oxlint-disable-next-line import/no-unassigned-import -- it has Bun load .svelte files compiled for the server
import "$lib/components/server-render";
import { describe, expect, test } from "bun:test";
import { base64Bytes } from "$lib/activity-thumbnail";
import type { DirectMessage } from "$lib/api/conversations";
import { formatDate } from "$lib/i18n/format";
import { bytesBase64 } from "$lib/staged-images";
import { directMessageToMessage } from "$lib/types";
import { drawnRows, type ShownMessage } from "./content";
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
			expect(directMessageToMessage(sent, members, () => waiting)).toMatchObject({ waiting: true, content: null });
			const unknown = crypto.randomUUID();
			expect(await b.engine.messages(conversation, [unknown])).toEqual([]);
			expect(directMessageToMessage(row(unknown), members, () => null)).toMatchObject({ waiting: true });
			// Not yet asked: neither waiting nor any text.
			expect(directMessageToMessage(sent, members, () => undefined)).toMatchObject({ waiting: false, content: null });

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
			expect(directMessageToMessage(sent, members, () => filled)).toMatchObject({
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
