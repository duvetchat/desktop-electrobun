/**
 * A UUIDv7 (RFC 9562): the time it was made in Unix milliseconds, its first 48 bits, then its version and random bits.
 * The IDs the client mints itself are these, a device's and a file's, so they sort by when they were made, as the API's
 * own IDs do (PLAN-E2E-CLIENTES.md, «Convenciones entre clientes»).
 */
export function uuidv7(now = Date.now()): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	for (let i = 5, ms = now; i >= 0; i--, ms = Math.floor(ms / 256)) bytes[i] = ms % 256;
	bytes[6] = (bytes[6]! & 0x0f) | 0x70;
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;
	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
