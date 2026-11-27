// A secret the person copies (the recovery key, #569). In the desktop app Bun puts it on Windows' clipboard, out of
// its history (Win+V) and the cloud clipboard, which the page's navigator.clipboard can't do, and takes it off a minute
// later (src/bun/secret-clipboard.ts). Where Bun doesn't copy it (the web), the page does, and a minute later takes it
// off while it can tell the clipboard still holds it: only where the browser lets it read the clipboard without asking
// the person, as a question a minute after the copy would come from nowhere.
import { getElectrobunRpc, isElectrobunWindow } from "$lib/electrobun-rpc";

/** How long a copied secret stays on the clipboard (Bun's own copy waits as long). */
export const SECRET_ON_CLIPBOARD_MS = 60_000;

/** What a copy goes through: Bun's, in the desktop app (none on the web), and the page's own clipboard. */
export interface SecretCopy {
	/** True once the secret is on the clipboard, false when it took nothing, null where Bun doesn't copy it. */
	bun: ((text: string) => Promise<boolean | null>) | null;
	clipboard: { writeText(text: string): Promise<void>; readText(): Promise<string> };
	/** Whether the page may read the clipboard without asking the person. */
	readable: () => Promise<boolean>;
	later: (ms: number, run: () => void) => void;
}

/**
 * Copies the secret: through Bun where it copies it, else on the page's clipboard, from which it comes off a minute
 * later. A copy Bun's clipboard didn't take fails: the page's own would put it in the history.
 */
export async function copySecret(text: string, given: SecretCopy = pageCopy()): Promise<void> {
	// No await before the page's write on the web, which some browsers take only in the person's click.
	const copied = given.bun && (await given.bun(text));
	if (copied === false) throw new Error("the clipboard took nothing");
	if (copied) return;
	await given.clipboard.writeText(text);
	given.later(SECRET_ON_CLIPBOARD_MS, () => void takeOff(text, given));
}

/** The secret off the clipboard, while the page can tell it still holds it: what was copied since stays. */
async function takeOff(text: string, { clipboard, readable }: SecretCopy) {
	try {
		if ((await readable()) && (await clipboard.readText()) === text) await clipboard.writeText("");
	} catch (error) {
		// Without the page's focus, or the click some browsers want for a write: it stays.
		console.warn("[e2e] A copied secret stays on the clipboard:", error);
	}
}

/** Whether the browser lets the page read the clipboard without asking: Firefox and Safari don't say, which is a no. */
async function readsUnasked(): Promise<boolean> {
	// "clipboard-read" isn't among TypeScript's permission names; the method's parameter takes it, as methods' do.
	const permissions: { query(descriptor: { name: string }): Promise<PermissionStatus> } = navigator.permissions;
	try {
		return (await permissions.query({ name: "clipboard-read" })).state === "granted";
	} catch {
		return false;
	}
}

/** The page's own: Bun's copy in the desktop app's window, navigator.clipboard and a timer. */
function pageCopy(): SecretCopy {
	return {
		bun: isElectrobunWindow() ? async (text) => (await getElectrobunRpc())?.request.copySecret({ text }) ?? null : null,
		clipboard: navigator.clipboard,
		readable: readsUnasked,
		later: (ms, run) => void setTimeout(run, ms),
	};
}
