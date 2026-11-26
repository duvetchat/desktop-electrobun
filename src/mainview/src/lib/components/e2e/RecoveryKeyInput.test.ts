import { describe, expect, test } from "bun:test";
import { render } from "svelte/server";
import { CoreError } from "$lib/e2e/errors";
import en from "../../../../messages/en.json";
import { tags } from "../server-render";

// The recovery key's field on a new device (PLAN-E2E-CLIENTES.md, Task 26; decision 22): the person types or pastes the
// 48 characters as they like, spaces and dashes too, which the core reads aside; nothing fills it in or corrects it.
const { default: RecoveryKeyInput, recoveryProblem } = await import("./RecoveryKeyInput.svelte");

const props = { onRecover: async () => {} };

describe("the recovery key's field", () => {
	test("takes the key as typed: nothing fills it in, completes it or corrects it", async () => {
		const drawn = await tags(RecoveryKeyInput, props);
		const [input] = drawn.filter((tag) => tag.name === "input");
		expect(input?.attributes).toMatchObject({
			...{ autocomplete: "off", autocorrect: "off", autocapitalize: "off", spellcheck: "false" },
		});
		expect(input?.attributes.value ?? "").toBe("");
		const html = render(RecoveryKeyInput, { props }).body;
		expect(html).toContain(en.e2e_recovery_key);
		expect(html).toContain(en.e2e_recovery_key_use);
	});

	test("says what went wrong in the person's words, and nothing for their no in Bun's box", () => {
		expect(recoveryProblem(new CoreError("bad_command", "", { field: "recovery_key" }))).toBe(
			"e2e_recovery_key_mistyped",
		);
		expect(recoveryProblem(new CoreError("decrypt_failed", ""))).toBe("e2e_recovery_key_wrong");
		expect(recoveryProblem(new CoreError("list_changed", ""))).toBe("e2e_setup_again");
		expect(recoveryProblem(new TypeError("fetch failed"))).toBe("e2e_setup_failed");
		expect(recoveryProblem(new CoreError("refused", ""))).toBeNull();
		for (const key of ["e2e_recovery_key_mistyped", "e2e_recovery_key_wrong", "e2e_setup_again", "e2e_setup_failed"]) {
			expect(Object.hasOwn(en, key)).toBe(true);
		}
	});
});
