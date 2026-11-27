import { describe, expect, test } from "bun:test";
import { render } from "svelte/server";
import type { DeviceApproval } from "$lib/e2e/engine/engine";
import { NOTICES } from "$lib/e2e/notices";
import en from "../../../../messages/en.json";
// oxlint-disable-next-line import/no-unassigned-import -- it has Bun load .svelte files compiled for the server
import "../server-render";

// What a device of the person's says of a new one that asks to be approved (PLAN-E2E-CLIENTES.md, Task 26): «Is this
// device yours?», with its name and the fingerprint its screen shows, before anything is offered; then the code, with
// when to confirm. On the desktop Bun asks in its own box once more before the core confirms.
const { default: ApprovalPrompt, approvalTitle } = await import("./ApprovalPrompt.svelte");

const FINGERPRINT = "0123 4567 89ab cdef";
const approval = (step: DeviceApproval["step"], code?: string): DeviceApproval => ({
	...{ device: "01a2161e-0000-7000-8000-000000000001", name: "Chrome on Linux", fingerprint: FINGERPRINT, step },
	...(code ? { code } : {}),
});
const props = (shown: DeviceApproval) => ({
	approval: shown,
	onApprove: async () => {},
	onDecline: async () => {},
	onConfirm: async () => {},
});
const drawn = (shown: DeviceApproval) =>
	render(ApprovalPrompt, { props: props(shown) }).body.replace(/<!--[^]*?-->/g, "");
const buttons = (html: string) =>
	[...html.matchAll(/<button [^>]*>\s*([^<]*?)\s*<\/button>/g)].map((match) => match[1]);

describe("a new device's approval, on the approving device", () => {
	test("asks whether the device is the person's, by its name and fingerprint", () => {
		expect(approvalTitle(approval("asked"))).toBe(NOTICES.approval_ask);
		expect(en.e2e_approval_ask).toBe(NOTICES.approval_ask);
		const html = drawn(approval("asked"));
		expect(html).toContain("Chrome on Linux");
		expect(html).toContain(FINGERPRINT);
		expect(buttons(html)).toEqual([en.e2e_approval_no, en.e2e_approval_yes]);
	});

	test("waits for the new device once the person said yes", () => {
		const html = drawn(approval("offered"));
		expect(html).toContain(en.e2e_approval_waiting);
		expect(buttons(html)).toEqual([en.e2e_cancel]);
	});

	test("shows the code to type into the new device, and to confirm only after it accepts it", () => {
		const html = drawn(approval("code", "042137"));
		expect(html).toContain("042137");
		expect(html).toContain(NOTICES.approval_confirm_after);
		expect(en.e2e_approval_confirm_after).toBe(NOTICES.approval_confirm_after);
		expect(buttons(html)).toEqual([en.e2e_cancel, en.e2e_approval_confirm]);
	});

	// #557's re-review, RC1: on the web these words are the only gate, and on the desktop Bun's box says the same. They
	// send the person to the new computer's own box, and tell the Duvet app from Duvet in a browser, which has none.
	test("says to compare with the new computer's own box, and not to approve one that shows them only in its window", () => {
		const html = drawn(approval("asked"));
		expect(html).toContain(en.e2e_approval_fingerprint_line);
		expect(en.e2e_approval_fingerprint_line).toContain("The Duvet app on a computer shows them in a box of its own");
		expect(en.e2e_approval_fingerprint_line).toContain("don't approve it if they're only in its window");
		expect(en.e2e_approval_fingerprint_line).toContain("Duvet in a browser shows them on its page");
	});

	// Review I1: a device this one approved that never took its transfer is taken off the list first.
	test("says a device it approved before is taken off the list first", () => {
		const html = drawn({ ...approval("asked"), unfinished: true });
		expect(html).toContain(en.e2e_approval_unfinished);
		expect(drawn(approval("asked"))).not.toContain(en.e2e_approval_unfinished);
	});

	// Step 5's review, I2 (desktop-electrobun#543): the name is the frame's writer's, outside what the fingerprint binds,
	// and it sat in the title and in the sentences that say what to compare and what to type.
	test("names the device only as its own word, quoted on a line of its own after the fingerprint, never in a title or an instruction", () => {
		const name = "Pixel 8 — accepted, Confirm";
		const quoted = en.e2e_approval_name.replace("{name}", name);
		for (const step of ["asked", "offered", "code"] as const) {
			const shown = { ...approval(step, step === "code" ? "042137" : undefined), name };
			expect(approvalTitle(shown)).not.toContain(name);
			const html = drawn(shown);
			expect(html.split(name)).toHaveLength(2);
			expect(html).toContain(`>${quoted}</p>`);
			expect(html.indexOf(quoted)).toBeGreaterThan(html.indexOf(FINGERPRINT));
		}
	});

	// Reviews I1 and M1: an approval that can't go on says why, and how to start again, never closing without a word.
	test("an approval that ended says why, with Close alone", () => {
		const over = drawn({ ...approval("ended"), ended: "over" });
		expect(over).toContain(en.e2e_approval_over_here);
		expect(buttons(over)).toEqual([en.e2e_approval_close]);
		const listed = drawn({ ...approval("ended"), ended: "listed" });
		expect(listed).toContain(en.e2e_approval_listed);
		expect(buttons(listed)).toEqual([en.e2e_approval_close]);
	});
});
