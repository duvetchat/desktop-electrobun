import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	bytesBase64,
	MAX_SCOPES,
	MAX_STAGED_BYTES,
	parseStage,
	parseWire,
	spaceScope,
	StagedImages,
	stagedLink,
	stagedToWire,
	USER_SCOPE,
	wireToStaged,
	type AskMain,
} from "$lib/staged-images";

// From the Windows builder's hand-back: a staged avatar or banner was lost when the Settings window closed, where the
// web's sheet keeps it until it opens again. The main window's page keeps it now, for the window opened next.

const image = (bytes: number[], name = "avatar.png", type = "image/png") =>
	new File([new Uint8Array(bytes)], name, { type });
const bytesOf = async (file: File) => [...new Uint8Array(await file.arrayBuffer())];

describe("a pick crossing the windows", () => {
	test("a file arrives whole: its bytes, its name and its type", async () => {
		const wire = await stagedToWire(image([0, 1, 2, 250, 255], "me.gif", "image/gif"));
		expect(wire).toEqual({ name: "me.gif", type: "image/gif", data: "AAEC+v8=" });
		const back = wireToStaged(JSON.parse(JSON.stringify(wire)));
		expect(back).toBeInstanceOf(File);
		if (!(back instanceof File)) return;
		expect([back.name, back.type]).toEqual(["me.gif", "image/gif"]);
		expect(await bytesOf(back)).toEqual([0, 1, 2, 250, 255]);
	});

	test("a large file crosses in pieces and arrives the same", async () => {
		const bytes = Array.from({ length: 100_000 }, (_, at) => (at * 7) % 256);
		const back = wireToStaged(await stagedToWire(image(bytes)));
		expect(back instanceof File && (await bytesOf(back)).every((byte, at) => byte === bytes[at])).toBe(true);
		expect(bytesBase64(new Uint8Array(bytes))).toBe(Buffer.from(bytes).toString("base64"));
	});

	test("a removal crosses as one", async () => {
		expect(await stagedToWire("remove")).toBe("remove");
		expect(wireToStaged("remove")).toBe("remove");
	});

	test("a file past the limit isn't sent", async () => {
		const large = image([1]);
		Object.defineProperty(large, "size", { value: MAX_STAGED_BYTES + 1 });
		// Only its size is read: nothing of it is.
		large.arrayBuffer = () => {
			throw new Error("read");
		};
		expect(await stagedToWire(large)).toBeNull();
	});

	test("anything that isn't a pick is none", () => {
		for (const value of [null, undefined, 7, "keep", {}, { name: "a", type: "b" }, { name: 1, type: "b", data: "" }]) {
			expect(parseWire(value)).toBeNull();
			expect(wireToStaged(value)).toBeNull();
		}
		expect(parseWire({ name: "a.png", type: "image/png", data: "not base64!" })).toBeNull();
		expect(parseWire({ name: "a.png", type: "image/png", data: "A".repeat(MAX_STAGED_BYTES * 2) })).toBeNull();
	});
});

describe("a window's stage command", () => {
	test("names whose image, which one, and the pick", () => {
		expect(parseStage({ scope: "user", slot: "avatar", staged: "remove" })).toEqual({
			scope: "user",
			slot: "avatar",
			staged: "remove",
		});
		expect(parseStage({ scope: spaceScope("s1"), slot: "icon", staged: null })).toEqual({
			scope: "space:s1",
			slot: "icon",
			staged: null,
		});
	});

	test("with a pick that can't be read clears the slot, so an older pick never comes back in its place", () => {
		expect(parseStage({ scope: "user", slot: "banner", staged: { name: 1 } })).toEqual({
			scope: "user",
			slot: "banner",
			staged: null,
		});
	});

	test("is refused for a scope or a slot that isn't one", () => {
		for (const args of [
			null,
			{},
			{ scope: "user" },
			{ scope: "user", slot: "favicon" },
			{ scope: "everyone", slot: "avatar" },
			{ scope: "space:", slot: "icon" },
			{ scope: `space:${"x".repeat(65)}`, slot: "icon" },
			{ scope: 1, slot: "avatar" },
		]) {
			expect(parseStage(args)).toBeNull();
		}
	});
});

