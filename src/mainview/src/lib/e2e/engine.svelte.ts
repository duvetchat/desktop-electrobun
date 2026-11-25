// The app's encryption engine (PLAN-E2E-CLIENTES.md, «El motor»): one for the page, started once the app has a session
// and knows whose (its READY), on the page's one host. In the desktop app that's Bun's core, through one host for the
// page, as each host hears every reply of Bun's for good. On the web it's the worker of the tab that leads, which runs
// the engine and serves the user's other tabs (web/tabs.ts, Ruling 16): they show its state, and ask it for the
// person's taps and their messages. `encryption.state` is what the views read, `encryption.conversations` what each
// conversation says of its group, and conversation-content.svelte.ts what the device holds of their messages. The hosts
// load with the engine's start, never with a page.
import { withSentMessage, withTyped } from "$lib/arrivals";
import { onSignOut } from "$lib/api/auth";
import type { DirectMessage } from "$lib/api/conversations";
import { e2eApi } from "$lib/api/e2e";
import { deviceRegistered } from "$lib/api/ws/connection";
import { isElectrobunWindow } from "$lib/electrobun-rpc";
import { dmMessages } from "$lib/stores.svelte";
import { deviceName } from "./client";
import { refresh, refreshAll, useReader } from "./conversation-content.svelte";
import {
	E2EEngine,
	systemClock,
	type ConversationState,
	type EngineState,
	type Outgoing,
	type Pending,
	type ShownMessage,
} from "./engine/engine";
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
	// What the device holds of a conversation's messages changed: the views read it again, here and in the other tabs.
	made.onMessages((conversationId) => {
		refresh(conversationId);
		tabs?.changed(conversationId);
	});
	made.onSent(showSent);
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
	dmMessages.update((all) => {
		const existing = all[conversationId];
		if (!existing) return all;
		const shown = withSentMessage(existing, nonce, withTyped(existing, nonce, message));
		return shown === existing ? all : { ...all, [conversationId]: shown };
	});
}

/** Starts the page's engine for the session's user, once until it stops: its core closes as the user signs out. */
export async function startEngine(userId: string, platform: EnginePlatform = pagePlatform()): Promise<void> {
	if (started) return;
	started = true;
	onSignOut(stopEngine);
	useReader((conversationId, ids) =>
		onMessages<ShownMessage[]>("messages", { conversationId, ids }, (made) => made.messages(conversationId, ids)),
	);
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
			restartGroup: (id: string) => engine?.restartGroup(id),
			acceptMembers: (id: string) => engine?.acceptMembers(id),
			cutoverAt: () => engine?.cutoverAt ?? null,
			sendMessage: (message: Outgoing) => live().sendMessage(message),
			editMessage: ({ conversationId, messageId, text }: MessageParams) =>
				live().editMessage(conversationId, messageId ?? "", text ?? ""),
			deleteMessage: ({ conversationId, messageId }: MessageParams) =>
				live().deleteMessage(conversationId, messageId ?? ""),
			discardMessage: ({ conversationId, nonce }: MessageParams) => live().discardMessage(conversationId, nonce ?? ""),
			messages: ({ conversationId, ids }: MessageParams) => live().messages(conversationId, ids ?? []),
			pendingMessages: (conversationId: string) => live().pendingMessages(conversationId),
		},
		lead: async () => {
			engine = engineFor(userId, await platform.webHost(), platform);
			await engine.start();
		},
		onLeader: () => void follow(),
		onChanged: (id) => {
			void followConversation(id);
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
	if (!tabs || tabs.leader) return;
	encryption.state = await tabs.call<EngineState>("state").catch(() => encryption.state);
	encryption.cutoverAt = await tabs.call<string | null>("cutoverAt").catch(() => encryption.cutoverAt);
	if (encryption.state.name === "ready") refreshAll();
}

/** A tab that doesn't lead shows what the leader says of a conversation it says changed. */
async function followConversation(conversationId: string): Promise<void> {
	if (!tabs || tabs.leader) return;
	const state = await tabs.call<ConversationState | null>("conversation", conversationId).catch(() => undefined);
	if (state !== undefined) showConversation(conversationId, state);
}

type ConversationTap = "openConversation" | "restartGroup" | "acceptMembers";

/** The person's act on a conversation, run by the engine of this tab or of the one that leads. */
function onConversation(method: ConversationTap, conversationId: string): Promise<void> {
	if (tabs) return tabs.call<void>(method, conversationId).finally(() => followConversation(conversationId));
	if (method === "openConversation") return openOnEngine(conversationId);
	return engine?.[method](conversationId) ?? Promise.resolve();
}

/** The conversation opened: its group goes on, or is made where this user may (PLAN-E2E-CLIENTES.md, «Entrar a un grupo»). */
export const openConversation = (conversationId: string) => onConversation("openConversation", conversationId);
/** Restart encryption, over a blocked group this user may restart. */
export const restartGroup = (conversationId: string) => onConversation("restartGroup", conversationId);
/** Open with these members, over a conversation whose members aren't those this device first saw. */
export const acceptMembers = (conversationId: string) => onConversation("acceptMembers", conversationId);

/** What a tab asks of the leader's engine about a conversation's messages. */
interface MessageParams {
	conversationId: string;
	ids?: string[];
	messageId?: string;
	text?: string;
	nonce?: string;
}

/** The leader's engine, for what another tab asks of it: none yet is a refusal, as the tab would show. */
function live(): E2EEngine {
	if (!engine) throw new Error("encrypted conversations aren't ready on this device");
	return engine;
}

/** The person's act on a conversation's messages: by this page's engine, or the tab that leads (Ruling 16). */
function onMessages<T>(method: string, params: unknown, run: (made: E2EEngine) => Promise<T>): Promise<T> {
	if (tabs) return tabs.call<T>(method, params);
	return engine ? run(engine) : Promise.reject(new Error("encrypted conversations aren't ready on this device"));
}

/** The person's message to a conversation (PLAN-E2E-CLIENTES.md, «Enviar»): the API's message, or null if it went already. */
export const sendEncrypted = (message: Outgoing) =>
	onMessages<DirectMessage | null>("sendMessage", message, (made) => made.sendMessage(message));
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
/** The person's Dismiss of a message that never went. */
export const discardEncrypted = (conversationId: string, nonce: string) =>
	onMessages<void>("discardMessage", { conversationId, nonce }, (made) => made.discardMessage(conversationId, nonce));
/** The person's messages of the conversation still being sent, in their order. */
export const pendingEncrypted = (conversationId: string) =>
	onMessages<Pending[]>("pendingMessages", conversationId, (made) => made.pendingMessages(conversationId));

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
	// What the device's database showed goes from memory.
	useReader(null);
	await stopping?.stop();
	tabs?.close();
	tabs = null;
}
