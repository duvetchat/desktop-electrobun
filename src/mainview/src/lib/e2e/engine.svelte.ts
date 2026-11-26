// The app's encryption engine (PLAN-E2E-CLIENTES.md, «El motor»): one for the page, started once the app has a session
// and knows whose (its READY), on the page's one host. In the desktop app that's Bun's core, through one host for the
// page, as each host hears every reply of Bun's for good. On the web it's the worker of the tab that leads, which runs
// the engine and serves the user's other tabs (web/tabs.ts, Ruling 16): they show its state, and ask it for the
// person's taps and their messages. `encryption.state` is what the views read, `encryption.conversations` what each
// conversation says of its group, and conversation-content.svelte.ts what the device holds of their messages. The hosts
// load with the engine's start, never with a page.
import { get } from "svelte/store";
import { withSentMessage } from "$lib/arrivals";
import type { UploadOptions } from "$lib/api/api";
import { onSignOut } from "$lib/api/auth";
import type { Conversation, ConversationMember, DirectMessage } from "$lib/api/conversations";
import { e2eApi, type NewConversationRequest } from "$lib/api/e2e";
import { deviceRegistered } from "$lib/api/ws/connection";
import { isElectrobunWindow } from "$lib/electrobun-rpc";
import { useDeviceSearch } from "$lib/search";
import { dmMessages } from "$lib/stores.svelte";
import { toast } from "$lib/stores/toast.svelte";
import { t } from "$lib/i18n";
import { deviceName } from "./client";
import { moveTyped, refresh, refreshAll, useReader } from "./conversation-content.svelte";
import { decryptedFiles, useNamer } from "./decrypted-files.svelte";
import { CoreError } from "./errors";
import {
	E2EEngine,
	systemClock,
	type ConversationState,
	type EngineState,
	type Outgoing,
	type Pending,
	type ShownMessage,
} from "./engine/engine";
import type { DeviceFound, DeviceSearch } from "./engine/search";
import { pageStore } from "./engine/store";
import { engineEvents } from "./events";
import type { CoreHost } from "./host";
import { missingInPage } from "./web/support";
import { BrowserTabs, type BrowserTabsOptions } from "./web/tabs";

export const encryption = $state<{
	state: EngineState;
	conversations: Record<string, ConversationState>;
	/** The cutover's instant, as the API gives it: a conversation from before it says when its messages went. */
	cutoverAt: string | null;
}>({
	state: { name: "starting" },
	conversations: {},
	cutoverAt: null,
});

/** What a conversation says of its group, shown: none goes. */
function showConversation(conversationId: string, state: ConversationState | null) {
	if (state) encryption.conversations[conversationId] = state;
	else delete encryption.conversations[conversationId];
}

/** What the page's engine runs on: the page's own, or a test's (a host of its own, task 8's locks and channel). */
export interface EnginePlatform {
	desktop: boolean;
	desktopHost(): Promise<CoreHost | null>;
	webHost(): Promise<CoreHost>;
	/** What the web lacks for encrypted conversations (web/support.ts). */
	missing(): readonly string[];
	tabs?: Pick<BrowserTabsOptions, "locks" | "channel">;
	persist(): Promise<unknown> | undefined;
}

const pagePlatform = (): EnginePlatform => ({
	desktop: isElectrobunWindow(),
	desktopHost: () => import("./host-desktop").then(({ desktopCoreHost }) => desktopCoreHost()),
	webHost: () => import("./host-web").then(({ WebCoreHost }) => new WebCoreHost()),
	missing: missingInPage,
	persist: () => navigator.storage?.persist?.(),
});

let started = false;
let engine: E2EEngine | null = null;
let tabs: BrowserTabs | null = null;
let persisted = false;
/** Conversations opened before the page had its engine (its host still loading): it opens them once it's ready. */
const toOpen = new Set<string>();
/** What stops the upload of each message another tab asked this leader to send, by its nonce: that tab's Cancel. */
const othersUploads = new Map<string, AbortController>();

