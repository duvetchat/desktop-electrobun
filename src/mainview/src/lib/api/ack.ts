// Read acks go out at most once per room or conversation every ACK_INTERVAL_MS: reading a busy room
// would otherwise send one per message. The first goes out at once; later ones within the interval
// merge into one trailing ack with the newest message ID. IDs are UUIDv7, so they compare by time
// as strings.
const ACK_INTERVAL_MS = 3000;

interface AckState {
	sentId: string | null;
	sentAt: number;
	pendingId: string | null;
	timer: ReturnType<typeof setTimeout> | null;
}

/** Wraps `send` so each key gets at most one ack per interval, never one older than what was sent. */
export function createAckThrottle(send: (key: string, messageId: string) => Promise<void>) {
	const states = new Map<string, AckState>();

	function flush(key: string, state: AckState): Promise<void> {
		state.timer = null;
		const id = state.pendingId;
		state.pendingId = null;
		if (id === null || (state.sentId !== null && id <= state.sentId)) return Promise.resolve();
		state.sentId = id;
		state.sentAt = Date.now();
		return send(key, id);
	}

	return (key: string, messageId: string): Promise<void> => {
		let state = states.get(key);
		if (!state) {
			state = { sentId: null, sentAt: 0, pendingId: null, timer: null };
			states.set(key, state);
		}
		if (state.pendingId === null || messageId > state.pendingId) state.pendingId = messageId;
		if (state.timer !== null) return Promise.resolve();
		const wait = state.sentAt + ACK_INTERVAL_MS - Date.now();
		if (wait <= 0) return flush(key, state);
		const pending = state;
		state.timer = setTimeout(() => void flush(key, pending), wait);
		return Promise.resolve();
	};
}
