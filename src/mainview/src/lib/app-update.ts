import { writable } from "svelte/store";
import { getElectrobunRpc } from "$lib/electrobun-rpc";

// The app's own updates (#456, src/bun/updates.ts): Bun downloads and verifies a newer version on the stable channel
// and says so; the title bar then offers "Restart to update" (TitleStrip.svelte), which asks Bun to apply it. Nothing
// restarts by itself. The web has no Bun, and never shows it.

/** What this needs of the RPC client (AppRPCClient has it). */
export interface UpdateLink {
	on: { updateReady: (handler: (message: { version: string }) => void) => void };
	request: { pendingUpdate: () => Promise<string | null> };
	send: { applyUpdate: () => void };
}

/** The version ready to install, or null. */
export const updateReady = writable<string | null>(null);

const watched = new WeakSet<UpdateLink>();

/** Follows Bun's word on a ready update, once per client: what it says from now on, and what it said before. */
export async function watchUpdates(link?: UpdateLink | null): Promise<void> {
	const client = link === undefined ? await getElectrobunRpc() : link;
	if (!client || watched.has(client)) return;
	watched.add(client);
	client.on.updateReady(({ version }) => updateReady.set(version));
	const pending = await client.request.pendingUpdate().catch(() => null);
	if (pending) updateReady.set(pending);
}

/** "Restart to update": Bun applies the verified version, and the app opens again on it. */
export async function restartToUpdate(link?: UpdateLink | null): Promise<void> {
	const client = link === undefined ? await getElectrobunRpc() : link;
	client?.send.applyUpdate();
}
