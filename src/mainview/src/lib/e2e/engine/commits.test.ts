import { describe, expect, spyOn, test } from "bun:test";
import { CoreError } from "../errors";
import type { CoreHost } from "../host";
import { FakeApi } from "../testing/fake-api";
import { coreLibrary } from "../testing/host-bun";
import {
	answeringHost,
	approvedDevice,
	firstDevice,
	groupOf,
	restarted,
	sameGroup,
	testHost,
	until,
	useFake,
	watchedHost,
} from "../testing/engines";

// A device's commits (PLAN-E2E-CLIENTES.md, «Qué se manda», its commit rows, and «Un commit sin respuesta»): what the API
// answers is what the core is told, a commit whose answer is lost goes again with its bytes, and one whose bytes are lost
// is settled by the queue; the weekly renewal of a device's leaf, and the commits the core says are due.
const SLOW = 180_000;
const DAY = 24 * 3600 * 1000;
const commits = (conversation: string) => `/api/users/@me/conversations/${conversation}/mls/commits`;

type Fails = (cmd: string, command: Record<string, unknown>) => Error | null;

/**
 * A device's core, whose refresh_due names the conversations in `due`, which notes each commit_result's fields, and
 * fails a command when `fails` gives an error.
 */
function hostOf(due: string[], results: Record<string, unknown>[], fails: Fails = () => null): CoreHost {
	const watched = watchedHost(testHost(), [], (cmd, command) => {
		if (cmd === "commit_result") results.push(command);
		return fails(cmd, command);
	});
	return answeringHost(watched, (command) => (command.cmd === "refresh_due" ? { conversations: [...due] } : undefined));
}

/**
 * Ana's and Bo's first devices, on cores whose renewals are due where `due` says (Ana's failing what `aFails` says), in
 * a DM whose group Ana made.
 */
async function dm(given: { aFails?: Fails } = {}) {
	const fake = new FakeApi();
	const [ana, bo] = [fake.addUser(), fake.addUser()];
	const posted: Promise<string>[] = [];
	const reads: string[] = [];
	const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
	useFake(fake, (request) => {
		const url = new URL(request.url);
		if (request.method === "POST" && url.pathname === commits(conversation)) posted.push(request.text());
		if (url.pathname.endsWith("/mls/queue")) reads.push(url.search);
	});
	const due: string[] = [];
	const aResults: Record<string, unknown>[] = [];
	const bResults: Record<string, unknown>[] = [];
	const a = await firstDevice(fake, ana, { host: hostOf(due, aResults, given.aFails) });
	const b = await firstDevice(fake, bo, { host: hostOf(due, bResults) });
	await a.engine.openConversation(conversation);
	await sameGroup([a, b], conversation);
	return { fake, ana, bo, a, b, conversation, due, posted, reads, aResults, bResults };
}

const invalids = (results: Record<string, unknown>[]) => results.filter((result) => result.invalid === true);

