import { expect, test } from "bun:test";

// The store's .svelte.ts module uses $state, which only Svelte's compiler knows: here it's the value itself.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const { promptDialog, promptStore } = await import("$lib/stores/prompt.svelte");

test("a prompt starts from what there is to change", async () => {
	const answer = promptDialog("Rename group", "Group name", "Weekend plans");
	expect(promptStore.value).toBe("Weekend plans");
	expect(promptStore.pending?.message).toBe("Rename group");
	promptStore.resolve("Road trip");
	expect(await answer).toBe("Road trip");
});

test("and from nothing when there's nothing to change, whatever the last one held", async () => {
	const first = promptDialog("Rename group", "", "Weekend plans");
	promptStore.resolve(null);
	await first;
	const answer = promptDialog("Folder name", "My folder");
	expect(promptStore.value).toBe("");
	promptStore.resolve(null);
	expect(await answer).toBeNull();
});
