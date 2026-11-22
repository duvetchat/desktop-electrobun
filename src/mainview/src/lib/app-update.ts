import { get, writable } from "svelte/store";
import { getElectrobunRpc, type UpdateOffer } from "$lib/electrobun-rpc";

// The app's own updates (#456, src/bun/updates.ts): Bun downloads and verifies a newer version on the stable channel and
// says so; the title bar then offers "Restart to update" (TitleStrip.svelte), which asks Bun to apply it. Nothing restarts
// by itself. Where Bun can't apply it (a Windows app folder Electrobun's update.bat can't name), it offers "Download
// update", which opens duvet.chat/download. The web has no Bun, and never shows either.

/** What this needs of the RPC client (AppRPCClient has it). */
export interface UpdateLink {
	on: { updateReady: (handler: (offer: UpdateOffer | null) => void) => void };
	request: { pendingUpdate: () => Promise<UpdateOffer | null> };
	send: { applyUpdate: () => void; openExternal: (params: { url: string }) => void };
}

/** The installer's page (routes/download), for a version Bun can't apply. */
export const DOWNLOAD_PAGE = "https://duvet.chat/download";

/** What the title bar offers, or null. */
export const updateOffer = writable<UpdateOffer | null>(null);

/** Restart to update was pressed, and Bun hasn't offered it again: the app is about to close. */
export const restarting = writable(false);

const watched = new WeakSet<UpdateLink>();

/** Follows Bun's offers, once per client: what it offers from now on, and what it offered before. */
export async function watchUpdates(link?: UpdateLink | null): Promise<void> {
	const client = link === undefined ? await getElectrobunRpc() : link;
	if (!client || watched.has(client)) return;
	watched.add(client);
	client.on.updateReady((offer) => {
		updateOffer.set(offer);
		restarting.set(false);
	});
	const pending = await client.request.pendingUpdate().catch(() => null);
	if (pending) updateOffer.set(pending);
}

/** The title bar's button: Bun applies the verified version and the app opens again on it, or the browser opens the
 * download page. */
export async function takeUpdate(link?: UpdateLink | null): Promise<void> {
	const client = link === undefined ? await getElectrobunRpc() : link;
	const offer = get(updateOffer);
	if (!client || !offer || get(restarting)) return;
	if (offer.how === "download") {
		client.send.openExternal({ url: DOWNLOAD_PAGE });
		return;
	}
	restarting.set(true);
	client.send.applyUpdate();
}
