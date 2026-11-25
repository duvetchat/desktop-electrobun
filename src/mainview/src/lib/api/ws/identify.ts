import { isElectrobunWindow } from "$lib/electrobun-rpc";
import { duvetClient, identifyDevice } from "$lib/e2e/client";
import type { ClientPlatform } from "$lib/types";

/** An identify's data, as the gateway reads it: the session's access token and what this client runs on, and, to
 * resume a gateway session, the last event this client got and that session's token. */
export interface IdentifyData {
	token: string | null;
	platform: ClientPlatform;
	/** This app, <platform>/<version> as X-Duvet-Client names it: the gateway hands end-to-end encryption's events only
	 * to a client that has it (lib/e2e/client.ts). */
	client: string;
	/** This installation's device of the user, once it's registered: the gateway hands a device's events only to the
	 * connections that identified with it. A resumed session keeps the one its first identify gave. */
	device_id?: string;
	last_seq?: number;
	session_token?: string;
}

/** What this client runs on, which the user's client status shows others: the packaged desktop app, or else a browser
 * (the web build at duvet.chat, or the dev server opened in one). */
export function clientPlatform(): ClientPlatform {
	return isElectrobunWindow() ? "desktop" : "web";
}

/** What a connection's identify sends: the token, this client's platform, what it is and its device, and, to resume
 * the gateway session this client had, the last event it got and the session's token, when it has one. */
export function identifyData(
	token: string | null,
	resume: { lastSeq: number; sessionToken: string | null } | null,
): IdentifyData {
	const data: IdentifyData = { token, platform: clientPlatform(), client: duvetClient() };
	const device = identifyDevice();
	if (device) data.device_id = device;
	if (resume) {
		data.last_seq = resume.lastSeq;
		if (resume.sessionToken) data.session_token = resume.sessionToken;
	}
	return data;
}