describe("what the main window keeps", () => {
	const wire = { name: "a.png", type: "image/png", data: "AAEC" };

	test("each scope's picks, by slot, until they are saved or dropped", () => {
		const kept = new StagedImages();
		kept.take(USER_SCOPE, "avatar", wire);
		kept.take(USER_SCOPE, "banner", "remove");
		kept.take(spaceScope("s1"), "icon", wire);
		expect(kept.of(USER_SCOPE)).toEqual({ avatar: wire, banner: "remove" });
		expect(kept.of(spaceScope("s1"))).toEqual({ icon: wire });
		expect(kept.of(spaceScope("s2"))).toEqual({});
		// Saved, or dropped: the screen has nothing picked any more.
		kept.take(USER_SCOPE, "avatar", null);
		kept.take(USER_SCOPE, "banner", null);
		expect(kept.of(USER_SCOPE)).toEqual({});
	});

	test("a later pick replaces the earlier one of its slot", () => {
		const kept = new StagedImages();
		kept.take(USER_SCOPE, "avatar", wire);
		kept.take(USER_SCOPE, "avatar", "remove");
		expect(kept.of(USER_SCOPE)).toEqual({ avatar: "remove" });
	});

	test("only so many scopes: the one told longest ago goes first", () => {
		const kept = new StagedImages();
		for (let space = 0; space <= MAX_SCOPES; space++) kept.take(spaceScope(`s${space}`), "icon", wire);
		expect(kept.of(spaceScope("s0"))).toEqual({});
		expect(kept.of(spaceScope("s1"))).toEqual({ icon: wire });
		expect(kept.of(spaceScope(`s${MAX_SCOPES}`))).toEqual({ icon: wire });
	});
});

