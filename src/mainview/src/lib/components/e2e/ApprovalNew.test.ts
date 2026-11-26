import { describe, expect, test } from "bun:test";
import { render } from "svelte/server";
import type { DeviceSetup } from "$lib/e2e/engine/engine";
import { CoreError } from "$lib/e2e/errors";
import { NOTICES } from "$lib/e2e/notices";
import en from "../../../../messages/en.json";
import { tags } from "../server-render";

// A new device approved by another (PLAN-E2E-CLIENTES.md, Task 26): its QR, which Android scans, or by the code another
// device shows: the fingerprint of what it asks, then an empty field for the six digits, which the person types.
const { default: ApprovalNew, codeProblem } = await import("./ApprovalNew.svelte");

const QR: DeviceSetup = { way: "qr", qr: "omRib2R5WJ6mYXYBZHVzZXJQAaIWJgrbcxy3GiqjObVAXGZkZXZpY2VQ" };
const FINGERPRINT = "0123 4567 89ab cdef";
const code = (offered: boolean, accepted = false): DeviceSetup => ({
	...{ way: "code", fingerprint: FINGERPRINT },
	...{ offered, accepted },
});
const props = (setup: DeviceSetup) => ({ setup, onUseCode: async () => {}, onAcceptCode: async () => {} });
const drawn = (setup: DeviceSetup) => render(ApprovalNew, { props: props(setup) }).body.replace(/<!--[^]*?-->/g, "");
const inputs = async (setup: DeviceSetup) =>
	(await tags(ApprovalNew, props(setup))).filter((tag) => tag.name === "input");

describe("a new device's approval", () => {
	test("shows its QR to scan, and offers a code instead", async () => {
		const html = drawn(QR);
		expect(html).toContain('role="img"');
		expect(html).toContain(en.e2e_setup_qr_line);
		expect(html).toMatch(new RegExp(`<button [^>]*>\\s*${NOTICES.use_code}\\s*</button>`));
		expect(await inputs(QR)).toEqual([]);
	});

	test("by the code: its fingerprint while the person's other device asks, then an empty field", async () => {
		const waiting = drawn(code(false));
		expect(waiting).toContain(FINGERPRINT);
		expect(waiting).toContain(en.e2e_code_waiting);
		expect(waiting).not.toContain('role="img"');
		expect(await inputs(code(false))).toEqual([]);

		// An approver offered: the field shows, empty, for the six digits that device shows, never filled in for them.
		const offered = drawn(code(true));
		expect(offered).toContain(FINGERPRINT);
		expect(offered).toContain(NOTICES.approval_code_hint);
		const [field, ...more] = await inputs(code(true));
		expect(more).toEqual([]);
		expect(field?.attributes).toMatchObject({
			...{ inputmode: "numeric", autocomplete: "off", maxlength: "6", pattern: "[0-9]{6}" },
		});
		expect(field?.attributes.value ?? "").toBe("");

		// Accepted, it says so, and waits for the confirmation.
		const accepted = drawn(code(true, true));
		expect(accepted).toContain(NOTICES.code_accepted);
		expect(await inputs(code(true, true))).toEqual([]);
	});

	test("says what went wrong in the person's words", () => {
		expect(codeProblem(new CoreError("rule_violation", "", { rule: "code_mismatch" }))).toBe("e2e_code_mismatch");
		expect(codeProblem(new CoreError("not_found", "", { what: "approver" }))).toBe("e2e_no_approver");
		expect(codeProblem(new CoreError("not_found", "", { what: "approval" }))).toBe("e2e_approval_over");
		expect(codeProblem(new TypeError("fetch failed"))).toBe("e2e_setup_failed");
		expect(en.e2e_code_mismatch).toBe(NOTICES.code_mismatch);
		expect(en.e2e_use_code).toBe(NOTICES.use_code);
	});

	// Review M4: a lost race on the approval path says so.
	test("a list another device put up first says to set up again", () => {
		expect(codeProblem(new CoreError("list_changed", ""))).toBe("e2e_setup_again");
	});
});
