// The routes of end-to-end encryption (PLAN-E2E-API.md, «Rutas», A to K), typed for the encryption engine. Where the
// API's e2e branch has a route, its code decided its shapes over the plan's table; the shared history's and the backup's
// (step 3's tasks 14 and 15, not built yet) follow the plan. Binary fields go as the core makes and takes them, in
// standard base64; a part's and a day's bytes go up as bytes, and come down from the signed URL their route answers.
// Refusals are api.ts's: a FetchError with the API's body (a 409's
// current state, a 422's code, a 410's floor), an UpdateRequiredError (426) or a PausedError (503).
//
// e2eApi(client) gives them for a session: the app's own (api.ts's) by default, or a test's for another one.
import api, {
	FetchError,
	fetchWithin,
	requestLimits,
	type ApiClient,
	type FetchResponse,
	type UploadOptions,
} from "$lib/api/api";
import type { ConversationMember, DirectMessage } from "$lib/api/conversations";
import type { AllowedMentions, HistoryShare, MessageReference, MlsEntry, UserDevice } from "$lib/types";

/** GET /api/e2e: the API's external sender (its key, base64), the cutover's instant, whether conversations' writes are
 * paused, the lowest version of each platform with encryption, and the limits a client builds what it sends to. */
export interface E2eConfig {
	external_sender: string;
	cutover_at: string | null;
	paused: boolean;
	min_clients: Record<string, string>;
	limits: E2eLimits;
}

/** Sizes in bytes, and counts. */
export interface E2eLimits {
	ciphertext_bytes: number;
	key_packages: number;
	last_resort_key_packages: number;
	key_package_bytes: number;
	inbox_message_bytes: number;
	history_share_parts: number;
	history_share_part_bytes: number;
	group_members: number;
	listed_devices: number;
	commit_bytes: number;
	welcome_bytes: number;
	group_info_bytes: number;
	encrypted_identity_bytes: number;
	wrapped_backup_key_bytes: number;
	wrapped_previous_backup_keys_bytes: number;
	certificate_bytes: number;
	device_list_bytes: number;
	epochs_behind: number;
}

/** A device of the user's, `current` when it's this session's. */
export interface Device extends UserDevice {
	current: boolean;
}

/** A device's registration: its ID (the core's), its name, its keys and its proof over the session's challenge. */
export interface DeviceRegistration {
	device_id: string;
	name: string;
	signature_key: string;
	hpke_key: string;
	proof: string;
}

/** PUT …/identity: the identity, its device list and this device's certificate, what the API keeps for recovery, the
 * key of the identity it replaces (null for the first), and a rotation's transfers or a start over's `reset`. */
export interface IdentityUpload {
	identity_key: string;
	device_list: string;
	certificate: string;
	encrypted_identity: string;
	wrapped_backup_key: string;
	wrapped_previous_backup_keys?: string;
	replaces: string | null;
	reset?: boolean;
	transfers?: { device_id: string; certificate: string; message: string }[];
}

/** PUT …/identity's 200. Its 409 is IdentityChanged. */
export interface IdentityPublished {
	identity_id: string;
	device_list_version: number;
}

/** PUT …/identity's 409 (`identity changed`): the identity the user has now, null without one. */
export interface IdentityChanged {
	error: string;
	identity_key: string | null;
}

/** PUT …/device-list: the list, the version it was signed on top of, and this device's certificate when it brings it. */
export interface DeviceListUpload {
	device_list: string;
	base_version: number;
	certificate?: string;
}

/** PUT …/device-list's 409 (`device list changed`): the current list and its version, to observe before signing again. */
export interface DeviceListChanged {
	error: string;
	device_list: string;
	version: number;
}

/** A user's identity, as observe_user takes it. */
export interface Identity {
	user_id: string;
	identity_key: string;
	device_list: string;
	device_list_version: number;
	certificates: string[];
	/** False when no listed device connected in E2E_DEVICE_ACTIVE_WINDOW. */
	active: boolean;
	changed_at: string;
}

/** What recover takes of the user's identity. */
export interface IdentityBackup {
	identity_key: string;
	device_list: string;
	encrypted_identity: string;
	wrapped_backup_key: string;
	wrapped_previous_backup_keys: string | null;
}

