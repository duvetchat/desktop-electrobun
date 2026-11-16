import { expect, test } from "bun:test";
import { tags } from "./server-render";

// The toast store's .svelte.ts module uses $state, which only Svelte's compiler knows: here it's the value itself.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const { toastStore } = await import("$lib/stores/toast.svelte");
const { callCardBox } = await import("$lib/corner");
const { default: Toast } = await import("./Toast.svelte");

toastStore.items = [{ id: 1, message: "Missed a call from Leo", type: "info" }];
const list = async () => (await tags(Toast, {})).find((t) => t.attributes.class?.includes("z-9999"));

test("toasts sit in the corner while no call card shows", async () => {
	callCardBox.set(null);
	expect((await list())?.attributes.style).toContain("bottom: 16px");
});

test("toasts sit right above the call card, never over its buttons", async () => {
	callCardBox.set({ right: 16, bottom: 204, width: 320, height: 72 });
	expect((await list())?.attributes.style).toContain("bottom: 284px");
});
