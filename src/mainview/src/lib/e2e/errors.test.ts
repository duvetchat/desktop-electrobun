import { describe, expect, test } from "bun:test";
import { CoreError, replyOk } from "./errors";

describe("CoreError", () => {
	test("is the core's error with its code and the fields beside it", () => {
		const error = CoreError.of({
			code: "needs_identities",
			message: "observe these users first",
			users: ["0193a4b2-0000-7000-8000-000000000001"],
		});
		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(CoreError);
		expect(error.code).toBe("needs_identities");
		expect(error.message).toBe("observe these users first");
		expect(error.users).toEqual(["0193a4b2-0000-7000-8000-000000000001"]);

		expect(CoreError.of({ code: "gap", message: "", from: 7 })).toMatchObject({ code: "gap", from: 7 });
		expect(CoreError.of({ code: "too_large", message: "", limit: 32768 }).limit).toBe(32768);
		expect(CoreError.of({ code: "rule_violation", message: "", rule: "stale_message" }).rule).toBe("stale_message");
		expect(CoreError.of({ code: "bad_command", message: "", field: "nonce" }).field).toBe("nonce");
		expect(CoreError.of({ code: "not_found", message: "", what: "group" }).what).toBe("group");
		expect(CoreError.of({ code: "decrypt_failed", message: "", kind: "envelope" }).kind).toBe("envelope");
	});

	test("takes no field the core didn't name, and an error without a message says its code", () => {
		const error = CoreError.of({ code: "storage", stack: "planted", name: "planted", extra: 1, from: "seven" });
		expect(error.name).toBe("CoreError");
		expect(error.message).toBe("storage");
		expect(Object.keys(error)).toEqual(["code"]);
	});
});

/** What replyOk throws for a reply. */
function thrown(reply: unknown): unknown {
	try {
		replyOk(reply);
	} catch (error) {
		return error;
	}
	return undefined;
}

describe("replyOk", () => {
	test("is a reply's ok, and an error reply throws its CoreError", () => {
		expect(replyOk({ ok: { handle: 3 } })).toEqual({ handle: 3 });
		const error = thrown({ error: { code: "locked", message: "another instance has the database open" } });
		expect(error).toBeInstanceOf(CoreError);
		expect(error).toMatchObject({ code: "locked", message: "another instance has the database open" });
	});

	test("a reply that is neither is internal", () => {
		for (const reply of [null, 3, {}, { ok: 1, error: { code: "locked" } }, { error: "locked" }, { error: {} }]) {
			expect(thrown(reply)).toMatchObject({ code: "internal" });
		}
	});
});
