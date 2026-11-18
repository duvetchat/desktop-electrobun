// An image picked in a settings screen and not saved yet (#357): a new avatar or banner, a Space's icon or banner, or
// the choice to remove one. On the web the screens are sheets of the app's page, which stay mounted while closed, so
// what is picked waits for the sheet to open again. In the desktop app each screen is a window of its own, and closing
// the window ends its page: what was picked went with it. So a window's page hands each pick to the main window's
// page, which keeps it for as long as the sheet would have, its own life, and hands it back to the window opened next.
// Nothing here is saved anywhere: a pick lives in the main page's memory, and goes with a reload or a sign-out.
import { base64Bytes } from "$lib/activity-thumbnail";

/** What is picked for an image: a new one, or its removal. */
export type StagedImage = File | "remove";
export type StagedSlot = "avatar" | "banner" | "icon";
const SLOTS: readonly string[] = ["avatar", "banner", "icon"] satisfies StagedSlot[];
const isSlot = (value: unknown): value is StagedSlot => typeof value === "string" && SLOTS.includes(value);

/** Whose images: the user's own, or a Space's. */
export const USER_SCOPE = "user";
export const spaceScope = (spaceId: string) => `space:${spaceId}`;
const isScope = (value: unknown): value is string =>
	typeof value === "string" && (value === USER_SCOPE || /^space:.{1,64}$/.test(value));

/** The largest image kept across a window's close. A larger one is only lost with its window, as any was. */
export const MAX_STAGED_BYTES = 8 * 1024 * 1024;
/** How many scopes are kept: Settings', and the Spaces whose settings were open with something picked. */
export const MAX_SCOPES = 16;

/** A pick as it crosses the windows, which carry JSON: the file in base64. */
export type StagedWire = "remove" | { name: string; type: string; data: string };

export function bytesBase64(bytes: Uint8Array): string {
	let text = "";
	// In pieces: a call takes only so many arguments.
	for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
	return btoa(text);
}

/** A pick, to cross the windows; null for a file too large to keep. */
export async function stagedToWire(staged: StagedImage): Promise<StagedWire | null> {
	if (staged === "remove") return "remove";
	if (staged.size > MAX_STAGED_BYTES) return null;
	return { name: staged.name, type: staged.type, data: bytesBase64(new Uint8Array(await staged.arrayBuffer())) };
}

/** What crossed the windows as a pick, or null for anything else. */
export function parseWire(value: unknown): StagedWire | null {
	if (value === "remove") return "remove";
	if (typeof value !== "object" || value === null) return null;
	if (!("name" in value) || !("type" in value) || !("data" in value)) return null;
	const { name, type, data } = value;
	if (typeof name !== "string" || typeof type !== "string" || typeof data !== "string") return null;
	// Base64 is four characters for three bytes.
	if (data.length > Math.ceil(MAX_STAGED_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return null;
	return { name: name.slice(0, 255), type: type.slice(0, 100), data };
}

/** A pick that crossed the windows, as the screen holds it; null for anything else. */
export function wireToStaged(value: unknown): StagedImage | null {
	const wire = parseWire(value);
	if (wire === null || wire === "remove") return wire;
	try {
		return new File([base64Bytes(wire.data)], wire.name, { type: wire.type });
	} catch {
		return null;
	}
}

/** A window's "stage" command: whose image, which, and the pick (null: nothing is picked any more). */
export function parseStage(args: unknown): { scope: string; slot: StagedSlot; staged: StagedWire | null } | null {
	if (typeof args !== "object" || args === null || !("scope" in args) || !("slot" in args)) return null;
	const { scope, slot } = args;
	if (!isScope(scope) || !isSlot(slot)) return null;
	const sent = "staged" in args ? args.staged : null;
	const staged = sent === null ? null : parseWire(sent);
	// A pick that can't be read is no pick: what was kept before it must not come back in its place.
	return { scope, slot, staged };
}

/** The main window's page: the picks its settings windows handed it. */
export class StagedImages {
	readonly #kept = new Map<string, Partial<Record<StagedSlot, StagedWire>>>();

	take(scope: string, slot: StagedSlot, staged: StagedWire | null): void {
		const { [slot]: _before, ...others } = this.#kept.get(scope) ?? {};
		const next = staged === null ? others : { ...others, [slot]: staged };
		// Told again, a scope is the newest; one with nothing picked is not kept.
		this.#kept.delete(scope);
		if (Object.keys(next).length > 0) this.#kept.set(scope, next);
		for (const oldest of this.#kept.keys()) {
			if (this.#kept.size <= MAX_SCOPES) break;
			this.#kept.delete(oldest);
		}
	}

	of(scope: string): Partial<Record<StagedSlot, StagedWire>> {
		return this.#kept.get(scope) ?? {};
	}
}

/** What a settings window's page asks the main window's: `staged` for a scope's picks, `stage` to keep one. */
export type AskMain = (name: "stage" | "staged", args: unknown) => Promise<unknown>;

/**
 * A settings window's end: reads what the main window keeps for a scope, and hands it each pick. Picks go one after
 * the other, in the order they were made (a file takes longer to read than a removal), and one already told isn't told
 * again. A failure is logged and changes nothing in the window: the pick is then lost with it, as before.
 */
export function stagedLink(ask: AskMain, warn: (what: string, err: unknown) => void = console.warn) {
	const told = new Map<string, StagedImage | null>();
	let last: Promise<void> = Promise.resolve();
	return {
		/** The picks kept for a scope; none when the main window can't be asked. */
		async kept(scope: string): Promise<Partial<Record<StagedSlot, StagedImage>>> {
			const found: Partial<Record<StagedSlot, StagedImage>> = {};
			try {
				const answer = await ask("staged", { scope });
				const entries = typeof answer === "object" && answer !== null ? Object.entries(answer) : [];
				for (const [slot, wire] of entries) {
					const staged = isSlot(slot) ? wireToStaged(wire) : null;
					if (!isSlot(slot) || staged === null) continue;
					found[slot] = staged;
					// The main window has it: handing it back as the screen takes it would send it for nothing.
					told.set(`${scope}/${slot}`, staged);
				}
			} catch (err) {
				warn("[settings] what was picked before couldn't be read:", err);
			}
			return found;
		},
		stage(scope: string, slot: StagedSlot, staged: StagedImage | null): void {
			const key = `${scope}/${slot}`;
			if ((told.get(key) ?? null) === staged) return;
			told.set(key, staged);
			last = last
				.then(async () => {
					const wire = staged === null ? null : await stagedToWire(staged);
					await ask("stage", { scope, slot, staged: wire });
				})
				.catch((err: unknown) => warn("[settings] a picked image couldn't be kept for later:", err));
		},
		/** Settles once every pick so far was handed over. */
		settled: () => last,
	};
}
