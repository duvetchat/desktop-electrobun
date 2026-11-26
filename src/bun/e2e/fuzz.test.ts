import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { commitmentDevice } from "../../mainview/src/lib/e2e/cbor";
import { canonicalBytes } from "../../mainview/src/lib/e2e/conventions";
import { E2E_OPS, OWN_WAY, type E2eReply } from "../../mainview/src/lib/e2e/host";
import {
	base64,
	base64As,
	cborBytes,
	json,
	mutate,
	Random,
	runs,
	SEED,
	text,
	timed,
	type CborValue,
} from "../../mainview/src/lib/e2e/testing/fuzz";
import { readCommitment } from "./confirm";
import { CoreStopped, type CoreWorker, type WorkerReply } from "./core";
import { CONFIRMED, CORE_COMMANDS, e2eBoundary } from "./rpc";

// Step 5's fuzzing of Bun's half of the desktop's boundary (PLAN-E2E-CLIENTES.md, «Lo que el paso 5 revisa»): what the
// page asks, as a script in it could, and the commitment Bun reads for the native box. The page's fuzzing, its seeds and
// its corpus are src/mainview/src/lib/e2e/fuzz.test.ts's.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Thousands of inputs a reader: on a loaded runner, past bun's 5 s a test; a long run's, hours.
setDefaultTimeout(process.env.DUVET_FUZZ_RUNS ? 6 * 3_600_000 : 60_000);

const CORPUS = join(import.meta.dir, "../../mainview/src/lib/e2e/testing/e2e-fuzz-corpus.json");
/** The commitment a real core made, which the page's fuzz test keeps in its corpus. */
const seeded: string | undefined = existsSync(CORPUS)
	? JSON.parse(readFileSync(CORPUS, "utf8")).seeds?.commitment
	: undefined;

/** A commitment as the core writes one: the map of v, user, device, its two keys and the hash, in the core's order. */
const FIELDS = [
	["v", 0],
	["user", 16],
	["device", 16],
	["signature_key", 32],
	["hpke_key", 32],
	["hash", 32],
] as const;
const commitmentOf = (rng: Random) =>
	new Map<string, CborValue>(FIELDS.map(([key, size]) => [key, key === "v" ? 1 : rng.bytes(size)]));
/** The device a commitment made here names. */
const deviceOf = (map: Map<string, CborValue>) => {
	const device = map.get("device");
	if (!(device instanceof Uint8Array)) throw new Error("a commitment made here names a device");
	return device;
};
const uuidOf = (bytes: Uint8Array) =>
	Buffer.from(bytes)
		.toString("hex")
		.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");