describe("a settings window's end", () => {
	/** The main window's page, answering as lib/stores/settings-host-link.svelte.ts does. */
	function mainWindow() {
		const kept = new StagedImages();
		const asked: string[] = [];
		const ask: AskMain = async (name, args) => {
			asked.push(name);
			// As the windows carry it: JSON.
			const sent: unknown = JSON.parse(JSON.stringify(args));
			if (name === "stage") {
				const stage = parseStage(sent);
				if (stage) kept.take(stage.scope, stage.slot, stage.staged);
				return stage !== null;
			}
			const scope = typeof sent === "object" && sent !== null && "scope" in sent ? String(sent.scope) : "";
			return JSON.parse(JSON.stringify(kept.of(scope)));
		};
		return { kept, asked, ask };
	}

	test("a pick made in one window is there for the window opened next", async () => {
		const main = mainWindow();
		const first = stagedLink(main.ask);
		expect(await first.kept(USER_SCOPE)).toEqual({});
		first.stage(USER_SCOPE, "avatar", image([1, 2, 3]));
		first.stage(USER_SCOPE, "banner", "remove");
		await first.settled();
		// The window closes: its page, and `first`, are gone. Settings opens again.
		const second = stagedLink(main.ask);
		const kept = await second.kept(USER_SCOPE);
		expect(kept.banner).toBe("remove");
		expect(kept.avatar instanceof File && (await bytesOf(kept.avatar))).toEqual([1, 2, 3]);
	});

	test("picks are handed over in the order they were made, however long a file takes to read", async () => {
		const main = mainWindow();
		const link = stagedLink(main.ask);
		const slow = image([9, 9, 9]);
		slow.arrayBuffer = async () => {
			await Bun.sleep(20);
			return new Uint8Array([9, 9, 9]).buffer;
		};
		link.stage(USER_SCOPE, "avatar", slow);
		link.stage(USER_SCOPE, "avatar", "remove");
		await link.settled();
		expect(main.kept.of(USER_SCOPE)).toEqual({ avatar: "remove" });
	});

	test("what was saved or dropped isn't there next time", async () => {
		const main = mainWindow();
		const link = stagedLink(main.ask);
		link.stage(USER_SCOPE, "avatar", image([1]));
		link.stage(USER_SCOPE, "avatar", null);
		await link.settled();
		expect(await stagedLink(main.ask).kept(USER_SCOPE)).toEqual({});
	});

	test("a pick the main window already has isn't sent again: not the one just read back, nor the same twice", async () => {
		const main = mainWindow();
		const first = stagedLink(main.ask);
		const picked = image([4, 5]);
		first.stage(USER_SCOPE, "avatar", picked);
		first.stage(USER_SCOPE, "avatar", picked);
		await first.settled();
		expect(main.asked).toEqual(["stage"]);
		const second = stagedLink(main.ask);
		const kept = await second.kept(USER_SCOPE);
		// The screen takes what was kept, and tells its host what it holds: nothing crosses for it.
		second.stage(USER_SCOPE, "avatar", kept.avatar ?? null);
		second.stage(USER_SCOPE, "banner", null);
		await second.settled();
		expect(main.asked).toEqual(["stage", "staged"]);
	});

	test("each scope has its own: a Space's picks aren't the user's, nor another Space's", async () => {
		const main = mainWindow();
		const link = stagedLink(main.ask);
		link.stage(spaceScope("s1"), "icon", image([7]));
		await link.settled();
		expect(Object.keys(await stagedLink(main.ask).kept(spaceScope("s1")))).toEqual(["icon"]);
		expect(await stagedLink(main.ask).kept(spaceScope("s2"))).toEqual({});
		expect(await stagedLink(main.ask).kept(USER_SCOPE)).toEqual({});
	});

	test("a file too large to keep clears its slot rather than leave an older pick to come back", async () => {
		const main = mainWindow();
		const link = stagedLink(main.ask);
		link.stage(USER_SCOPE, "avatar", image([1]));
		const large = image([2]);
		Object.defineProperty(large, "size", { value: MAX_STAGED_BYTES + 1 });
		link.stage(USER_SCOPE, "avatar", large);
		await link.settled();
		expect(main.kept.of(USER_SCOPE)).toEqual({});
	});

	test("a main window that can't be asked changes nothing in the window, and is only logged", async () => {
		const warned: string[] = [];
		const link = stagedLink(
			async () => {
				throw new Error("The main window is closed");
			},
			(what) => void warned.push(what),
		);
		expect(await link.kept(USER_SCOPE)).toEqual({});
		link.stage(USER_SCOPE, "avatar", "remove");
		await link.settled();
		expect(warned).toHaveLength(2);
	});
});

// The web's sheets keep their own picks, mounted while closed: their host keeps nothing and answers with nothing.
describe("the wiring", () => {
	const read = (path: string) => readFileSync(join(import.meta.dir, path), "utf8").replace(/\s+/g, " ");

	test("the page's own host keeps nothing; a window's hands its picks to the main window", () => {
		const host = read("settings-host.ts");
		expect(host).toContain("stagedImages: () => Promise.resolve({}),");
		expect(host).toContain("stageImage: () => {},");
		const guest = read("stores/settings-guest-link.svelte.ts");
		expect(guest).toContain("stagedImages: (scope) => staged.kept(scope),");
		expect(guest).toContain("stageImage: (scope, slot, picked) => staged.stage(scope, slot, picked),");
		const main = read("stores/settings-host-link.svelte.ts");
		expect(main).toContain("stage: (args) => {");
		expect(main).toContain('staged: (args) => stagedImages.of(textOf(args, "scope") ?? ""),');
	});

	test("both screens read what was kept as they open, and tell each pick after that", () => {
		const settings = read("components/settings/SettingsScreen.svelte");
		expect(settings).toContain("host.stagedImages(USER_SCOPE)");
		expect(settings).toContain('if (stagesKnown) host.stageImage(USER_SCOPE, "avatar", picked);');
		expect(settings).toContain('if (stagesKnown) host.stageImage(USER_SCOPE, "banner", picked);');
		const space = read("components/settings/SpaceSettingsScreen.svelte");
		expect(space).toContain("host.stagedImages(spaceScope(of))");
		expect(space).toContain('host.stageImage(spaceScope(stagesOf), "icon", picked);');
		expect(space).toContain('host.stageImage(spaceScope(stagesOf), "banner", picked);');
	});
});
