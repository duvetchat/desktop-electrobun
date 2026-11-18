// The page's end of what crosses between the app's windows (#357): lib/window-link.ts's states and commands, over the
// app's RPC (lib/electrobun-rpc.ts), which the Bun process relays (src/bun/window-relay.ts). The RPC takes one answerer
// of commands and one stream of states, and more than one part of the app has windows (Settings, the media controls).
// The commands of every part are kept in one place, lib/window-commands.ts, and whichever part starts first hands the
// RPC that one answerer: two answerers would leave the earlier part's windows unanswered.
import { getElectrobunRpc } from "$lib/electrobun-rpc";
import { answerWindowCommand, joinWindowCommands } from "$lib/window-commands";
import { isNewer, StatePublisher, type WindowAnswer, type WindowStateMessage } from "$lib/window-link";

// ── the main window's side ───────────────────────────────────────────────────

let answering = false;

/** In the main window: answers the other windows' commands of a channel, by name. A channel's later commands join
 * its earlier ones. */
export function answerWindows(channel: string, commands: Record<string, (args: unknown) => unknown>): void {
	joinWindowCommands(channel, commands);
	if (answering) return;
	answering = true;
	void getElectrobunRpc().then((rpc) => rpc?.on.windowCommand(answerWindowCommand));
}

// The page's one publisher: every state this page publishes carries its epoch, which is how Bun's relay tells this
// page's states from those of the page before it, and lets go of that one's (src/bun/window-relay.ts). A second
// publisher would have an epoch of its own, and each would wipe what the other published.
let publisher: StatePublisher | null = null;
let send: ((message: WindowStateMessage) => void) | null = null;
// States published before the RPC is there: each channel's last one goes out once it is.
const waiting = new Map<string, WindowStateMessage>();

/** In the main window: publishes a state of a channel to every other window, and to those that open later. */
export function publishToWindows(channel: string, value: unknown): void {
	if (!publisher) {
		publisher = new StatePublisher((message) => {
			if (send) send(message);
			else waiting.set(message.channel, message);
		});
		void getElectrobunRpc().then((rpc) => {
			if (!rpc) return;
			send = (message) => rpc.send.windowState(message);
			for (const message of waiting.values()) send(message);
			waiting.clear();
		});
	}
	publisher.publish(channel, value);
}

// ── another window's side ────────────────────────────────────────────────────

/** In a window that isn't the main one: calls back with each state the main window publishes, of any channel, never
 * with one older than its channel's last. Returns once it listens. */
export async function onWindowStates(listener: (channel: string, value: unknown) => void): Promise<boolean> {
	const rpc = await getElectrobunRpc();
	if (!rpc) return false;
	const last = new Map<string, WindowStateMessage>();
	rpc.on.windowState((message) => {
		if (!isNewer(message, last.get(message.channel))) return;
		last.set(message.channel, message);
		listener(message.channel, message.value);
	});
	return true;
}

/** In a window that isn't the main one: asks the main window to do something, and gives its result. Throws its
 * refusal, or that there is no main window to ask. */
export async function askMainWindow(channel: string, name: string, args?: unknown): Promise<unknown> {
	const rpc = await getElectrobunRpc();
	if (!rpc) throw new Error("Not in the desktop app");
	const answer: WindowAnswer = await rpc.request.windowCommand({ channel, name, args });
	if (!answer.ok) throw new Error(answer.error);
	return answer.result;
}