/** A key package as key_packages makes it. */
export interface KeyPackageUpload {
	id: string;
	data: string;
	expires_at: number;
	last_resort: boolean;
}

/** A commit as the core makes it, with the group info of the epoch it makes; a group's creation adds epoch 0's group
 * info and its welcome. */
export interface Commit {
	generation: number;
	epoch: number;
	commit: string;
	group_info: string;
	initial_group_info?: string;
	welcome?: string;
}

/** A commit taken (201; a removal's 200): its number, the group's generation and epoch after it, and its welcome's. Its
 * 409 is EpochTaken, its 422 CommitRefused. */
export interface CommitTaken {
	seq: number;
	generation: number;
	epoch: number;
	welcome_seq?: number;
}

/** A commit's 409 (`another commit took this epoch`): the group's generation and epoch now. */
export interface EpochTaken {
	error: string;
	generation: number;
	epoch: number;
}

/** A commit's 422 (`commit refused`): the validator's code, or `internal` for a call that got no answer. */
export interface CommitRefused {
	error: string;
	code: string;
}

/** A page of a conversation's queue. Its 410 is QueueExpired. */
export interface QueuePage {
	entries: MlsEntry[];
	last_seq: number;
	floor_seq: number;
	generation: number;
	epoch: number;
}

/** The queue's 410 (`queue expired`): it's whole only from floor_seq, and the device joins again by external commit. */
export interface QueueExpired {
	error: string;
	floor_seq: number;
}

/** An addition's answer: the member, as the conversations list gives them, and the commit that added them. */
export type MemberAdded = ConversationMember & { commit: CommitTaken };

/** An encrypted message as a device sends it: its MLS message, its nonce, whom it mentions, what it replies to, its
 * sticker, and the IDs its files go up with, in their order. */
export interface EncryptedMessage {
	ciphertext: string;
	nonce: string;
	mentions?: string[];
	message_reference?: MessageReference;
	allowed_mentions?: AllowedMentions;
	sticker_attachment_id?: string;
	attachment_ids?: string[];
}

/** An edit's answer: when, and its entry, which the core applies. */
export interface MessageEdited {
	id: string;
	edited_at: string;
	entry: MlsEntry;
}

/** A deletion's answer: its tombstone's entry. */
export interface MessageDeleted {
	id: string;
	entry: MlsEntry;
}

/** A message in this device's inbox, from another device. */
export interface InboxMessage {
	id: string;
	from_user_id: string;
	from_device_id: string;
	message: string;
	created_at: string;
}

/** A shared history going up: its recipient, its kind, its range and start (Unix ms), its size and its parts. */
export interface HistoryShareUpload {
	to_user_id: string;
	kind: "share" | "catch_up";
	range: string;
	starts_at: number;
	size: number;
	parts: number;
}

/** A day of the user's backup, as the API keeps it. */
export interface BackupSegment {
	id: string;
	conversation_id: string;
	day: string;
	complete: boolean;
	key_id: string;
	size: number;
	created_at: string;
}

/** A day's 409: the copy the API has now, which the device imports before it builds the day again. */
export interface SegmentReplaced {
	error: string;
	current: string | null;
}

/** What didn't decrypt (PLAN-E2E-API.md, K): anything else counts as `other`. */
export type DecryptFailureKind =
	| "message"
	| "envelope"
	| "too_large"
	| "commit"
	| "welcome"
	| "segment"
	| "attachment"
	| "direct";

/** A day's count of a kind of failure, by client and version (staff only). */
export interface DecryptFailureCount {
	day: string;
	kind: string;
	client: string;
	version: string;
	count: number;
}

/** A file's bytes at the signed URL its route answered: fetched with none of the app's headers, which a redirect would
 * have carried to the storage's host, the session token among them (PLAN-E2E-API.md, I and J). */
async function signedFile(route: Promise<{ url: string }>): Promise<Uint8Array> {
	const { url } = await route;
	const res = await fetchWithin(url, { credentials: "omit" }, requestLimits.answerMs);
	if (!res.ok) {
		const failed = { data: null, status: res.status, statusText: res.statusText, headers: res.headers };
		throw new FetchError(`Request failed with status ${res.status}`, {}, failed);
	}
	return new Uint8Array(await res.arrayBuffer());
}

