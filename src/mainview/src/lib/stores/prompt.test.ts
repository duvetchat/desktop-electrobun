import { expect, test } from "bun:test";

// The store's .svelte.ts module uses $state, which only Svelte's compiler knows: here it's the value itself.
Object.assign(globalThis, { $state: <T>(value: T) => value });
const { promptDialog, promptStore, say } = await import("$lib/stores/prompt.svelte");

test("a prompt starts from what there is to change", async () => {
	const answer = promptDialog("Rename group", "Group name", "Weekend plans");
	expect(promptStore.value).toBe("Weekend plans");
	expect(promptStore.pending?.message).toBe("Rename group");
	promptStore.resolve("Road trip");
	expect(await answer).toBe("Road trip");
});

test("keeps words given as what says them, asked each time they're drawn", async () => {
	let language = "en";
	const answer = promptDialog(
		() => (language === "en" ? "Rename group" : "Renombrar grupo"),
		() => (language === "en" ? "Group name" : "Nombre del grupo"),
	);
	expect(say(promptStore.pending?.message)).toBe("Rename group");
	language = "es";
	expect(say(promptStore.pending?.message)).toBe("Renombrar grupo");
	expect(say(promptStore.pending?.placeholder)).toBe("Nombre del grupo");
	// A name, as it is.
	expect(say("Weekend plans")).toBe("Weekend plans");
	promptStore.resolve(null);
	expect(await answer).toBeNull();
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
