import { describe, expect, spyOn, test } from "bun:test";
import { pageStore } from "./engine/store";
import { FakeApi } from "./testing/fake-api";
import { coreLibrary } from "./testing/host-bun";
import { firstDevice, rejection, testHost, until, useFake } from "./testing/engines";
import { useXHR } from "./testing/xhr";
import * as content from "./conversation-content.svelte";
import { decryptedFiles } from "./decrypted-files.svelte";
import { openSealed, shownFile, type ShownFile } from "./engine/files";
import { toEngine, type EngineEvent } from "./events";

useXHR();

// The page's engine and the stores it reaches are .svelte.ts modules whose $state only Svelte's compiler knows: here
// it's the value itself, set before they load.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const page = await import("./engine.svelte");

// Plain text stays in the core's database (PLAN-E2E-CLIENTES.md, Review Focus 1): two devices converse with a witness
// string, one through the page's own engine and its content cache, sent, quoted, edited, deleted and left waiting after
// a cut request; then no
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
			// Ana's device is the page's own engine (lib/e2e/engine.svelte.ts), on a host of the test's, its record in
			// localStorage; its gateway events reach it as the app's do. Bo's keeps its record there too.
			const token = fake.signIn(ana).token;
			localStorage.setItem("duvet_session_token", token);
			const host = testHost();
			await page.startEngine(ana, {
				...{ desktop: true, desktopHost: async () => host, webHost: () => Promise.reject(new Error("no web")) },
				...{ missing: () => [], persist: () => undefined },
			});
			await page.makeIdentity();
			await page.keySaved();
			const { device_id } = await host.handle<{ device_id: string }>({ cmd: "status" });
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fake's events are the API's, as the gateway hands them on
			const hear = fake.connect(token, device_id, (event) => toEngine(event as EngineEvent));
			const b = await firstDevice(fake, bo, { store: pageStore(bo) });
			await page.openConversation(conversation);
			await until(
				async () => !!(await b.host.handle({ cmd: "group", conversation_id: conversation }).catch(() => null)),
			);

			// Sent through the page, read on the other device, quoted in a reply the page reads, edited, deleted.
			const sent = await page.sendEncrypted({
				conversation_id: conversation,
				nonce: crypto.randomUUID(),
				text: witness,
			});
			if (!sent) throw new Error("the message wasn't sent");
			await until(async () => (await b.engine.messages(conversation, [sent.id]))[0]?.text === witness);
			const reply = await b.engine.sendMessage({
				...{ conversation_id: conversation, nonce: crypto.randomUUID(), text: `re: ${witness}` },
				message_reference: { type: 0, message_id: sent.id },
			});
			if (!reply) throw new Error("the reply wasn't sent");
			content.want(conversation, [reply.id]);
			await until(() => content.heldRow(conversation, reply.id)?.text === `re: ${witness}`);
			await page.editEncrypted(conversation, sent.id, `${witness}, edited`);
			await until(async () => (await b.engine.messages(conversation, [sent.id]))[0]?.text === `${witness}, edited`);
			await b.engine.deleteMessage(conversation, reply.id);
			// A file whose name and bytes hold it: sealed and sent through the page, opened on the other device, and drawn
			// by the page itself, through its own memory of what it decrypted.
			const file = new File([`${witness}\n`.repeat(200)], `${witness}.txt`, { type: "text/plain" });
			const withFile = await page.sendEncrypted({
				...{ conversation_id: conversation, nonce: crypto.randomUUID(), text: "a file" },
				files: [{ file, name: file.name }],
			});
			if (!withFile) throw new Error("the file wasn't sent");
			let shown: ShownFile | null = null;
			await until(async () => {
				const [row] = await b.engine.messages(conversation, [withFile.id]);
				shown = row?.status === "ok" ? shownFile(row.attachments[0]) : null;
				return shown !== null;
			});
			const url = withFile.attachments?.[0]?.url ?? null;
			const opened = await openSealed(shown!, {
				download: (most, progress) => b.api.sealedFile(url!, most, progress),
				open: (key, id, sealed, progress) => b.engine.openFile(key, id, sealed, progress),
			});
			expect(await opened.blob.text()).toBe(await file.text());
			const drawn = await decryptedFiles.open({ ...shown!, url }, withFile.id);
			expect(drawn.status).toBe("ready");
			// One whose request never reached the API waits on the device, with what goes with it in the clear.
			fake.cutRequest({ method: "POST", path: `/api/users/@me/conversations/${conversation}/messages` });
			await rejection(
				page.sendEncrypted({
					...{ conversation_id: conversation, nonce: crypto.randomUUID(), text: `${witness}, waiting` },
					message_reference: { type: 0, message_id: sent.id },
				}),
			);
			expect((await page.pendingEncrypted(conversation)).map((p) => p.text)).toEqual([`${witness}, waiting`]);
			await page.stopEngine();
			hear();
			await b.engine.stop();
			for (const spy of spies) spy.mockRestore();

			const kept: string[] = [];
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i)!;
				kept.push(`${key}=${localStorage.getItem(key)}`);
			}
			// The engines' records are there, and hold none of it.
			expect(kept.some((item) => item.startsWith(`duvet.e2e.${ana}.`))).toBe(true);
			// The witness, or the start of it in base64, as a file's bytes or a name would carry it.
			const found = (where: string[]) =>
				where.filter((text) => text.includes(witness) || text.includes(btoa(witness).slice(0, 40)));
			expect(found(kept)).toEqual([]);
			expect(found(await Promise.all(bodies))).toEqual([]);
			expect(found(written)).toEqual([]);
		},
		SLOW,
	);
});