describe.skipIf(!coreLibrary)("a device's commits", () => {
	test(
		"a losing commit applies the winner and tries again",
		async () => {
			const { fake, a, b, conversation, due, posted, aResults, bResults } = await dm();
			// Both renew their leaves at once: their commits reach the API together, for the same epoch.
			due.push(conversation);
			fake.gather({ method: "POST", path: commits(conversation) }, 2);
			const before = posted.length;
			a.clock.advance(DAY);
			b.clock.advance(DAY);
			// The loser was told so, applied the winner's commit, and renewed its leaf on top of it.
			await until(() => posted.length === before + 3);
			await sameGroup([a, b], conversation);
			const lost = [...aResults, ...bResults].filter((result) => result.accepted === false);
			expect(lost).toEqual([{ cmd: "commit_result", conversation_id: conversation, accepted: false }]);
			const renewals = (await a.api.queue(conversation, 2)).entries.filter((entry) => entry.kind === "commit");
			expect(renewals.map((entry) => entry.epoch)).toEqual([1, 2]);
			expect(new Set(renewals.map((entry) => entry.sender_user)).size).toBe(2);
		},
		SLOW,
	);

	test(
		"a commit cut before its answer settles",
		async () => {
			const { fake, a, b, conversation, due, posted, aResults } = await dm();
			due.push(conversation);
			const path = { method: "POST", path: commits(conversation) };
			// The group's creation went first.
			const sent = (n: number) => posted.length === n + 1;

			// With its bytes: its answer is lost, and the same request goes again, which the API answers as it did.
			fake.loseAnswer(path);
			a.clock.advance(DAY);
			await until(() => sent(1));
			await until(() => (a.clock.advance(2_000), sent(2)));
			expect(await posted[2]).toBe(await posted[1]!);
			await sameGroup([a, b], conversation);
			expect(invalids(aResults)).toEqual([]);

			// Without them: the app stops after the API took it, its answer lost. Started again (with nothing due, so it
			// renews nothing at its start), the queue settles it.
			fake.loseAnswer(path);
			a.clock.advance(DAY);
			await until(() => sent(3));
			due.length = 0;
			const again = await restarted(fake, a);
			await sameGroup([again, b], conversation);
			expect((await groupOf(again, conversation))!.epoch).toBe(3);
			expect(invalids(aResults)).toEqual([]);

			// Without them, and it never reached the API: the queue doesn't have it, and a minute after the start it's
			// said to be refused. Then the device commits again.
			due.push(conversation);
			fake.cutRequest(path);
			again.clock.advance(DAY);
			await until(() => sent(4));
			due.length = 0;
			const third = await restarted(fake, again);
			expect(invalids(aResults)).toEqual([]);
			third.clock.advance(60_000);
			await until(() => invalids(aResults).length === 1);
			due.push(conversation);
			third.clock.advance(DAY);
			await until(() => sent(5));
			const held = await sameGroup([third, b], conversation);
			expect(held.epoch).toBe(4);
		},
		SLOW,
	);

	test(
		"invalid is said only for a refused or unsent commit",
		async () => {
			const { fake, a, b, conversation, due, posted, aResults } = await dm();
			due.push(conversation);
			const path = { method: "POST", path: commits(conversation) };
			// The group's creation went first.
			const sent = (n: number) => posted.length === n + 1;

			// A refusal of the validator's (422): the commit never entered.
			fake.refuse(path, 422, { error: "commit refused", code: "invalid_commit" });
			a.clock.advance(DAY);
			await until(() => invalids(aResults).length === 1);
			expect(invalids(aResults)).toEqual([
				{ cmd: "commit_result", conversation_id: conversation, accepted: false, invalid: true },
			]);

			// A commit never sent, the app started again: not before a minute from the start, nor with the queue behind.
			fake.cutRequest(path);
			a.clock.advance(DAY);
			await until(() => sent(2));
			due.length = 0;
			const again = await restarted(fake, a);
			again.clock.advance(59_000);
			await Bun.sleep(200);
			expect(invalids(aResults)).toHaveLength(1);
			fake.refuse({ method: "GET", path: `/api/users/@me/conversations/${conversation}/mls/queue` }, 500, {
				error: "internal server error",
			});
			again.clock.advance(1_000);
			await Bun.sleep(500);
			expect(invalids(aResults)).toHaveLength(1);
			// The queue read again, whole, a minute past the start: now it's said.
			await until(() => (again.clock.advance(2_000), invalids(aResults).length === 2));
			due.push(conversation);
			again.clock.advance(DAY);
			await until(() => sent(3));
			await sameGroup([again, b], conversation);
		},
		SLOW,
	);

	test(
		"a due commit is made after a random wait, and whoever loses finds it done",
		async () => {
			const fake = new FakeApi();
			const [ana, bo] = [fake.addUser(), fake.addUser()];
			const conversation = fake.addConversation({ type: "dm", members: [ana, bo] });
			let posts = 0;
			useFake(fake, (request) => {
				if (request.method === "POST" && new URL(request.url).pathname === commits(conversation)) posts++;
			});
			const a = await firstDevice(fake, ana);
			const b1 = await firstDevice(fake, bo);
			const b2 = await approvedDevice(fake, b1);
			const b3 = await approvedDevice(fake, b1);
			await a.engine.openConversation(conversation);
			await sameGroup([a, b1, b2, b3], conversation);
			const third = b3.registered[0]!;

			// Bo's first device takes his third off his list: his listed devices then hold a leaf no list has.
			const random = spyOn(Math, "random").mockReturnValue(0.5);
			fake.gather({ method: "POST", path: commits(conversation) }, 2);
			const before = posts;
			const signed = await b1.host.handle<{ device_list: string }>({ cmd: "sign_device_list", remove: [third] });
			const served = await b1.api.identity(bo);
			const { version } = await b1.api.putDeviceList({
				device_list: signed.device_list,
				base_version: served.device_list_version,
			});
			await b1.host.handle({ cmd: "device_list_uploaded", version });

			// Each of his two devices waits a random while (half of 5 s) before it takes the leaf out.
			await until(() => random.mock.calls.length >= 2);
			b1.clock.advance(2_000);
			b2.clock.advance(2_000);
			await Bun.sleep(300);
			expect(posts).toBe(before);
			b1.clock.advance(500);
			b2.clock.advance(500);
			// One takes the epoch; the other, told it lost, applies it and finds nothing left to do.
			await until(() => posts === before + 2);
			await until(async () => !(await groupOf(a, conversation))!.devices.some((d) => d.device_id === third));
			const held = await sameGroup([a, b1, b2], conversation);
			expect(held.devices.map((device) => device.device_id)).not.toContain(third);
			await Bun.sleep(300);
			expect(posts).toBe(before + 2);
			const after = (await a.api.queue(conversation, 2)).entries.filter((entry) => entry.kind === "commit");
			expect(after).toHaveLength(1);
		},
		SLOW,
	);

	test(
		"the weekly refresh commits where it's due",
		async () => {
			const { fake, ana, bo, a, b, conversation, due, posted } = await dm();
			// A second conversation of theirs, whose renewal isn't due.
			const other = fake.addConversation({ type: "group", members: [ana, bo], owner: ana });
			await a.engine.openConversation(other);
			await sameGroup([a, b], other);
			due.push(conversation);
			const before = posted.length;
			a.clock.advance(DAY);
			await until(() => posted.length === before + 1);
			const held = await sameGroup([a, b], conversation);
			expect(held.epoch).toBe(2);
			expect((await groupOf(b, other))!.epoch).toBe(1);
		},
		SLOW,
	);

	// M1: only the validator's refusal (422) says a commit never entered. A resend whose first send the API took is
	// refused otherwise when, in between, the device went off its list (403): the queue says what became of it.
	test(
		"a refusal other than the validator's leaves the commit to the queue",
		async () => {
			const { fake, a, b, conversation, due, posted, aResults } = await dm();
			due.push(conversation);
			const path = { method: "POST", path: commits(conversation) };
			// The group's creation went first.
			const sent = (n: number) => posted.length === n + 1;
			// The API takes the renewal, its answer lost; the same bytes, sent again, are refused.
			fake.loseAnswer(path);
			a.clock.advance(DAY);
			await until(() => sent(1));
			fake.refuse(path, 403, { error: "this device isn't on your device list" });
			await until(() => (a.clock.advance(2_000), posted.length >= 3));
			await until(() => aResults.some((result) => result.accepted === false));
			expect(invalids(aResults)).toEqual([]);
			// The queue brings it back as the device's own: its group goes on, renewed once.
			const held = await sameGroup([a, b], conversation);
			expect(held).toMatchObject({ epoch: 2, blocked: false });
			expect(posted).toHaveLength(3);
		},
		SLOW,
	);

	// M5: the refusal said of a commit whose bytes went with the app is said again until the core takes it: a call cut
	// before the core's answer leaves the commit waiting otherwise, and the device can't commit there.
	test(
		"a refusal said of a lost commit is said again when the core's call fails",
		async () => {
			let failed = false;
			const { fake, a, b, conversation, due, posted, aResults } = await dm({
				aFails: (cmd, command) => {
					if (cmd !== "commit_result" || command.invalid !== true || failed) return null;
					failed = true;
					return new CoreError("internal", "the call was cut");
				},
			});
			due.push(conversation);
			const path = { method: "POST", path: commits(conversation) };
			// The group's creation went first.
			const sent = (n: number) => posted.length === n + 1;
			// A renewal that never reached the API, the app started again: a minute on, the refusal is said, and the
			// core's call fails.
			fake.cutRequest(path);
			a.clock.advance(DAY);
			await until(() => sent(1));
			due.length = 0;
			const again = await restarted(fake, a);
			again.clock.advance(60_000);
			await until(() => invalids(aResults).length >= 1);
			// The next turn says it again; then the device commits once more.
			await until(() => (again.clock.advance(2_000), invalids(aResults).length >= 2), 15_000);
			due.push(conversation);
			again.clock.advance(DAY);
			await until(() => sent(2));
			const held = await sameGroup([again, b], conversation);
			expect(held.epoch).toBe(2);
		},
		SLOW,
	);

	// M7: the renewals due go one conversation after another, and one that fails is logged: the others still go.
	test(
		"a renewal that fails doesn't stop the others",
		async () => {
			let failing: string | null = null;
			const { fake, ana, bo, a, b, conversation, due } = await dm({
				aFails: (cmd, command) =>
					cmd === "refresh" && command.conversation_id === failing
						? new CoreError("internal", "the call was cut")
						: null,
			});
			const other = fake.addConversation({ type: "group", members: [ana, bo], owner: ana });
			await a.engine.openConversation(other);
			await sameGroup([a, b], other);
			// Both are due, and the first one's renewal fails.
			failing = conversation;
			due.push(conversation, other);
			a.clock.advance(DAY);
			await until(async () => (await groupOf(b, other))?.epoch === 2, 15_000);
			expect((await groupOf(a, conversation))!.epoch).toBe(1);
		},
		SLOW,
	);
});
