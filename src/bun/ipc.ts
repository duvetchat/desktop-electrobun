import { posix } from "node:path";

/** Where Duvet listens: a named pipe on Windows, else a socket in the user's runtime directory (XDG_RUNTIME_DIR on
 * Linux, TMPDIR on macOS), falling back to /tmp. An empty variable counts as unset. */
export function ipcPath(platform: NodeJS.Platform, env: Record<string, string | undefined>): string {
	if (platform === "win32") return "\\\\.\\pipe\\duvet-ipc";
	const dir = env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || "/tmp";
	return posix.join(dir, "duvet-ipc.sock");
}

/** Whether something listens at path already: a connection to it goes through. Another Duvet that runs keeps its IPC
 * server: on Windows, Bun 1.3.9 panics listening on a pipe another process holds, past any try (#188), and on Unix the
 * stale-socket cleanup would take the live socket over. */
export async function ipcHeld(path: string): Promise<boolean> {
	try {
		const socket = await Bun.connect({ unix: path, socket: { data() {} } });
		socket.end();
		return true;
	} catch {
		return false;
	}
}

// A line of 64 KiB of UTF-8 has at most this many UTF-16 units, so the documented limit always fits.
export const MAX_LINE_LENGTH = 64 << 10;

/** One client's bytes as lines, however its writes were cut: a message or a character can span reads. push() gives
 * the lines it completed, or null once a line runs past MAX_LINE_LENGTH: the client gets closed then. */
export class LineReader {
	private decoder = new TextDecoder();
	private pending = "";

	push(chunk: Uint8Array): string[] | null {
		const lines = (this.pending + this.decoder.decode(chunk, { stream: true })).split("\n");
		this.pending = lines.pop() ?? "";
		if (this.pending.length > MAX_LINE_LENGTH || lines.some((line) => line.length > MAX_LINE_LENGTH)) return null;
		return lines;
	}
}
