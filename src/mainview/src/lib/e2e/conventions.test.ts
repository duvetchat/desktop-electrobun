import { describe, expect, test } from "bun:test";
import { base64Bytes } from "$lib/activity-thumbnail";
import {
	approvalFrameMessage,
	cleanName,
	drawnAs,
	messageEnvelope,
	readApprovalFrame,
	sniffType,
	type ApprovalFrame,
} from "./conventions";
import conventions from "./testing/e2e-conventions.json";

// What the desktop and the mobile app do alike (PLAN-E2E-CLIENTES.md, «Convenciones entre clientes»): each case of the
// file both repositories carry, which the mobile app's conventions_test.dart reads too.
describe("the conventions between clients", () => {
	describe("a message's envelope", () => {
		for (const c of conventions.envelopes) {
			test(c.case, () => expect(messageEnvelope(c.text, c.attachments)).toEqual(c.envelope));
		}
	});

	describe("what a message is drawn as", () => {
		for (const c of conventions.messages) {
			test(c.case, () => {
				const drawn: string = drawnAs({ text: c.message.text, attachments: c.message.attachments }, c.sticker);
				expect(drawn).toBe(c.drawn);
			});
		}
	});

	describe("a file's name", () => {
		for (const c of conventions.names) test(c.case, () => expect(cleanName(c.name)).toBe(c.clean));
	});

	describe("a file's type, by its bytes", () => {
		for (const c of conventions.types) test(c.case, () => expect(sniffType(base64Bytes(c.bytes))).toBe(c.type));
	});

	describe("an approval frame in the inbox", () => {
		for (const c of conventions.approval_frames) {
			test(c.case, () => {
				const frame: ApprovalFrame | null = readApprovalFrame(c.message);
				expect<unknown>(frame).toEqual(c.frame);
				// A frame written again is the same message, byte for byte.
				if (frame) expect(approvalFrameMessage(frame)).toBe(c.message);
			});
		}
	});
});
