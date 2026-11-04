import { describe, expect, test } from "bun:test";
import { afterPress } from "./press";

// A press's release as the browser dispatches it: the release, then, in the same task, the click it makes.
function release(target: EventTarget, type = "pointerup") {
	target.dispatchEvent(new Event(type));
	target.dispatchEvent(new Event("click"));
}

describe("afterPress", () => {
	// What waits for it (the search box's width, #80) changes only once the click went where the press began.
	test("is done after the click the release makes, not before", async () => {
		const target = new EventTarget();
		const order: string[] = [];
		target.addEventListener("click", () => order.push("click"));
		afterPress(target, () => order.push("done"));
		await Bun.sleep(5);
		expect(order).toEqual([]);
		release(target);
		expect(order).toEqual(["click"]);
		await Bun.sleep(5);
		expect(order).toEqual(["click", "done"]);
	});

	test("a cancelled press ends too, and a press ends once", async () => {
		const target = new EventTarget();
		let done = 0;
		afterPress(target, () => done++);
		release(target, "pointercancel");
		release(target);
		await Bun.sleep(5);
		expect(done).toBe(1);
	});

	test("stops waiting when asked, before the release or after it", async () => {
		const target = new EventTarget();
		let done = 0;
		const before = afterPress(target, () => done++);
		before();
		release(target);
		const after = afterPress(target, () => done++);
		release(target);
		after();
		await Bun.sleep(5);
		expect(done).toBe(0);
	});
});
