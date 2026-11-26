import { describe, expect, test } from "bun:test";
import { cbor } from "./cbor";

// The CBOR the core writes its signed objects in, as the client reads it of what the server serves and another device
// sends: what step 5's fuzzing found (PLAN-E2E-CLIENTES.md, «Lo que el paso 5 revisa»).
describe("the CBOR reader", () => {
	test("a list whose length lies takes no memory for it", () => {
		// Five bytes say a list of 100,000,000 items follows. Each item takes a byte at least, so none is there.
		const before = process.memoryUsage().rss;
		expect(cbor(new Uint8Array([0x9a, 0x05, 0xf5, 0xe1, 0x00]))).toBeNull();
		expect(process.memoryUsage().rss - before).toBeLessThan(100 << 20);
	});
});