describe("what Bun reads of the page", () => {
	test("the commitment of an approval's offer, which the native box names", () => {
		const rng = new Random(SEED + 10);
		const pool = seeded ? [canonicalBytes(seeded)!] : [];
		for (let n = runs(4000); n > 0; n--) {
			const map = commitmentOf(rng);
			let given: string;
			let device: string | null | undefined;
			switch (rng.int(8)) {
				case 0:
					given = base64(cborBytes(map));
					device = uuidOf(deviceOf(map));
					break;
				case 1: {
					// Its fields in another order, which the core's own reader takes too.
					const fields = [...map];
					for (let i = fields.length - 1; i > 0; i--) {
						const j = rng.int(i + 1);
						[fields[i], fields[j]] = [fields[j], fields[i]];
					}
					given = base64(cborBytes(new Map(fields)));
					device = uuidOf(deviceOf(map));
					break;
				}
				case 2: {
					// A field gone, one more, one of another length, or a v that isn't 1.
					const key = rng.pick(FIELDS)[0];
					if (rng.chance(0.25)) map.delete(key);
					else if (rng.chance(0.3)) map.set(text(rng, 6).toWellFormed() || "x", rng.bytes(16));
					else map.set(key, key === "v" ? rng.pick([0, 2, "1", 256]) : rng.bytes(rng.pick([0, 15, 17, 31, 33])));
					given = base64(cborBytes(map));
					break;
				}
				case 3:
					// Heads wider than the core writes them: the page's reader takes those, Bun's doesn't.
					given = base64(cborBytes(map, rng));
					break;
				case 4:
					given = base64(mutate(rng, pool.length && rng.chance() ? rng.pick(pool) : cborBytes(map), pool));
					break;
				case 5:
					given = base64As(rng, cborBytes(map));
					break;
				case 6:
					given = seeded ?? base64(cborBytes(map));
					if (seeded) device = commitmentDevice(seeded);
					break;
				default:
					given = rng.chance() ? text(rng, 40) : base64(rng.bytes(rng.int(240)));
			}
			const read = timed(
				() => readCommitment(given),
				() => given,
			);
			if (device !== undefined) expect(read?.device ?? null).toBe(device);
			if (!read) continue;
			expect(read.user).toMatch(UUID);
			expect(read.device).toMatch(UUID);
			// The bytes are the commitment's, as the core reads its base64, and the page names the same device of them.
			expect(canonicalBytes(given)).toEqual(new Uint8Array(read.bytes));
			expect(commitmentDevice(given)).toBe(read.device);
		}
	});

	test("the boundary's requests, as a script in the page could send them", async () => {
		const rng = new Random(SEED + 11);
		const isRecord = (value: unknown): value is Record<string, any> =>
			typeof value === "object" && value !== null && !Array.isArray(value);
		const command = (): Record<string, unknown> => {
			const cmd = rng.chance(0.85)
				? rng.pick([...CORE_COMMANDS, ...OWN_WAY, "approval_from_qr"])
				: rng.pick(["__proto__", "constructor", "toString", text(rng, 8)]);
			const made: Record<string, unknown> = { cmd };
			if (cmd === "approval_offer") {
				made.commitment = rng.pick([base64(cborBytes(commitmentOf(rng))), "A".repeat(600), json(rng, 1)]);
			}
			if (cmd === "sign_device_list" || cmd === "rotate_keys") {
				made.remove = rng.chance(0.8) ? Array.from({ length: rng.int(3) }, () => rng.uuid()) : json(rng, 1);
			}
			if (cmd === "verify_user") {
				made.user_id = rng.chance(0.9) ? rng.uuid() : json(rng, 0);
				if (rng.chance(0.8)) made.digits = rng.pick(["12345", "00000", 12345]);
				if (rng.chance(0.2)) made.qr = "AAAA";
			}
			return made;
		};
		const params = (op: unknown): unknown => {
			switch (op) {
				case "open":
				case "destroy":
					return { userId: rng.chance(0.8) ? rng.uuid() : json(rng, 1) };
				case "handle":
					return { command: rng.chance(0.9) ? command() : json(rng, 2) };
				case "sealParts":
				case "openParts": {
					const parts = rng.pick([[], ["AAAA"], new Array(17).fill("AAAA"), [5], "AAAA", ["A".repeat(90_000)]]);
					const index = rng.pick([0, 1, -1, 1.5, "0"]);
					return { key: text(rng, 8), attachmentId: rng.uuid(), index, last: rng.pick([true, false, "true"]), parts };
				}
				case "stash":
					return {
						shareId: text(rng, 8),
						n: rng.pick([0, 63, 64, -1]),
						part: rng.pick(["AAAA", 5, "A".repeat(1_500_000)]),
					};
				default:
					return rng.chance() ? { shareId: rng.chance() ? text(rng, 8) : 5, n: rng.int(3) } : json(rng, 2);
			}
		};
		// Counted by the requests sent, as a long run counts its inputs.
		for (let requests = 0; requests < runs(1800); ) {
			const ran: { op: string; params: any }[] = [];
			const answers: boolean[] = [];
			const replies: E2eReply[] = [];
			const start = (): CoreWorker => ({
				run: async (op, given): Promise<WorkerReply> => {
					ran.push({ op, params: given });
					if (rng.chance(0.02)) throw new CoreStopped();
					if (op === "open") return { ok: { state: "ready", keyStorage: "file", handle: 1 } };
					const handled: unknown = isRecord(given) ? given.command : undefined;
					const cmd = op === "handle" && isRecord(handled) ? handled.cmd : null;
					if (cmd === "safety_number") return { ok: { digits: "12345", qr: "AAAA" } };
					if (cmd === "status") return { ok: { waiting_upload: null } };
					return rng.chance(0.8) ? { ok: { ran: op } } : { error: { code: rng.pick(["internal", "not_found"]) } };
				},
				stop: () => {},
			});
			const confirm = async () => {
				const yes = rng.chance();
				answers.push(yes);
				return yes;
			};
			const send = e2eBoundary({ start, confirm, reply: (reply) => void replies.push(reply) });
			const sent: number[] = [];
			let id = 1;
			const count = 1 + rng.int(24);
			requests += count;
			for (let n = count; n > 0; n--) {
				const op = rng.chance(0.9) ? rng.pick(E2E_OPS) : rng.pick(["handle ", "__proto__", "", 5]);
				const message = rng.chance(0.05)
					? json(rng, 2)
					: {
							id: rng.chance(0.9) ? id++ : rng.pick([0, -1, 1.5, "1", 2 ** 53, null]),
							op,
							params: params(op),
							instance: rng.chance(0.9) ? 1 : rng.pick([0, 2, "1", null]),
						};
				expect(() => send(message)).not.toThrow();
				const asked = isRecord(message) ? message.id : undefined;
				if (typeof asked === "number" && Number.isSafeInteger(asked) && asked >= 1) sent.push(asked);
			}
			for (let waited = 0; replies.filter((r) => r.id !== 0).length < sent.length; waited++) {
				if (waited > 500) throw new Error("a request got no reply");
				await new Promise((resolve) => setTimeout(resolve, 1));
			}
			// Each request its one reply, in the order they came, its ok or its error with a code.
			expect(replies.filter((r) => r.id !== 0).map((r) => r.id)).toEqual(sent);
			for (const reply of replies) if (reply.error) expect(typeof reply.error.code).toBe("string");
			// The core ran its contract's commands alone, none with a way of its own, and each confirmed one after a yes.
			for (const { op, params: given } of ran) {
				if (op !== "handle") continue;
				expect(CORE_COMMANDS.has(given.command.cmd)).toBe(true);
				expect(OWN_WAY).not.toContain(given.command.cmd);
			}
			const confirmed = ran.filter(({ op, params: given }) => op === "handle" && CONFIRMED.has(given.command.cmd));
			expect(confirmed.length).toBeLessThanOrEqual(answers.filter(Boolean).length);
		}
	});
});