/** The conversation opened, by the page's engine, or by the one it's about to have. */
function openOnEngine(conversationId: string): Promise<void> {
	if (engine) return engine.openConversation(conversationId);
	toOpen.add(conversationId);
	return Promise.resolve();
}

function engineFor(userId: string, host: CoreHost, platform: EnginePlatform): E2EEngine {
	const made = new E2EEngine({
		host,
		api: e2eApi(),
		events: engineEvents,
		store: pageStore(userId),
		clock: systemClock,
		user: userId,
		deviceName: deviceName(),
		registered: (device) => deviceRegistered(userId, device),
	});
	made.onState((state) => {
		encryption.state = state;
		encryption.cutoverAt = made.cutoverAt;
		// Ready, the rows the views asked for before may be there now.
		if (state.name === "ready") refreshAll();
		// On the web, once the device is set up: clearing the site's data would make this browser a new device.
		if (state.name !== "ready" || persisted || platform.desktop) return;
		persisted = true;
		platform.persist()?.catch((error: unknown) => console.error("[e2e] Storage wasn't made to last:", error));
	});
	// The user's other tabs hear that the conversation changed, and ask what it says now.
	made.onConversation((conversationId, state) => {
		showConversation(conversationId, state);
		tabs?.changed(conversationId);
	});
	// What the device holds of a conversation's messages changed: the views read those again, here and in the other tabs,
	// and draw a row past how far its queue is applied as loading.
	made.onMessages((conversationId, ids, through, deleted = []) => {
		// A message the queue deleted lets its files go, here and in the other tabs (task 18's review, M4).
		for (const id of deleted) decryptedFiles.forgetMessage(id);
		refresh(conversationId, ids, through);
		tabs?.changed(conversationId, deleted);
	});
	made.onSent(showSent);
	// An edit or a deletion the API refused for good shows on this device alone: the person is told.
	made.onChangeRefused((_conversationId, _messageId, kind) => {
		toast(t(kind === "edit" ? "e2e_edit_refused" : "e2e_delete_refused"), "error");
	});
	for (const conversationId of toOpen) {
		made.openConversation(conversationId).catch((error: unknown) => {
			console.error("[e2e] The conversation's group didn't open:", error);
		});
	}
	toOpen.clear();
	return made;
}

/**
 * A message of the person's that the API took, by the nonce it was sent with (the first, if its bytes were made again):
 * their copy in the conversation's list is the API's, as DM_MESSAGE_CREATE's would be. The engine may have sent it on its
 * own (what waited, at a start), where no view is waiting for the answer.
 */
function showSent(conversationId: string, nonce: string, message: DirectMessage) {
	moveTyped(conversationId, nonce, message.id);
	dmMessages.update((all) => {
		const existing = all[conversationId];
		if (!existing) return all;
		const shown = withSentMessage(existing, nonce, message);
		return shown === existing ? all : { ...all, [conversationId]: shown };
	});
}

