import { describe, expect, test } from "bun:test";

// A message's edit box while its save waits for the engine's word (#578): since #577 a save answers once the engine
// took or refused the change, and until then the box takes nothing more. The module's runes: here $state is the value
// itself, as the stores' tests have it.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const { EditBox } = await import("./edit-box.svelte");

/** A save the test answers by hand (`answer`: nothing once taken, or a refusal's words), and each text it saves. */
function answered() {
	const asked: string[] = [];
	let answer: (said?: string) => void = () => {};
	const save = (text: string) => {
		asked.push(text);
		return new Promise<string | void>((resolve) => (answer = resolve));
	};
	return { asked, save, answer: (said?: string) => answer(said) };
}

describe("an edit's box while its save waits for the engine", () => {
	test("a second Save while the first waits makes no second edit", async () => {
		const { asked, save, answer } = answered();
		const box = new EditBox("before", save, () => {});
		box.type("after");
		const first = box.save();
		void box.save();
		expect(asked).toEqual(["after"]);
		expect(box.saving).toBe(true);
		answer("refused");
		await first;
		expect(box.saving).toBe(false);
		// Its answer came: the next Save is the next edit.
		void box.save();
		expect(asked).toEqual(["after", "after"]);
	});

	test("a Discard while a save waits closes nothing until the engine's word", async () => {
		let closed = 0;
		const { save, answer } = answered();
		const box = new EditBox("before", save, () => void closed++);
		const saving = box.save();
		box.discard();
		expect(closed).toBe(0);
		answer("couldn't be saved");
		await saving;
		// Refused, the box is still there to say why, and to discard.
		expect(box.refused).toBe("couldn't be saved");
		box.discard();
		expect(closed).toBe(1);
	});

	test("what's typed after Save leaves the text as it was saved, which a refusal finds in the box", async () => {
		const { save, answer } = answered();
		const box = new EditBox("before", save, () => {});
		box.type("saved");
		const saving = box.save();
		box.type("saved, then more");
		expect(box.text).toBe("saved");
		answer("couldn't be saved");
		await saving;
		expect([box.text, box.refused]).toEqual(["saved", "couldn't be saved"]);
		box.type("saved, then more");
		expect(box.text).toBe("saved, then more");
	});

	test("a save taken says nothing, and one that throws leaves the box as it was, ready again", async () => {
		const { save, answer } = answered();
		const box = new EditBox("before", save, () => {});
		const taken = box.save();
		answer();
		await taken;
		expect([box.saving, box.refused]).toEqual([false, null]);
		const failing = new EditBox(
			"before",
			() => Promise.reject(new Error("no turn")),
			() => {},
		);
		expect(
			await failing.save().then(
				() => null,
				(error: unknown) => error,
			),
		).toBeInstanceOf(Error);
		expect([failing.saving, failing.text]).toEqual([false, "before"]);
	});
});
