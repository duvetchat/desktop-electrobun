import { describe, expect, test } from "bun:test";
import { base64Bytes } from "$lib/activity-thumbnail";
import {
	approvalFingerprint,
	approvalFrameMessage,
	cleanName,
	drawnAs,
	messageEnvelope,
	readApprovalFrame,
	SNIFF_PREFIX,
	sniffType,
	THUMBNAIL_SIDE,
	thumbnailDrawn,
	type ApprovalFrame,
} from "./conventions";
import conventions from "./testing/e2e-conventions.json";

// What the desktop and the mobile app do alike (PLAN-E2E-CLIENTES.md, its conventions between clients): each case of the
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
		test("both apps read the same first bytes of a file", () => expect(SNIFF_PREFIX).toBe(conventions.sniff_prefix));
		for (const c of conventions.types) {
			test(c.case, () => {
				// A case's bytes, then as many zero bytes as it says, then its tail.
				const [head, tail] = [base64Bytes(c.bytes), base64Bytes(c.tail ?? "")];
				const bytes = new Uint8Array(head.length + (c.zeros ?? 0) + tail.length);
				bytes.set(head);
				bytes.set(tail, bytes.length - tail.length);
				expect(sniffType(bytes)).toBe(c.type);
			});
		}
	});

	describe("a thumbnail drawn, by its header", () => {
		test("both apps draw one the same longest side at most", () => {
			expect(THUMBNAIL_SIDE).toBe(conventions.thumbnails.most_side);
		});
		for (const c of conventions.thumbnails.cases) {
			test(c.case, () => expect(thumbnailDrawn(base64Bytes(c.bytes))).toBe(c.drawn));
		}
	});

	describe("an approval frame in the inbox", () => {
		for (const c of conventions.approval_frames) {
			test(c.case, () => {
				const frame: ApprovalFrame | null = readApprovalFrame(c.message);
				expect<unknown>(frame).toEqual(c.frame);
				// A frame written again is the same message byte for byte, or the one its cleaned name makes.
				if (frame) expect(approvalFrameMessage(frame)).toBe(c.rewritten ?? c.message);
			});
		}
	});

	describe("an approval's fingerprint, which the approving computer's box and the new device's screen show", () => {
		for (const c of conventions.approval_fingerprints) {
			test(c.case, async () => {
				expect(await approvalFingerprint(base64Bytes(c.commitment))).toBe(c.fingerprint);
			});
		}
	});
});

// What step 5's fuzzing found (PLAN-E2E-CLIENTES.md, «Lo que el paso 5 revisa»), which e2e-fuzz-corpus.json keeps too.
describe("what the fuzzers found", () => {
	// A surrogate's halves kept apart by a zero-width space: once it goes, they'd be U+E0001, a hidden tag character.
	const apart = "\uDB40​\uDC01";

	test("a hidden character between a surrogate's halves leaves no hidden character of their own", () => {
		expect(cleanName(`invoice${apart}.pdf`)).toBe("invoice��.pdf");
	});

	test("nor in a device's name, whose frame reads back as it was read", () => {
		const frame = { duvet: "approval", step: "offer", data: "b2Y=", name: `Ana${apart}` } as const;
		const read = readApprovalFrame(approvalFrameMessage(frame));
		expect(read).toEqual({ ...frame, name: "Ana��" });
		expect(readApprovalFrame(approvalFrameMessage(read!))).toEqual(read);
	});
});
