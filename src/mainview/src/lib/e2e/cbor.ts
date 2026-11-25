// The CBOR the core writes its signed objects in (PLAN-E2E-API.md, its formats): read here only to tell which device a
// certificate is for, as the inbox names a sender by it; the core checks every signature. The fake API reads it too.
import { base64Bytes } from "$lib/activity-thumbnail";

export type Cbor = number | string | boolean | null | Uint8Array | Cbor[] | Map<string, Cbor>;

/** One CBOR value, as the core writes them: definite lengths, text keys, no tags; null for anything else. */
export function cbor(bytes: Uint8Array): Cbor | null {
	let at = 0;
	const take = (n: number) => {
		if (at + n > bytes.length) throw new Error("cut short");
		return bytes.subarray(at, (at += n));
	};
	const uint = (info: number): number => {
		if (info < 24) return info;
		const size = [1, 2, 4, 8][info - 24];
		if (size === undefined) throw new Error("no definite length");
		return take(size).reduce((value, byte) => value * 256 + byte, 0);
	};
	const item = (depth: number): Cbor => {
		if (depth > 32) throw new Error("nested too deep");
		const head = take(1)[0]!;
		const info = head & 31;
		switch (head >> 5) {
			case 0:
				return uint(info);
			case 1:
				return -1 - uint(info);
			case 2:
				return take(uint(info)).slice();
			case 3:
				return new TextDecoder("utf-8", { fatal: true }).decode(take(uint(info)));
			case 4:
				return Array.from({ length: uint(info) }, () => item(depth + 1));
			case 5: {
				const map = new Map<string, Cbor>();
				for (let n = uint(info); n > 0; n--) {
					const key = item(depth + 1);
					if (typeof key !== "string" || map.has(key)) throw new Error("not a text key, or one twice");
					map.set(key, item(depth + 1));
				}
				return map;
			}
			case 7:
				if (info === 20 || info === 21) return info === 21;
				if (info === 22) return null;
		}
		throw new Error("not a value the core writes");
	};
	try {
		const value = item(0);
		return at === bytes.length ? value : null;
	} catch {
		return null;
	}
}

export const asMap = (value: Cbor | null | undefined) => (value instanceof Map ? value : null);
export const asBytes = (value: Cbor | null | undefined, length?: number) =>
	value instanceof Uint8Array && (length === undefined || value.length === length) ? value : null;
export const asUuid = (value: Cbor | null | undefined) => {
	const bytes = asBytes(value, 16);
	if (!bytes) return null;
	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/** The device a certificate names (its signed object in base64: `{body, sig}`, its body's `device`), or null. */
export function certificateDevice(certificate: string): string | null {
	let signed: Uint8Array;
	try {
		signed = base64Bytes(certificate);
	} catch {
		return null;
	}
	const body = asBytes(asMap(cbor(signed))?.get("body"));
	return body ? asUuid(asMap(cbor(body))?.get("device")) : null;
}
