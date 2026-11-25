import { describe, expect, spyOn, test } from "bun:test";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import { firstDevice, testHost, until, useFake, watchedHost } from "../testing/engines";

// A device's key packages (PLAN-E2E-CLIENTES.md, «Qué se manda», its key packages row): its core's whole live set goes
// up at start, every 24 h and on KEY_PACKAGES_LOW, and the API's answer names those it handed out already, which the
// core takes as spent once per upload the client started (Task 9b, api#356; Task 3b).
const SLOW = 180_000;
const DAY = 24 * 3600 * 1000;
const UPLOAD = "/api/users/@me/devices/@me/key-packages";

/** What the device's session uploaded: each upload's set's IDs, in order. */
function uploadsOf(fake: FakeApi) {
	const uploads = new Map<string, string[][]>();
	useFake(fake, (request) => {
		if (request.method !== "PUT" || new URL(request.url).pathname !== UPLOAD) return;
		const token = request.headers.get("Authorization") ?? "";
		const sets = uploads.get(token) ?? [];
		uploads.set(token, sets);
		const set: string[] = [];
		sets.push(set);
		void request.json().then((body) => set.push(...body.key_packages.map((kp: { id: string }) => kp.id)));
	});
	return (token: string) => uploads.get(`Bearer ${token}`) ?? [];
}

describe.skipIf(!coreLibrary)("key packages", () => {
	test(
		"key packages go up at start, every day and when they run low",
		async () => {
			const fake = new FakeApi();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			fake.addConversation({ type: "dm", members: [ana, bo] });
			const uploads = uploadsOf(fake);
			const a = await firstDevice(fake, ana);
			expect(uploads(a.token)).toHaveLength(1);
			expect(uploads(a.token)[0]).toHaveLength(101);

			a.clock.advance(DAY);
			await until(() => uploads(a.token).length === 2);

			// Bo's device claims Ana's until she has under 20 to hand out: she hears it, uploads, learns 81 were handed out,
			// and uploads once more what her core makes in their place.
			const b = await firstDevice(fake, bo);
			for (let n = 0; n < 81; n++) await b.api.claimKeyPackages(ana);
			await until(() => uploads(a.token).length === 4);
			const [, , low, renewed] = uploads(a.token);
			expect(low!.filter((id) => !renewed!.includes(id))).toHaveLength(81);
			// That upload started nothing more: what's handed out of it, the next upload the client starts names.
			await new Promise((resolve) => setTimeout(resolve, 200));
			expect(uploads(a.token)).toHaveLength(4);
			await Promise.all([a.engine.stop(), b.engine.stop()]);
		},
		SLOW,
	);

	test(
		"an upload the client started takes one more round for what was handed out, never two",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			const sets: string[][] = [];
			const log: string[] = [];
			// An API that always names the first key package of the set as handed out.
			spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
				const request = new Request(input, init);
				const answer = await fake.fetch(request.clone());
				if (request.method !== "PUT" || new URL(request.url).pathname !== UPLOAD) return answer;
				const { key_packages } = await request.json();
				sets.push(key_packages.map((kp: { id: string }) => kp.id));
				return Response.json({ handed_out: [key_packages[0].id] });
			}) as typeof fetch);
			const a = await firstDevice(fake, ana, { host: watchedHost(testHost(), log) });
			expect(sets).toHaveLength(2);
			// The second set has another in the first one's place.
			expect(sets[1]).not.toContain(sets[0]![0]);
			expect(log.filter((cmd) => cmd === "key_packages")).toHaveLength(2);
			await a.engine.stop();
		},
		SLOW,
	);

	test(
		"a spent list the core refuses goes without it",
		async () => {
			const fake = new FakeApi();
			const ana = fake.addUser();
			const asked: unknown[] = [];
			let answers = 0;
			// The API's first answer names more than the core takes (200 at most): too_large.
			spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
				const request = new Request(input, init);
				const answer = await fake.fetch(request);
				if (request.method !== "PUT" || new URL(request.url).pathname !== UPLOAD || answers++ > 0) return answer;
				return Response.json({ handed_out: Array.from({ length: 201 }, (_, n) => btoa(`id ${n}`)) });
			}) as typeof fetch);
			const host = testHost();
			const a = await firstDevice(fake, ana, {
				host: new Proxy(host, {
					get(target, name) {
						if (name !== "handle") return Reflect.get(target, name).bind(target);
						return (command: { cmd: string } & Record<string, unknown>) => {
							if (command.cmd === "key_packages") asked.push(command.spent ?? null);
							return target.handle(command);
						};
					},
				}),
			});
			// Asked with the 201, refused, then asked without them: and that set went up.
			expect(asked.map((spent) => (Array.isArray(spent) ? spent.length : spent))).toEqual([null, 201, null]);
			expect(answers).toBe(2);
			await a.engine.stop();
		},
		SLOW,
	);
});
