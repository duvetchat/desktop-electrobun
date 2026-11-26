import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { base64Bytes } from "$lib/activity-thumbnail";
import { cbor, certificateDevice, commitmentDevice, listDevices } from "./cbor";
import { cleanName, drawnAs, readApprovalFrame, sniffType, thumbnailDrawn } from "./conventions";
import { shownFile } from "./engine/files";
import { entryOf } from "./engine/sync";

// What step 5's fuzzing kept (fuzz.test.ts, PLAN-E2E-CLIENTES.md, «Lo que el paso 5 revisa»): inputs of another device
// or of the server, each with the desktop's answer, which this holds the desktop to. The mobile app's fuzz task copies
// the file and holds its own readers to the same answers: where they differ, the two engines separate (Review Focus 9).
// Read as JSON, not imported: its type is a few hundred cases'.
const corpus: Record<string, any> = JSON.parse(
	readFileSync(join(import.meta.dir, "testing/e2e-fuzz-corpus.json"), "utf8"),
);
const cases = (reader: string): any[] => corpus[reader] ?? [];
/** A reader's answers to its cases, beside the corpus's: a difference shows by its case's place. */
const holds = (reader: string, read: (c: any) => unknown, answer: (c: any) => unknown) => {
	const all = cases(reader);
	expect(all.length).toBeGreaterThan(0);
	expect(all.map(read)).toEqual(all.map(answer));
};
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value ?? null));

describe("the fuzz corpus both apps read", () => {
	test("the seeds a real core made name their devices", () => {
		const { seeds } = corpus;
		expect(certificateDevice(seeds.certificate)).toBe(seeds.certificate_device);
		expect(listDevices(seeds.device_list)).toEqual(seeds.list_devices);
		expect(commitmentDevice(seeds.commitment)).toBe(seeds.commitment_device);
	});

	test("approval frames", () => {
		holds(
			"approval_frames",
			(c) => readApprovalFrame(c.message),
			(c) => c.frame,
		);
	});

	test("files' names", () =>
		holds(
			"names",
			(c) => cleanName(c.name),
			(c) => c.clean,
		));

	test("files' types, by their bytes", () =>
		holds(
			"types",
			(c) => sniffType(base64Bytes(c.bytes)),
			(c) => c.type,
		));

	test("thumbnails drawn, by their headers", () => {
		holds(
			"thumbnails",
			(c) => thumbnailDrawn(base64Bytes(c.bytes)),
			(c) => c.drawn,
		);
	});

	test("what a message is drawn as", () =>
		holds(
			"drawn",
			(c) => drawnAs(c.message, c.sticker),
			(c) => c.drawn,
		));

	test("CBOR read or refused", () =>
		holds(
			"cbor",
			(c) => cbor(base64Bytes(c.bytes)) !== null,
			(c) => c.read,
		));

	test("the device a certificate names", () => {
		holds(
			"certificates",
			(c) => certificateDevice(c.certificate),
			(c) => c.device,
		);
	});

	test("the devices a list names", () =>
		holds(
			"device_lists",
			(c) => listDevices(c.list),
			(c) => c.devices,
		));

	test("the device a commitment names", () => {
		holds(
			"commitments",
			(c) => commitmentDevice(c.commitment),
			(c) => c.device,
		);
	});

	test("a file of a message, as it's shown", () =>
		holds(
			"shown_files",
			(c) => asJson(shownFile(c.file)),
			(c) => c.shown,
		));

	test("the entry an event carries", () => {
		holds(
			"event_entries",
			(c) => asJson(entryOf(c.event)),
			(c) => c.entry,
		);
	});
});
