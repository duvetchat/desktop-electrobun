import { answerCommand, type CommandHandlers, type WindowAnswer, type WindowCommand } from "$lib/window-link";

// What the main window answers to its other windows (#357, lib/window-link.ts). The app's RPC has one answerer for
// their commands (lib/electrobun-rpc.ts: on.windowCommand), and more than one part of the app has commands to answer:
// the media controls' pop-out, the Settings windows. Each adds its channel here, and the main window's page gives the
// RPC `answerWindowCommand` once, whoever does it first.

const handlers: CommandHandlers = {};

/** Adds a channel's commands; returns what takes them away. A channel added twice keeps the later handlers. */
export function addWindowCommands(channel: string, commands: Record<string, (args: unknown) => unknown>): () => void {
	handlers[channel] = commands;
	return () => {
		if (handlers[channel] === commands) delete handlers[channel];
	};
}

/** Adds commands to a channel, beside the ones it has: for a part of the app whose pieces each add their own
 * (lib/window-hub.ts: the Settings windows). */
export function joinWindowCommands(channel: string, commands: Record<string, (args: unknown) => unknown>): void {
	handlers[channel] = { ...handlers[channel], ...commands };
}

/** The main window's answer to any channel's command. */
export function answerWindowCommand(command: WindowCommand): Promise<WindowAnswer> {
	return answerCommand(handlers, command);
}