/** The routes, for the session `client` sends its requests with. */
export function e2eApi(client: ApiClient = api) {
	const answer = <T>(request: Promise<FetchResponse<T>>) => request.then((res) => res.data);
	const done = (request: Promise<FetchResponse>) => request.then(() => undefined);
	const conv = (id: string) => `/api/users/@me/conversations/${id}`;
	return {
		// A. The configuration.
		config: () => answer(client.get<E2eConfig>("/api/e2e")),

		// B. Devices, and the session's binding to one.
		deviceChallenge: () => answer(client.post<{ device_challenge: string }>("/api/users/@me/devices/challenge")),
		/** 201 for a new device, 200 for the same one again with the same keys, which binds the session to it. */
		registerDevice: (device: DeviceRegistration) => answer(client.post<Device>("/api/users/@me/devices", device)),
		bindDevice: (deviceId: string, proof: string) =>
			done(client.post(`/api/users/@me/devices/${deviceId}/bind`, { proof })),
		devices: () => answer(client.get<Device[]>("/api/users/@me/devices")),
		/** Only a device off the device list: a listed one is a 409 (`sign a device list without it`). */
		deleteDevice: (deviceId: string) => done(client.delete(`/api/users/@me/devices/${deviceId}`)),

		// C. The identity and its device list.
		putIdentity: (identity: IdentityUpload) =>
			answer(client.put<IdentityPublished>("/api/users/@me/identity", identity)),
		putDeviceList: (list: DeviceListUpload) =>
			answer(client.put<{ version: number }>("/api/users/@me/device-list", list)),
		/** A 404 (`no identity`) for a user without one. */
		identity: (userId: string) => answer(client.get<Identity>(`/api/users/${userId}/identity`)),
		/** 50 users at most; those the user can't read, or without one, are left out. */
		identities: (userIds: string[]) =>
			answer(client.get<Identity[]>("/api/users/identities", { params: { ids: userIds.join(",") } })),
		identityBackup: () => answer(client.get<IdentityBackup>("/api/users/@me/identity/backup")),

		// D. Key packages.
		/** The device's whole set, in place of the one it had: the answer names those of it already handed out. */
		putKeyPackages: (keyPackages: KeyPackageUpload[]) =>
			answer(
				client.put<{ handed_out: string[] }>("/api/users/@me/devices/@me/key-packages", { key_packages: keyPackages }),
			),
		/** One for each listed device of the user's that has one to give. */
		claimKeyPackages: (userId: string) =>
			answer(
				client.post<{ key_packages: { device_id: string; data: string }[] }>(`/api/users/${userId}/key-packages/claim`),
			),

		// E. A conversation's group.
		groupInfo: (conversationId: string) =>
			answer(
				client.get<{ generation: number; epoch: number; group_info: string }>(`${conv(conversationId)}/mls/group-info`),
			),
		commit: (conversationId: string, commit: Commit) =>
			answer(client.post<CommitTaken>(`${conv(conversationId)}/mls/commits`, commit)),
		/** Its entries numbered after `after`, `limit` of them (200 by default, 500 at most). */
		queue: (conversationId: string, after: number, limit?: number) =>
			answer(client.get<QueuePage>(`${conv(conversationId)}/mls/queue`, { params: { after, limit } })),

		// F. Members: an addition and a removal are the owner's commit of exactly that user, leaving is a statement.
		addMember: (conversationId: string, userId: string, commit: Commit) =>
			answer(client.post<MemberAdded>(`${conv(conversationId)}/members`, { user_id: userId, ...commit })),
		removeMember: (conversationId: string, userId: string, commit: Commit) =>
			answer(client.delete<CommitTaken>(`${conv(conversationId)}/members/${userId}`, { data: commit })),
		/** With the user's leave statement where the conversation has a group, without one where it hasn't. */
		leave: (conversationId: string, statement?: string) =>
			done(
				client.delete(
					`${conv(conversationId)}/members/@me`,
					statement === undefined ? undefined : { data: { statement } },
				),
			),

		// G. Messages.
		/** Its sealed files, if any, go in a form after its fields, in the order its attachment_ids name them. */
		sendMessage: (conversationId: string, message: EncryptedMessage, files: Blob[] = [], upload?: UploadOptions) => {
			const path = `${conv(conversationId)}/messages`;
			if (files.length === 0) return answer(client.post<DirectMessage>(path, message));
			const form = new FormData();
			for (const [field, value] of Object.entries(message)) {
				for (const one of Array.isArray(value) ? value : [value]) {
					if (one !== undefined) form.append(field, typeof one === "string" ? one : JSON.stringify(one));
				}
			}
			for (const file of files) form.append("files", file);
			return answer(client.post<DirectMessage>(path, form, upload));
		},
		editMessage: (conversationId: string, messageId: string, ciphertext: string) =>
			answer(client.patch<MessageEdited>(`${conv(conversationId)}/messages/${messageId}`, { ciphertext })),
		deleteMessage: (conversationId: string, messageId: string, ciphertext: string) =>
			answer(client.delete<MessageDeleted>(`${conv(conversationId)}/messages/${messageId}`, { data: { ciphertext } })),
		/** The conversation's deleted encrypted messages, by ID, after `after`: 1000 at most. */
		deletedMessages: (conversationId: string, after?: string, limit?: number) =>
			answer(client.get<{ ids: string[] }>(`${conv(conversationId)}/messages/deleted`, { params: { after, limit } })),

		// H. The inbox between devices.
		sendToDevice: (deviceId: string, message: string) =>
			answer(client.post<{ id: string }>(`/api/devices/${deviceId}/inbox`, { message })),
		/** This device's inbox after `after`, oldest first, 100 at most. */
		inbox: (after?: string, limit?: number) =>
			answer(client.get<InboxMessage[]>("/api/users/@me/devices/@me/inbox", { params: { after, limit } })),
		/** Deletes this device's inbox through `through`, the last message it handled. */
		clearInbox: (through: string) => done(client.delete("/api/users/@me/devices/@me/inbox", { params: { through } })),

		// I. Shared history.
		putShare: (conversationId: string, shareId: string, share: HistoryShareUpload) =>
			done(client.put(`${conv(conversationId)}/history-shares/${shareId}`, share)),
		putSharePart: (conversationId: string, shareId: string, n: number, part: Blob) =>
			done(client.put(`${conv(conversationId)}/history-shares/${shareId}/parts/${n}`, part)),
		completeShare: (conversationId: string, shareId: string) =>
			done(client.post(`${conv(conversationId)}/history-shares/${shareId}/complete`)),
		/** The packages for the user that this device hasn't acknowledged. */
		shares: () => answer(client.get<HistoryShare[]>("/api/users/@me/history-shares")),
		sharePart: (shareId: string, n: number) =>
			signedFile(answer(client.get<{ url: string }>(`/api/history-shares/${shareId}/parts/${n}`))),
		ackShare: (shareId: string) => done(client.post(`/api/history-shares/${shareId}/ack`)),

		// J. The encrypted backup.
		/** 1000 at most; `identity` reads those of the identity before a start over, for 30 days. */
		segments: (query: { conversation_id?: string; after?: string; identity?: string } = {}) =>
			answer(client.get<BackupSegment[]>("/api/users/@me/backup/segments", { params: query })),
		/** In place of the day's copy it names (`replaces`, null when it saw none): another one there is a 409. */
		putSegment: (conversationId: string, day: string, segment: Blob, replaces: string | null) =>
			answer(
				client.put<{ id: string }>(`/api/users/@me/backup/segments/${conversationId}/${day}`, segment, {
					params: { replaces: replaces ?? "none" },
				}),
			),
		segment: (segmentId: string) =>
			signedFile(answer(client.get<{ url: string }>(`/api/users/@me/backup/segments/${segmentId}`))),

		// K. Decryption failures: counted by kind, with no ID and no content.
		reportDecryptFailure: (kind: DecryptFailureKind, count?: number) =>
			done(client.post("/api/e2e/decrypt-failures", { kind, count })),
		decryptFailures: (from: string, to: string) =>
			answer(client.get<DecryptFailureCount[]>("/api/internal/e2e/decrypt-failures", { params: { from, to } })),
	};
}

export type E2eApi = ReturnType<typeof e2eApi>;
