import { createHash } from "node:crypto";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { within } from "./activity-images";

const KEPT = 200;
/** How long a toast waits for its author's photo: one not made by then shows without it, and the next toast has it. */
export const AVATAR_WAIT_MS = 2_000;

export interface AvatarSources {
	/**
	 * The photo made a small PNG or JPEG data URI as an IPC app's image is (ActivityImages.inline, activity-images.ts):
	 * fetched within its limits, refused when its header says it's too big to decode, two at a time, and one that
	 * couldn't be made tried again only a while later; undefined when it can't be.
	 */
	inline: (url: string) => Promise<string | undefined>;
	/** Where the files are kept: the app's cache. */
	dir: string;
}

/**
 * An author's photo as the file a toast shows (toasts.ts), which Windows reads from disk: made once per URL, a small
 * PNG or JPEG whatever the photo's type (WebP included, which a toast can't show), and kept in dir, the newest 200.
 * null when it can't be had: the toast shows without it.
 */
export async function avatarFile(url: string, sources: AvatarSources): Promise<string | null> {
	const name = createHash("sha256").update(url).digest("hex");
	for (const ext of ["jpg", "png"]) {
		const kept = join(sources.dir, `${name}.${ext}`);
		if (await Bun.file(kept).exists()) return kept;
	}
	const small = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec((await sources.inline(url)) ?? "");
	if (!small) return null;
	await mkdir(sources.dir, { recursive: true });
	const path = join(sources.dir, `${name}.${small[1] === "jpeg" ? "jpg" : "png"}`);
	await Bun.write(path, Buffer.from(small[2], "base64"));
	await keepNewest(sources.dir);
	return path;
}

/** avatarFile for a toast that shows now: a photo not made within waitMs leaves it without one, and is kept for the
 * next toast. */
export function avatarForToast(url: string, sources: AvatarSources, waitMs = AVATAR_WAIT_MS): Promise<string | null> {
	return within(avatarFile(url, sources), waitMs).catch(() => null);
}

// The newest KEPT files stay, and the oldest go.
async function keepNewest(dir: string) {
	const names = await readdir(dir);
	if (names.length <= KEPT) return;
	const files = await Promise.all(
		names.map(async (name) => ({ path: join(dir, name), at: (await stat(join(dir, name))).mtimeMs })),
	);
	files.sort((a, b) => a.at - b.at);
	await Promise.all(files.slice(0, files.length - KEPT).map((f) => unlink(f.path)));
}
