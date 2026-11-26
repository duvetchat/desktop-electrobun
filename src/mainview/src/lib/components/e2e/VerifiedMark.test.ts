import { describe, expect, test } from "bun:test";
import { NOTICES } from "$lib/e2e/notices";
import en from "../../../../messages/en.json";
import { tags } from "../server-render";

// A verified contact's mark (PLAN-E2E-CLIENTES.md, Task 28): beside their name in their DM and their profile, named for
// whoever doesn't see it.
const { default: VerifiedMark } = await import("./VerifiedMark.svelte");

describe("a verified contact's mark", () => {
	test("is a picture named Verified, in the notices' words", async () => {
		const [mark] = await tags(VerifiedMark, {});
		expect(mark?.attributes).toMatchObject({ role: "img", "aria-label": NOTICES.verified, title: NOTICES.verified });
		expect(en.e2e_verified).toBe(NOTICES.verified);
	});
});