/** Starts the page's engine for the session's user, once until it stops: its core closes as the user signs out. */
export async function startEngine(userId: string, platform: EnginePlatform = pagePlatform()): Promise<void> {
	if (started) return;
	started = true;
	onSignOut(stopEngine);
	const read = (conversationId: string, ids: string[]) =>
		onMessages<{ rows: ShownMessage[]; through?: number | null }>("read", { conversationId, ids }, (made) =>
			made.read(conversationId, ids),
		);
	useReader(read);
	// The searches read the device too (lib/search.ts): its own search of the conversations, the rows of what the API's
	// search found, and the API's rows this page already holds.
	useDeviceSearch({
		read,
		search: (request: DeviceSearch) => onMessages<DeviceFound>("search", request, (made) => made.search(request)),
		loaded: (conversationId, id) => get(dmMessages)[conversationId]?.find((message) => message.id === id),
	});
	// A conversation's files come down to this page, and the core of this tab or of the one that leads opens them.
	decryptedFiles.useOpener({
		download: (url, most, progress) => e2eApi().sealedFile(url, most, progress),
		open: (key, attachmentId, sealed, progress) =>
			onMessages<Blob>("openFile", { key, attachmentId, sealed }, (made) =>
				made.openFile(key, attachmentId, sealed, progress),
			),
		failed: () =>
			void onMessages<void>("fileFailed", null, async (made) => made.fileFailed()).catch((error: unknown) => {
				console.warn("[e2e] A file that didn't open went uncounted:", error);
			}),
	});
	useNamer(() => onMessages<Map<string, string>>("fileNames", null, (made) => made.fileNames()));
	if (platform.desktop) {
		const host = await platform.desktopHost();
		if (!host) return;
		engine = engineFor(userId, host, platform);
		return engine.start();
	}
	if (platform.missing().length) {
		encryption.state = { name: "unsupported" };
		return;
	}
	tabs = new BrowserTabs({
		userId,
		...platform.tabs,
		methods: {
			state: () => engine?.state ?? encryption.state,
			makeIdentity: () => engine?.makeIdentity(),
			keySaved: () => engine?.keySaved(),
			uploadLater: () => engine?.uploadLater(),
			startOver: () => engine?.startOver(),
			conversation: (id: string) => engine?.conversationState(id) ?? null,
			openConversation: (id: string) => openOnEngine(id),
			restartGroup: ({ conversationId, leaving }: MessageParams) => live().restartGroup(conversationId, leaving),
			acceptMembers: (id: string) => engine?.acceptMembers(id),
			createConversation: (made: NewConversationRequest) => live().createConversation(made),
			addMember: ({ conversationId, userId: user }: MessageParams) => live().addMember(conversationId, user ?? ""),
			removeMember: ({ conversationId, userId: user }: MessageParams) =>
				live().removeMember(conversationId, user ?? ""),
			leaveConversation: (id: string) => live().leaveConversation(id),
			cutoverAt: () => engine?.cutoverAt ?? null,
			sendMessage: (message: Outgoing) => {
				const stop = new AbortController();
				othersUploads.set(message.nonce, stop);
				return live()
					.sendMessage(message, { signal: stop.signal })
					.finally(() => othersUploads.get(message.nonce) === stop && othersUploads.delete(message.nonce));
			},
			cancelUpload: (nonce: string) => othersUploads.get(nonce)?.abort(),
			openFile: ({ key, attachmentId, sealed }: { key: string; attachmentId: string; sealed: Blob }) =>
				live().openFile(key, attachmentId, sealed),
			fileNames: () => live().fileNames(),
			fileFailed: () => live().fileFailed(),
			editMessage: ({ conversationId, messageId, text }: MessageParams) =>
				live().editMessage(conversationId, messageId ?? "", text ?? ""),
			deleteMessage: ({ conversationId, messageId }: MessageParams) =>
				live().deleteMessage(conversationId, messageId ?? ""),
			discardMessage: ({ conversationId, nonce }: MessageParams) => live().discardMessage(conversationId, nonce ?? ""),
			read: ({ conversationId, ids }: MessageParams) => live().read(conversationId, ids ?? []),
			search: (request: DeviceSearch) => live().search(request),
			heldBefore: ({ conversationId, seq }: MessageParams) => live().heldBefore(conversationId, seq ?? 0),
			pendingMessages: (conversationId: string) => live().pendingMessages(conversationId),
		},
		lead: async () => {
			engine = engineFor(userId, await platform.webHost(), platform);
			await engine.start();
		},
		onLeader: () => void follow(),
		onChanged: (id, deleted) => {
			void followConversation(id);
			for (const message of deleted) decryptedFiles.forgetMessage(message);
			if (!tabs?.leader) refresh(id);
		},
	});
	if (typeof document !== "undefined") {
		document.addEventListener("visibilitychange", () => {
			if (!document.hidden) void follow();
		});
	}
	void follow();
}

