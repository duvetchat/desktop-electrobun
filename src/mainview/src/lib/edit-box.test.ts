import { describe, expect, test } from "bun:test";

// A message's edit box while its save waits for the engine's word (#578): since #577 a save answers once the engine
// took or refused the change, and until then the box takes nothing more. The module's runes: here $state is the value
// itself, as the stores' tests have it.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const { EditBox, editBoxOf, keptIn } = await import("./edit-box.svelte");

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
		const box = new EditBox("chat", "first", "before");
		box.type("after");
		const first = box.save(save);
		void box.save(save);
		expect(asked).toEqual(["after"]);
		expect(box.saving).toBe(true);
		answer("refused");
		await first;
		expect(box.saving).toBe(false);
		// Its answer came: the next Save is the next edit.
		void box.save(save);
		expect(asked).toEqual(["after", "after"]);
	});

	test("a Discard while a save waits closes nothing until the engine's word", async () => {
		let closed = 0;
		const close = () => void closed++;
		const { save, answer } = answered();
		const box = new EditBox("chat", "second", "before");
		const saving = box.save(save);
		box.discard(close);
		expect(closed).toBe(0);
		answer("couldn't be saved");
		await saving;
		// Refused, the box is still there to say why, and to discard.
		expect(box.refused).toBe("couldn't be saved");
		box.discard(close);
		expect(closed).toBe(1);
	});

	test("what's typed after Save leaves the text as it was saved, which a refusal finds in the box", async () => {
		const { save, answer } = answered();
		const box = new EditBox("chat", "third", "before");
		box.type("saved");
		const saving = box.save(save);
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
		const box = new EditBox("chat", "fourth", "before");
		const taken = box.save(save);
		answer();
		await taken;
		expect([box.saving, box.refused]).toEqual([false, null]);
		const failing = new EditBox("chat", "fifth", "before");
		expect(
			await failing
				.save(() => Promise.reject(new Error("no turn")))
				.then(
					() => null,
					(error: unknown) => error,
				),
		).toBeInstanceOf(Error);
		expect([failing.saving, failing.text]).toEqual([false, "before"]);
	});
});

// #584 (FG-M8): the chat keeps the edit it has open while its box saves. Whatever unmounts the box (another chat, a
// READY's remount of the app, its message's row leaving the list) finds it again by its message, and nothing the chat
// does closes it but its save's answer; one that leaves the edit open (a refusal, the person's no) keeps it the chat's,
// with what was typed, until the person closes it.
describe("an edit the chat keeps while its save waits", () => {
	test("a new editor of its message finds the box as it was, and so does the chat, wherever it's shown again", async () => {
		const { save, answer } = answered();
		const box = editBoxOf("ana's chat", "kept", "before");
		box.type("after");
		const saving = box.save(save);
		expect(editBoxOf("ana's chat", "kept", "before")).toBe(box);
		expect([keptIn("ana's chat"), keptIn("another chat")]).toEqual([box, undefined]);
		expect([box.text, box.saving]).toEqual(["after", true]);
		answer("couldn't be saved");
		await saving;
		// Refused: still the chat's, with what was typed and why, until the person closes it.
		expect([editBoxOf("ana's chat", "kept", "before"), box.text, box.refused]).toEqual([
			box,
			"after",
			"couldn't be saved",
		]);
		box.discard(() => {});
		expect(keptIn("ana's chat")).toBeUndefined();
		expect(editBoxOf("ana's chat", "kept", "before").text).toBe("before");
	});

	test("nothing the chat does closes it while it saves, and a save taken lets it go", async () => {
		const { save, answer } = answered();
		const box = editBoxOf("ana's chat", "taken", "before");
		expect(keptIn("ana's chat")).toBeUndefined();
		const saving = box.save(save);
		expect(box.close()).toBe(false);
		expect(keptIn("ana's chat")).toBe(box);
		answer();
		await saving;
		expect(keptIn("ana's chat")).toBeUndefined();
	});

	test("the person's no keeps it as a refusal does, and the chat closes it once it's answered", async () => {
		const box = editBoxOf("ana's chat", "asked", "before");
		await box.save(() => false);
		expect([keptIn("ana's chat"), box.refused, box.saving]).toEqual([box, null, false]);
		expect(box.close()).toBe(true);
		expect(keptIn("ana's chat")).toBeUndefined();
	});
});
