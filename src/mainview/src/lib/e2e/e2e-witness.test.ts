import { describe, expect, spyOn, test } from "bun:test";
import { pageStore } from "./engine/store";
import { FakeApi } from "./testing/fake-api";
import { coreLibrary } from "./testing/host-bun";
import { firstDevice, rejection, sameGroup, until, useFake } from "./testing/engines";
import * as content from "./conversation-content.svelte";

// Plain text stays in the core's database (PLAN-E2E-CLIENTES.md, Review Focus 1): two devices converse with a witness
// string, sent, quoted, edited, deleted and left waiting after a cut request, and the page draws it; then no
// localStorage item, no record the engine keeps, no body the API saw and no line written to the console holds it.
const SLOW = 180_000;
const CONSOLE = ["log", "info", "warn", "error", "debug", "trace"] as const;

describe.skipIf(!coreLibrary)("the witness", () => {
	test(
		"a witness string sent and received is nowhere but in the cores",
		async () => {
			const witness = `witness-${crypto.randomUUID()}`;
			const written: string[] = [];
			const spies = CONSOLE.map((method) =>
				spyOn(console, method).mockImplementation((...args: unknown[]) => {
					written.push(
						args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : String(arg))).join(" "),
					);
					// What else an argument holds, as a console would show it.
					for (const arg of args) {
						try {
							written.push(JSON.stringify(arg) ?? "");
						} catch {
							// A value JSON can't take was written as its string above.
						}
					}
				}),
			);
			const bodies: Promise<string>[] = [];
			const fake = new FakeApi();
			useFake(fake, (request) => bodies.push(request.text()));
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
			// Each device keeps its record in the page's localStorage, as the app does.
			const a = await firstDevice(fake, ana, { store: pageStore(ana) });
			const b = await firstDevice(fake, bo, { store: pageStore(bo) });
			await a.engine.openConversation(conversation);
			await sameGroup([a, b], conversation);

			// Sent, read on the other device and drawn there, quoted in a reply, edited, deleted.
			const sent = (await a.engine.sendMessage({
				conversation_id: conversation,
				nonce: crypto.randomUUID(),
				text: witness,
			}))!;
			content.useReader((conversationId, ids) => b.engine.messages(conversationId, ids));
			content.want(conversation, [sent.id]);
			await until(() => content.heldRow(sent.id)?.text === witness);
			const reply = (await b.engine.sendMessage({
				...{ conversation_id: conversation, nonce: crypto.randomUUID(), text: `re: ${witness}` },
				message_reference: { type: 0, message_id: sent.id },
			}))!;
			await a.engine.editMessage(conversation, sent.id, `${witness}, edited`);
			await until(async () => (await b.engine.messages(conversation, [sent.id]))[0]?.text === `${witness}, edited`);
			await b.engine.deleteMessage(conversation, reply.id);
			// One whose request never reached the API waits on the device, with what goes with it in the clear.
			fake.cutRequest({ method: "POST", path: `/api/users/@me/conversations/${conversation}/messages` });
			await rejection(
				a.engine.sendMessage({
					...{ conversation_id: conversation, nonce: crypto.randomUUID(), text: `${witness}, waiting` },
					message_reference: { type: 0, message_id: sent.id },
				}),
			);
			expect((await a.engine.pendingMessages(conversation)).map((p) => p.text)).toEqual([`${witness}, waiting`]);
			await a.engine.stop();
			await b.engine.stop();
			for (const spy of spies) spy.mockRestore();

			const kept: string[] = [];
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i)!;
				kept.push(`${key}=${localStorage.getItem(key)}`);
			}
			// The engines' records are there, and hold none of it.
			expect(kept.some((item) => item.startsWith(`duvet.e2e.${ana}.`))).toBe(true);
			const found = (where: string[]) => where.filter((text) => text.includes(witness) || text.includes(btoa(witness)));
			expect(found(kept)).toEqual([]);
			expect(found(await Promise.all(bodies))).toEqual([]);
			expect(found(written)).toEqual([]);
		},
		SLOW,
	);
});
