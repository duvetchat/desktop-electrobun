import { isElectrobunWindow } from "$lib/electrobun-rpc";
import type { ClientPlatform } from "$lib/types";

/** An identify's data, as the gateway reads it: the session's access token and what this client runs on, and, to
 * resume a gateway session, the last event this client got and that session's token. */
export interface IdentifyData {
	token: string | null;
	platform: ClientPlatform;
	last_seq?: number;
	session_token?: string;
}

/** What this client runs on, which the user's client status shows others: the packaged desktop app, or else a browser
 * (the web build at duvet.chat, or the dev server opened in one). */
export function clientPlatform(): ClientPlatform {
	return isElectrobunWindow() ? "desktop" : "web";
}

/** What a connection's identify sends: the token and this client's platform, and, to resume the gateway session this
 * client had, the last event it got and the session's token, when it has one. */
export function identifyData(
	token: string | null,
	resume: { lastSeq: number; sessionToken: string | null } | null,
): IdentifyData {
	const data: IdentifyData = { token, platform: clientPlatform() };
	if (resume) {
		data.last_seq = resume.lastSeq;
		if (resume.sessionToken) data.session_token = resume.sessionToken;
	}
	return data;
}