/** A tab that doesn't lead shows the leader's state: asked as a leader starts, and as the tab shows again. */
async function follow(): Promise<void> {
	// The tabs it asks: the engine may stop meanwhile, which closes them, and its calls then fail as they're made.
	const asked = tabs;
	if (!asked || asked.leader) return;
	encryption.state = await asked.call<EngineState>("state").catch(() => encryption.state);
	encryption.cutoverAt = await asked.call<string | null>("cutoverAt").catch(() => encryption.cutoverAt);
	if (encryption.state.name === "ready") refreshAll();
}

/** A tab that doesn't lead shows what the leader says of a conversation it says changed. */
async function followConversation(conversationId: string): Promise<void> {
	if (!tabs || tabs.leader) return;
	const state = await tabs.call<ConversationState | null>("conversation", conversationId).catch(() => undefined);
	if (state !== undefined) showConversation(conversationId, state);
}

type ConversationTap = "openConversation" | "acceptMembers";

/** The person's act on a conversation, run by the engine of this tab or of the one that leads. */
function onConversation(method: ConversationTap, conversationId: string): Promise<void> {
	if (tabs) return tabs.call<void>(method, conversationId).finally(() => followConversation(conversationId));
	if (method === "openConversation") return openOnEngine(conversationId);
	return engine?.[method](conversationId) ?? Promise.resolve();
}

/** The conversation opened: its group goes on, or is made where this user may (PLAN-E2E-CLIENTES.md, «Entrar a un grupo»). */
export const openConversation = (conversationId: string) => onConversation("openConversation", conversationId);
/**
 * Restart encryption, over a blocked group this user may restart: whom it would leave out that the person hasn't
 * confirmed (`leaving`), and nothing restarted while there are some; none once it restarts.
 */
export const restartGroup = (conversationId: string, leaving: readonly string[] = []) =>
	onMessages<string[]>("restartGroup", { conversationId, leaving: [...leaving] }, (made) =>
		made.restartGroup(conversationId, leaving),
	).finally(() => followConversation(conversationId));
/** Open with these members, over a conversation whose members aren't those this device first saw. */
export const acceptMembers = (conversationId: string) => onConversation("acceptMembers", conversationId);

/** What a tab asks of the leader's engine about a conversation's messages, or its members. */
interface MessageParams {
	conversationId: string;
	ids?: string[];
	messageId?: string;
	text?: string;
	nonce?: string;
	seq?: number;
	userId?: string;
	leaving?: string[];
}

const NOT_READY = "encrypted conversations aren't ready on this device";

/** The leader's engine, for what another tab asks of it: none yet is a refusal, as the tab would show. */
function live(): E2EEngine {
	if (!engine) throw new CoreError("not_ready", NOT_READY);
	return engine;
}

/** The person's act on a conversation's messages: by this page's engine, or the tab that leads (Ruling 16). */
function onMessages<T>(method: string, params: unknown, run: (made: E2EEngine) => Promise<T>): Promise<T> {
	if (tabs) return tabs.call<T>(method, params);
	return engine ? run(engine) : Promise.reject(new CoreError("not_ready", NOT_READY));
}

/**
 * The person's message to a conversation (PLAN-E2E-CLIENTES.md, «Enviar»): the API's message, or null if it went
 * already. Its files go sealed («Adjuntos»), `upload` following them where this page runs the engine; from another tab,
 * its Cancel stops the leader's upload.
 */
export function sendEncrypted(message: Outgoing, upload?: UploadOptions): Promise<DirectMessage | null> {
	if (tabs && !tabs.leader) {
		upload?.signal?.addEventListener("abort", () => void tabs?.call("cancelUpload", message.nonce).catch(() => {}), {
			once: true,
		});
		return tabs.call<DirectMessage | null>("sendMessage", message);
	}
	return engine ? engine.sendMessage(message, upload) : Promise.reject(new CoreError("not_ready", NOT_READY));
}
/** An edit of the person's message, which shows at once. */
export const editEncrypted = (conversationId: string, messageId: string, text: string) =>
	onMessages<void>("editMessage", { conversationId, messageId, text }, (made) =>
		made.editMessage(conversationId, messageId, text),
	);
