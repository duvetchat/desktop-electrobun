import { describe, expect, test } from "bun:test";
import qrcodeGenerator from "qrcode-generator";
import conventions from "$lib/e2e/testing/e2e-conventions.json";
import { tags } from "../server-render";

// A new device's QR (PLAN-E2E-CLIENTES.md, Task 26; Ruling 21): the core's `qr` as its text, which Android scans. Dark
// modules on light, with the standard's quiet zone of four modules, whatever the theme: an inverted code isn't read by
// every scanner.
const { default: QrCode } = await import("./QrCode.svelte");

// About the length of the core's `qr` in base64, as the desktop shows it.
const TEXT = `${"omRib2R5WJ6mYXYBZHVzZXJQAaIWJgrbcxy3GiqjObVAXGZkZXZpY2VQ".repeat(3)}AaIWJg24cA2oihmyjC6qjW1zaWduYXR1cmVf`;
const QUIET = 4;

/** The cells a path's runs paint: `M{x} {y}h{n}v1h-{n}z` each, one row of light cells. */
function painted(path: string): string[] {
	const cells: string[] = [];
	for (const [, x, y, n] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
		for (let at = 0; at < Number(n); at++) cells.push(`${Number(x) + at},${y}`);
	}
	return cells.sort();
}

describe("a QR", () => {
	// The convention both apps keep (e2e-conventions.json's approval_qr): the core's qr, as approval_begin gives it, is
	// the QR's text unchanged, in byte mode at level M, which the scanning device hands to approval_from_qr as it reads it.
	test("of a new device's approval is the core's qr as its text, at level M", async () => {
		const { qr, text, error_correction } = conventions.approval_qr;
		expect(text).toBe(qr);
		expect(error_correction).toBe("M");
		const code = qrcodeGenerator(0, "M");
		code.addData(text);
		code.make();
		const drawn = await tags(QrCode, { text: qr, label: "A code" });
		const side = code.getModuleCount() + 2 * QUIET;
		expect(drawn.find((tag) => tag.name === "svg")?.attributes.viewbox).toBe(`0 0 ${side} ${side}`);
	});

	// A security number's (Task 28; e2e-conventions.json's safety_qr): the core's qr, as safety_number gives it, is the
	// QR's text unchanged, at level M, which the other's phone hands to verify_user {user_id, qr} as it reads it.
	test("of a security number is the core's qr as its text, at level M", async () => {
		const { qr, text, error_correction } = conventions.safety_qr;
		expect(text).toBe(qr);
		expect(error_correction).toBe("M");
		// The core's code of two users: base64 of its {v, users} map, never anything the desktop writes itself.
		expect(atob(qr).length).toBeGreaterThan(64);
		const code = qrcodeGenerator(0, "M");
		code.addData(text);
		code.make();
		const drawn = await tags(QrCode, { text: qr, label: "A code" });
		const side = code.getModuleCount() + 2 * QUIET;
		expect(drawn.find((tag) => tag.name === "svg")?.attributes.viewbox).toBe(`0 0 ${side} ${side}`);
	});

	test("draws its text's code, dark on light, inside its quiet zone", async () => {
		const code = qrcodeGenerator(0, "M");
		code.addData(TEXT);
		code.make();
		const size = code.getModuleCount();
		const side = size + 2 * QUIET;
		const drawn = await tags(QrCode, { text: TEXT, label: "A code for setting up this device" });
		const svg = drawn.find((tag) => tag.name === "svg");
		expect(svg?.attributes).toMatchObject({
			...{ role: "img", "aria-label": "A code for setting up this device" },
			// As HTMLRewriter names it: in lower case.
			viewbox: `0 0 ${side} ${side}`,
		});
		// Black under the light cells the path paints white: the code reads the same in light and dark.
		expect(svg?.attributes.class).toContain("bg-black");
		const paths = drawn.filter((tag) => tag.name === "path");
		expect(paths).toHaveLength(1);
		expect(paths[0]?.attributes.class).toContain("fill-fixed-white");
		const light: string[] = [];
		for (let y = 0; y < side; y++) {
			for (let x = 0; x < side; x++) {
				const [row, col] = [y - QUIET, x - QUIET];
				const inside = row >= 0 && col >= 0 && row < size && col < size;
				if (!inside || !code.isDark(row, col)) light.push(`${x},${y}`);
			}
		}
		expect(painted(paths[0]?.attributes.d ?? "")).toEqual(light.sort());
	});
});
