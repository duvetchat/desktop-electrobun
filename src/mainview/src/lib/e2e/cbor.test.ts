import { describe, expect, test } from "bun:test";
import { cbor, certificateDevice, commitmentDevice, listDevices } from "./cbor";

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));
const base64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
const DEVICE = "01020304-0506-0708-090a-0b0c0d0e0f10";
const ID = [0x50, ...Array.from({ length: 16 }, (_, i) => i + 1)];
/** A signed object as the core writes one: `{body, sig}`, its body the bytes given and its signature none. */
const [BODY, SIG] = [
	[0x64, ...ascii("body")],
	[0x63, ...ascii("sig"), 0x40],
];
const signed = (body: number[]) => [0xa2, ...BODY, 0x58, body.length, ...body, ...SIG];

// The CBOR the core writes its signed objects in, as the client reads it of what the server serves and another device
// sends: what step 5's fuzzing found (PLAN-E2E-CLIENTES.md, «Lo que el paso 5 revisa»).
describe("the CBOR reader", () => {
	test("a list whose length lies takes no memory for it", () => {
		// Five bytes say a list of 100,000,000 items follows. Each item takes a byte at least, so none is there.
		const before = process.memoryUsage().rss;
		expect(cbor(new Uint8Array([0x9a, 0x05, 0xf5, 0xe1, 0x00]))).toBeNull();
		expect(process.memoryUsage().rss - before).toBeLessThan(100 << 20);
	});

	test("a certificate, a list and a commitment are read only of base64 as the API and the core write it", () => {
		const certificate = base64(signed([0xa1, 0x66, ...ascii("device"), ...ID]));
		const list = base64(signed([0xa2, 0x67, ...ascii("devices"), 0x81, ...ID, 0x67, ...ascii("version"), 0x01]));
		const commitment = base64([0xa1, 0x66, ...ascii("device"), ...ID]);
		expect([certificateDevice(certificate), listDevices(list), commitmentDevice(commitment)]).toEqual([
			DEVICE,
			[DEVICE],
			DEVICE,
		]);
		// A value that isn't text, as the server's JSON can give one in its place ({"toString": 1} can't become text),
		// names nothing and throws nothing.
		const odd = JSON.parse('{"toString": 1}');
		expect([certificateDevice(odd), listDevices(odd), commitmentDevice(odd)]).toEqual([null, null, null]);
		// Without their padding, with a space or a line break in, with a stray bit past the bytes (their last character
		// before the padding, an A in each, made a B): none reads.
		const others = (text: string) => {
			const at = text.replace(/=+$/, "").length - 1;
			const stray = text.slice(0, at) + String.fromCharCode(text.charCodeAt(at) + 1) + text.slice(at + 1);
			return [text.replace(/=+$/, ""), ` ${text}`, `${text.slice(0, 4)}\n${text.slice(4)}`, stray];
		};
		for (const other of others(certificate)) expect(certificateDevice(other)).toBeNull();
		for (const other of others(list)) expect(listDevices(other)).toBeNull();
		for (const other of others(commitment)) expect(commitmentDevice(other)).toBeNull();
	});

	test("a list's devices are read only of a list with its version, as the core writes one", () => {
		const devices = [0x67, ...ascii("devices"), 0x81, ...ID];
		const version = [0x67, ...ascii("version")];
		expect(listDevices(base64(signed([0xa2, ...devices, ...version, 0x01])))).toEqual([DEVICE]);
		expect(listDevices(base64(signed([0xa1, ...devices])))).toBeNull();
		expect(listDevices(base64(signed([0xa2, ...devices, ...version, 0x61, ...ascii("1")])))).toBeNull();
	});
});