/** A deletion of the person's message, for everyone. */
export const deleteEncrypted = (conversationId: string, messageId: string) =>
	onMessages<void>("deleteMessage", { conversationId, messageId }, (made) =>
		made.deleteMessage(conversationId, messageId),
	);
/** The person's Dismiss of a message that never went: the API's ID of one the queue says went after all, else null. */
export const discardEncrypted = (conversationId: string, nonce: string) =>
	onMessages<string | null>("discardMessage", { conversationId, nonce }, (made) =>
		made.discardMessage(conversationId, nonce),
	);
/** Whether the device holds a message of the conversation older than this number, which its list pages on to. */
export const heldBeforeEncrypted = (conversationId: string, seq: number) =>
	onMessages<boolean>("heldBefore", { conversationId, seq }, (made) => made.heldBefore(conversationId, seq));
/** The person's messages of the conversation still being sent, in their order. */
export const pendingEncrypted = (conversationId: string) =>
	onMessages<Pending[]>("pendingMessages", conversationId, (made) => made.pendingMessages(conversationId));

/**
 * The person's new conversation (PLAN-E2E-CLIENTES.md, Task 22), by the engine of this tab or of the one that leads,
 * which makes its group at once: the API's conversation. A page without an engine (a browser that can't run one, or
 * its host still loading) has the API make it alone, and its group waits for a device that can.
 */
function createConversation(made: NewConversationRequest): Promise<Conversation> {
	if (tabs) return tabs.call<Conversation>("createConversation", made);
	if (engine) return engine.createConversation(made);
	return e2eApi()
		.createConversation(made)
		.then((conv) => {
			void openOnEngine(conv.id);
			return conv;
		});
}
/** A DM with a friend: the one they have, or a new one, its group made at once. */
export const createDM = (userId: string) => createConversation({ type: 1, user_id: userId });
/** A group of friends the user owns, named, its group made at once: 20 members at most, the user among them. */
export const createGroup = (name: string, userIds: string[]) =>
	createConversation({ type: 2, name, user_ids: userIds });
/** The owner adds a user to the group, one commit of exactly them: the member added. */
export const addMember = (conversationId: string, userId: string) =>
	onMessages<ConversationMember>("addMember", { conversationId, userId }, (made) =>
		made.addMember(conversationId, userId),
	);
/** The owner removes a member from the group, one commit that takes their devices out with them. */
export const removeMember = (conversationId: string, userId: string) =>
	onMessages<void>("removeMember", { conversationId, userId }, (made) => made.removeMember(conversationId, userId));
/**
 * The person leaves a group, with the statement this device signs. A page without an engine leaves one that has no
 * group yet, which takes none, as the API does; one with a group needs the statement, which the API asks for.
 */
export function leaveConversation(conversationId: string): Promise<void> {
	if (!tabs && !engine) return e2eApi().leave(conversationId);
	return onMessages<void>("leaveConversation", conversationId, (made) => made.leaveConversation(conversationId));
}

type Tap = "makeIdentity" | "keySaved" | "uploadLater" | "startOver";

/** One of the person's taps, run by the engine of this tab or of the one that leads: it settles with its state shown. */
function tap(method: Tap): Promise<void> {
	if (tabs) return tabs.call<void>(method).finally(follow);
	return engine?.[method]() ?? Promise.resolve();
}

export const makeIdentity = () => tap("makeIdentity");
export const keySaved = () => tap("keySaved");
export const uploadLater = () => tap("uploadLater");
export const startOver = () => tap("startOver");

/** Stops the engine and closes its core, whose database stays; on the web, this tab leaves the user's tabs after. */
export async function stopEngine(): Promise<void> {
	const stopping = engine;
	engine = null;
	started = false;
	toOpen.clear();
	// What the device's database showed goes from memory, nothing searches it, and what it decrypted goes too.
	useReader(null);
	useDeviceSearch(null);
	decryptedFiles.useOpener(null);
	useNamer(null);
	await stopping?.stop();
	tabs?.close();
	tabs = null;
}
