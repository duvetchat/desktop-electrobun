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
		expect(html).toContain(en.e2e_approval_waiting.replace("{name}", "Chrome on Linux"));
		expect(buttons(html)).toEqual([en.e2e_cancel]);
	});

	test("shows the code to type into the new device, and to confirm only after it accepts it", () => {
		const html = drawn(approval("code", "042137"));
		expect(html).toContain("042137");
		expect(html).toContain(NOTICES.approval_confirm_after);
		expect(en.e2e_approval_confirm_after).toBe(NOTICES.approval_confirm_after);
		expect(buttons(html)).toEqual([en.e2e_cancel, en.e2e_approval_confirm]);
	});
});
