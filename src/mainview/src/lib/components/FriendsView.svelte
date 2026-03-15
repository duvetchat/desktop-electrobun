<script lang="ts">
import { onMount, untrack } from "svelte";
import { get } from "svelte/store";
import { currentUser, pendingFriendRequests, sentFriendRequests, friends, conversations } from "$lib/stores.svelte";
import {
	sendFriendRequest,
	getPendingRequests,
	getSentRequests,
	acceptFriendRequest,
	rejectFriendRequest,
	getFriends,
	unfriend,
	getUser,
	type FriendRequest,
	type Friend,
	type UserPublic,
} from "$lib/api/friends";
import {
	getConversations,
	createDM,
	createGroup,
	type Conversation,
} from "$lib/api/conversations";
import { UserPlus, UserCheck, UserX, Users, Clock, Send, MessageSquare, UsersRound, Check } from "@lucide/svelte";
import UserAvatar from "$lib/components/UserAvatar.svelte";
import ConversationView from "$lib/components/ConversationView.svelte";

type Tab = "dms" | "friends" | "pending" | "sent" | "add";
let activeTab = $state<Tab>("dms");
let activeConversation = $state<Conversation | null>(null);

let sentRequestUsers = $state<Map<string, UserPublic>>(new Map());
let friendUsers = $state<Map<string, UserPublic>>(new Map());
let pendingUsers = $state<Map<string, UserPublic>>(new Map());
let addUserId = $state("");
let addError = $state("");
let addSuccess = $state("");
let loading = $state(false);

// Group creation state
let showGroupModal = $state(false);
let groupName = $state("");
let selectedFriendIds = $state(new Set<string>());
let groupError = $state("");

function toggleFriend(uid: string) {
	const next = new Set(selectedFriendIds);
	if (next.has(uid)) next.delete(uid);
	else next.add(uid);
	selectedFriendIds = next;
}

function closeGroupModal() {
	showGroupModal = false;
	groupName = "";
	selectedFriendIds = new Set();
	groupError = "";
}

async function loadUsers<K extends string>(ids: K[], existing?: Map<string, UserPublic>): Promise<Map<string, UserPublic>> {
	const map = new Map<string, UserPublic>(existing);
	const entries = await Promise.allSettled(
		ids.filter((id) => !map.has(id)).map(async (id) => {
			const user = await getUser(id);
			return [id, user] as const;
		}),
	);
	for (const result of entries) {
		if (result.status === "fulfilled") {
			map.set(result.value[0], result.value[1]);
		}
	}
	return map;
}

async function loadSentUsers(sent: FriendRequest[]) {
	sentRequestUsers = await loadUsers(sent.map((r) => r.recipient_id));
}

async function loadFriendUsers(friendList: Friend[]) {
	const me = get(currentUser);
	const ids = friendList.map((f) => (f.sender_id === me?.id ? f.recipient_id : f.sender_id));
	const existing = untrack(() => friendUsers);
	const missing = ids.filter((id) => !existing.has(id));
	if (missing.length === 0) return;
	friendUsers = await loadUsers(ids, existing);
}

$effect(() => {
	void loadFriendUsers($friends);
});

async function loadPendingUsers(pending: FriendRequest[]) {
	pendingUsers = await loadUsers(pending.map((r) => r.sender_id));
}

onMount(async () => {
	try {
		let pending = get(pendingFriendRequests);
		let sent = get(sentFriendRequests);
		let friendList = get(friends);
		let convList = get(conversations);

		// Only fetch if the WS READY handler hasn't populated the stores yet
		const needsFetch = pending.length === 0 && sent.length === 0 && friendList.length === 0 && convList.length === 0;
		if (needsFetch) {
			[pending, sent, friendList, convList] = await Promise.all([
				getPendingRequests(),
				getSentRequests(),
				getFriends(),
				getConversations(),
			]);
			pendingFriendRequests.set(pending);
			sentFriendRequests.set(sent);
			friends.set(friendList);
			conversations.set(convList);
		}

		await Promise.all([
			loadSentUsers(sent),
			loadPendingUsers(pending),
		]);
	} catch (err) {
		console.error("[Friends] Failed to load:", err);
	}
});

async function handleSendRequest() {
	addError = "";
	addSuccess = "";
	if (!addUserId.trim()) {
		addError = "Enter a user ID";
		return;
	}
	loading = true;
	try {
		await sendFriendRequest(addUserId.trim());
		addSuccess = "Friend request sent!";
		addUserId = "";
		const sent = await getSentRequests();
		sentFriendRequests.set(sent);
		await loadSentUsers(sent);
	} catch (err) {
		addError = err instanceof Error ? err.message : "Failed to send request";
	} finally {
		loading = false;
	}
}

async function handleAccept(request: FriendRequest) {
	try {
		const friend = await acceptFriendRequest(request.id);
		pendingFriendRequests.update((reqs) => reqs.filter((r) => r.id !== request.id));
		friends.update((list) => {
			if (list.some((f) => f.id === friend.id)) return list;
			return [...list, friend];
		});
		friendUsers = await loadUsers([request.sender_id], friendUsers);
	} catch (err) {
		console.error("[Friends] Accept failed:", err);
	}
}

async function handleReject(request: FriendRequest) {
	try {
		await rejectFriendRequest(request.id);
		pendingFriendRequests.update((reqs) => reqs.filter((r) => r.id !== request.id));
	} catch (err) {
		console.error("[Friends] Reject failed:", err);
	}
}

async function handleCancelSent(request: FriendRequest) {
	try {
		await rejectFriendRequest(request.id);
		sentFriendRequests.update((reqs) => reqs.filter((r) => r.id !== request.id));
	} catch (err) {
		console.error("[Friends] Cancel failed:", err);
	}
}

async function handleUnfriend(friend: Friend) {
	const me = get(currentUser);
	if (!me) return;
	const otherUserId = friend.sender_id === me.id ? friend.recipient_id : friend.sender_id;
	try {
		await unfriend(otherUserId);
		friends.update((list) => list.filter((f) => f.id !== friend.id));
	} catch (err) {
		console.error("[Friends] Unfriend failed:", err);
	}
}

function getFriendUserId(friend: Friend): string {
	const me = get(currentUser);
	if (!me) return "";
	return friend.sender_id === me.id ? friend.recipient_id : friend.sender_id;
}

async function handleOpenDM(friend: Friend) {
	const me = get(currentUser);
	if (!me) return;
	const otherUserId = getFriendUserId(friend);
	try {
		const conv = await createDM(otherUserId);
		conversations.update((list) => {
			if (list.some((c) => c.id === conv.id)) return list;
			return [conv, ...list];
		});
		activeConversation = conv;
		activeTab = "dms";
	} catch (err) {
		console.error("[DM] Failed to open DM:", err);
	}
}

async function handleCreateGroup() {
	groupError = "";
	if (!groupName.trim()) {
		groupError = "Introduce un nombre para el grupo";
		return;
	}
	if (selectedFriendIds.size === 0) {
		groupError = "Agrega al menos un amigo al grupo";
		return;
	}
	try {
		const conv = await createGroup(groupName.trim(), [...selectedFriendIds]);
		conversations.update((list) => {
			if (list.some((c) => c.id === conv.id)) return list;
			return [conv, ...list];
		});
		closeGroupModal();
		activeConversation = conv;
		activeTab = "dms";
	} catch (err) {
		groupError = err instanceof Error ? err.message : "Error al crear el grupo";
	}
}

function convTitle(conv: Conversation): string {
	const me = get(currentUser);
	if (conv.type === 2) return conv.name ?? "Grupo";
	const other = conv.members.find((m) => m.user_id !== me?.id);
	return other?.users?.alias ?? other?.users?.username ?? "DM";
}

function convSubtitle(conv: Conversation): string {
	if (conv.type === 2) return `${conv.members.length} miembros`;
	return "Mensaje directo";
}

function convAvatarSrc(conv: Conversation): string | null | undefined {
	if (conv.type === 2) return null;
	const me = get(currentUser);
	const other = conv.members.find((m) => m.user_id !== me?.id);
	return other?.users?.avatar;
}
</script>

<div class="friends-view">
	{#if activeConversation && activeTab === "dms"}
		<div class="flex flex-col h-full">
			<div class="flex items-center gap-2 px-3 py-2 border-b border-[#3f4147] bg-[#1e1f22]">
				<button
					class="text-xs text-[#949ba4] hover:text-[#dbdee1] flex items-center gap-1"
					onclick={() => { activeConversation = null; }}
				>
					← Volver
				</button>
			</div>
			<ConversationView conversation={activeConversation} />
		</div>
	{:else}
	<div class="friends-header">
		<div class="flex items-center justify-between mb-3">
			<h2>Mensajes</h2>
			{#if activeTab === "dms"}
				<button class="create-group-btn" onclick={() => (showGroupModal = true)}>
					<UsersRound size={13} />
					Nuevo grupo
				</button>
			{/if}
		</div>
		<div class="tabs">
			<button
				class="tab"
				class:active={activeTab === "dms"}
				onclick={() => { activeTab = "dms"; activeConversation = null; }}
			>
				<MessageSquare size={14} />
				DMs
				{#if $conversations.length > 0}
					<span class="badge">{$conversations.length}</span>
				{/if}
			</button>
			<button
				class="tab"
				class:active={activeTab === "friends"}
				onclick={() => (activeTab = "friends")}
			>
				<Users size={14} />
				Amigos
				{#if $friends.length > 0}
					<span class="badge">{$friends.length}</span>
				{/if}
			</button>
			<button
				class="tab"
				class:active={activeTab === "pending"}
				onclick={() => (activeTab = "pending")}
			>
				<Clock size={14} />
				Pendientes
				{#if $pendingFriendRequests.length > 0}
					<span class="badge pending">{$pendingFriendRequests.length}</span>
				{/if}
			</button>
			<button
				class="tab"
				class:active={activeTab === "sent"}
				onclick={() => (activeTab = "sent")}
			>
				<Send size={14} />
				Enviadas
			</button>
			<button
				class="tab add-tab"
				class:active={activeTab === "add"}
				onclick={() => (activeTab = "add")}
			>
				<UserPlus size={14} />
				Agregar
			</button>
		</div>
	</div>

	<div class="friends-content">
		{#if activeTab === "dms"}
			{#if $conversations.length === 0}
				<div class="empty-state">
					<MessageSquare size={40} />
					<p>No tienes conversaciones</p>
					<p class="text-xs" style="color: var(--text-secondary, #949ba4)">Abre un DM con un amigo o crea un grupo</p>
				</div>
			{:else}
				<ul class="list">
					{#each $conversations as conv (conv.id)}
						<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
						<li class="list-item" role="button" tabindex="0"
							onclick={() => { activeConversation = conv; }}
							onkeydown={(e) => e.key === 'Enter' && (activeConversation = conv)}
							style="cursor:pointer"
						>
							<UserAvatar
								src={convAvatarSrc(conv)}
								name={convTitle(conv)}
								size={36}
							/>
							<div class="info">
								<span class="label">{convTitle(conv)}</span>
								<span class="sublabel">{convSubtitle(conv)}</span>
							</div>
						</li>
					{/each}
				</ul>
			{/if}

		{:else if activeTab === "friends"}
			{#if $friends.length === 0}
				<div class="empty-state">
					<Users size={40} />
					<p>No tienes amigos todavía</p>
				</div>
			{:else}
				<ul class="list">
					{#each $friends as friend (friend.id)}
						{@const friendId = getFriendUserId(friend)}
						{@const user = friendUsers.get(friendId)}
						<li class="list-item">
							<UserAvatar
								src={user?.avatar}
								name={user?.alias ?? user?.username ?? friendId}
								size={36}
							/>
							<div class="info">
								<span class="label">{user?.alias ?? user?.username ?? friendId}</span>
								<span class="sublabel">@{user?.username ?? friendId}</span>
							</div>
							<div class="actions">
								<button
									class="action-btn"
									title="Mensaje directo"
									onclick={() => handleOpenDM(friend)}
								>
									<MessageSquare size={14} />
								</button>
								<button
									class="action-btn danger"
									title="Eliminar amigo"
									onclick={() => handleUnfriend(friend)}
								>
									<UserX size={14} />
								</button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}

		{:else if activeTab === "pending"}
			{#if $pendingFriendRequests.length === 0}
				<div class="empty-state">
					<Clock size={40} />
					<p>No hay solicitudes pendientes</p>
				</div>
			{:else}
				<ul class="list">
					{#each $pendingFriendRequests as req (req.id)}
						{@const user = pendingUsers.get(req.sender_id)}
						<li class="list-item">
							<UserAvatar
								src={user?.avatar}
								name={user?.alias ?? user?.username ?? req.sender_id}
								size={36}
							/>
							<div class="info">
								<span class="label">{user?.alias ?? user?.username ?? req.sender_id}</span>
								<span class="sublabel">@{user?.username ?? req.sender_id} · {new Date(req.created_at).toLocaleDateString()}</span>
							</div>
							<div class="actions">
								<button
									class="action-btn success"
									title="Aceptar"
									onclick={() => handleAccept(req)}
								>
									<UserCheck size={14} />
								</button>
								<button
									class="action-btn danger"
									title="Rechazar"
									onclick={() => handleReject(req)}
								>
									<UserX size={14} />
								</button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}

		{:else if activeTab === "sent"}
			{#if $sentFriendRequests.length === 0}
				<div class="empty-state">
					<Send size={40} />
					<p>No has enviado solicitudes</p>
				</div>
			{:else}
				<ul class="list">
					{#each $sentFriendRequests as req (req.id)}
						{@const user = sentRequestUsers.get(req.recipient_id)}
						<li class="list-item">
							<UserAvatar
								src={user?.avatar}
								name={user?.alias ?? user?.username ?? req.recipient_id}
								size={36}
							/>
							<div class="info">
								<span class="label">{user?.alias ?? user?.username ?? req.recipient_id}</span>
								<span class="sublabel">@{user?.username ?? req.recipient_id} · {new Date(req.created_at).toLocaleDateString()}</span>
							</div>
							<div class="actions">
								<button
									class="action-btn danger"
									title="Cancelar solicitud"
									onclick={() => handleCancelSent(req)}
								>
									<UserX size={14} />
								</button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}

		{:else if activeTab === "add"}
			<div class="add-friend">
				<p class="add-desc">Envía una solicitud de amistad usando el ID de usuario.</p>
				<div class="add-form">
					<input
						class="add-input"
						type="text"
						placeholder="ID de usuario"
						bind:value={addUserId}
						onkeydown={(e) => e.key === "Enter" && handleSendRequest()}
					/>
					<button class="send-btn" onclick={handleSendRequest} disabled={loading}>
						{#if loading}
							Enviando…
						{:else}
							<UserPlus size={14} />
							Enviar solicitud
						{/if}
					</button>
				</div>
				{#if addError}
					<p class="feedback error">{addError}</p>
				{/if}
				{#if addSuccess}
					<p class="feedback success">{addSuccess}</p>
				{/if}
			</div>
		{/if}
	</div>
	{/if}
</div>

{#if showGroupModal}
<div class="modal-overlay" onclick={closeGroupModal} role="button" tabindex="-1" onkeydown={() => {}}>
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" onkeydown={() => {}}>
		<h3>Crear grupo privado</h3>
		<div class="modal-field">
			<label for="group-name">Nombre del grupo</label>
			<input id="group-name" class="add-input" type="text" placeholder="Ej: Los mejores" bind:value={groupName} />
		</div>
		<div class="modal-field">
			<!-- svelte-ignore a11y_label_has_associated_control -->
			<label>
				Agregar amigos
				{#if selectedFriendIds.size > 0}
					<span class="picker-count">{selectedFriendIds.size} seleccionado{selectedFriendIds.size > 1 ? "s" : ""}</span>
				{/if}
			</label>
			<div class="friend-picker">
				{#if $friends.length === 0}
					<p class="picker-empty">No tienes amigos agregados</p>
				{:else}
					{#each $friends as f}
						{@const uid = getFriendUserId(f)}
						{@const user = friendUsers.get(uid)}
						{@const selected = selectedFriendIds.has(uid)}
						<button
							type="button"
							class="picker-item {selected ? 'selected' : ''}"
							onclick={() => toggleFriend(uid)}
						>
							<UserAvatar src={user?.avatar ?? null} name={user?.alias ?? user?.username ?? "?"} size={32} />
							<span class="picker-name">{user?.alias ?? user?.username ?? uid}</span>
							{#if selected}
								<Check size={16} class="picker-check" />
							{/if}
						</button>
					{/each}
				{/if}
			</div>
		</div>
		{#if groupError}
			<p class="feedback error">{groupError}</p>
		{/if}
		<div class="modal-actions">
			<button class="send-btn" onclick={handleCreateGroup}>Crear grupo</button>
			<button class="cancel-btn" onclick={closeGroupModal}>Cancelar</button>
		</div>
	</div>
</div>
{/if}

<style>
.friends-view {
	display: flex;
	flex-direction: column;
	height: 100%;
	background: var(--bg-primary, #1e1f22);
	color: var(--text-primary, #dbdee1);
}

.friends-header {
	padding: 16px 20px 0;
	border-bottom: 1px solid var(--border, #3f4147);
}

.friends-header h2 {
	font-size: 16px;
	font-weight: 600;
	margin: 0 0 12px;
}

.tabs {
	display: flex;
	gap: 4px;
}

.tab {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 6px 12px;
	border-radius: 4px 4px 0 0;
	background: none;
	border: none;
	color: var(--text-secondary, #949ba4);
	cursor: pointer;
	font-size: 13px;
	transition: background 0.15s, color 0.15s;
}

.tab:hover {
	background: var(--bg-hover, #35373c);
	color: var(--text-primary, #dbdee1);
}

.tab.active {
	background: var(--bg-secondary, #2b2d31);
	color: var(--text-primary, #dbdee1);
	border-bottom: 2px solid var(--accent, #5865f2);
}

.add-tab.active {
	border-bottom-color: #23a55a;
	color: #23a55a;
}

.badge {
	background: var(--bg-tertiary, #35373c);
	border-radius: 10px;
	padding: 1px 6px;
	font-size: 11px;
	font-weight: 600;
}

.badge.pending {
	background: #da3633;
	color: #fff;
}

.friends-content {
	flex: 1;
	overflow-y: auto;
	padding: 12px 0;
}

.empty-state {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 12px;
	padding: 60px 20px;
	color: var(--text-secondary, #949ba4);
}

.list {
	list-style: none;
	margin: 0;
	padding: 0 8px;
}

.list-item {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 8px 12px;
	border-radius: 6px;
	transition: background 0.1s;
}

.list-item:hover {
	background: var(--bg-hover, #35373c);
}

.avatar-placeholder {
	width: 36px;
	height: 36px;
	border-radius: 50%;
	background: var(--accent, #5865f2);
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 12px;
	font-weight: 700;
	color: #fff;
	flex-shrink: 0;
}

.info {
	flex: 1;
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
}

.label {
	font-size: 13px;
	font-weight: 500;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.sublabel {
	font-size: 11px;
	color: var(--text-secondary, #949ba4);
}

.actions {
	display: flex;
	gap: 6px;
}

.action-btn {
	width: 28px;
	height: 28px;
	border-radius: 50%;
	border: none;
	background: var(--bg-tertiary, #35373c);
	color: var(--text-secondary, #949ba4);
	cursor: pointer;
	display: flex;
	align-items: center;
	justify-content: center;
	transition: background 0.1s, color 0.1s;
}

.action-btn:hover.success {
	background: #23a55a;
	color: #fff;
}

.action-btn:hover.danger {
	background: #da3633;
	color: #fff;
}

.action-btn.success {
	color: #23a55a;
}

.action-btn.danger {
	color: #da3633;
}

.add-friend {
	padding: 20px;
}

.add-desc {
	font-size: 13px;
	color: var(--text-secondary, #949ba4);
	margin: 0 0 16px;
}

.add-form {
	display: flex;
	gap: 8px;
}

.add-input {
	flex: 1;
	padding: 8px 12px;
	background: var(--bg-tertiary, #1e1f22);
	border: 1px solid var(--border, #3f4147);
	border-radius: 4px;
	color: var(--text-primary, #dbdee1);
	font-size: 14px;
	outline: none;
}

.add-input:focus {
	border-color: var(--accent, #5865f2);
}

.send-btn {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 8px 16px;
	background: var(--accent, #5865f2);
	color: #fff;
	border: none;
	border-radius: 4px;
	cursor: pointer;
	font-size: 13px;
	font-weight: 500;
	white-space: nowrap;
}

.send-btn:hover:not(:disabled) {
	background: #4752c4;
}

.send-btn:disabled {
	opacity: 0.6;
	cursor: not-allowed;
}

.feedback {
	margin-top: 10px;
	font-size: 13px;
	padding: 8px 12px;
	border-radius: 4px;
}

.feedback.error {
	background: rgba(218, 54, 51, 0.15);
	color: #da3633;
}

.feedback.success {
	background: rgba(35, 165, 90, 0.15);
	color: #23a55a;
}

.create-group-btn {
	display: flex;
	align-items: center;
	gap: 5px;
	padding: 4px 10px;
	background: #23a55a;
	color: #fff;
	border: none;
	border-radius: 4px;
	cursor: pointer;
	font-size: 12px;
	font-weight: 500;
}

.create-group-btn:hover {
	background: #1a8a4a;
}

.modal-overlay {
	position: fixed;
	inset: 0;
	background: rgba(0, 0, 0, 0.6);
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 100;
}

.modal {
	background: var(--bg-primary, #1e1f22);
	border: 1px solid var(--border, #3f4147);
	border-radius: 8px;
	padding: 24px;
	width: 400px;
	max-width: 90vw;
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.modal h3 {
	margin: 0;
	font-size: 16px;
	font-weight: 600;
}

.modal-field {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.modal-field label {
	font-size: 12px;
	color: var(--text-secondary, #949ba4);
	font-weight: 500;
	text-transform: uppercase;
	letter-spacing: 0.05em;
}

.modal-actions {
	display: flex;
	gap: 8px;
	justify-content: flex-end;
}

.cancel-btn {
	padding: 8px 16px;
	background: var(--bg-tertiary, #35373c);
	color: var(--text-primary, #dbdee1);
	border: none;
	border-radius: 4px;
	cursor: pointer;
	font-size: 13px;
}

.cancel-btn:hover {
	background: #454850;
}

.picker-count {
	margin-left: 6px;
	color: var(--accent, #5865f2);
	font-weight: 600;
	text-transform: none;
	letter-spacing: 0;
}

.friend-picker {
	max-height: 200px;
	overflow-y: auto;
	border: 1px solid var(--border, #3f4147);
	border-radius: 4px;
	background: var(--bg-tertiary, #1e1f22);
}

.picker-item {
	display: flex;
	align-items: center;
	gap: 10px;
	width: 100%;
	padding: 8px 12px;
	background: transparent;
	border: none;
	color: var(--text-primary, #dbdee1);
	cursor: pointer;
	text-align: left;
	transition: background 0.1s;
}

.picker-item:hover {
	background: var(--bg-hover, #35373c);
}

.picker-item.selected {
	background: rgba(88, 101, 242, 0.12);
}

.picker-name {
	flex: 1;
	font-size: 13px;
	font-weight: 500;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

:global(.picker-check) {
	color: var(--accent, #5865f2);
	flex-shrink: 0;
}

.picker-empty {
	padding: 16px;
	text-align: center;
	font-size: 13px;
	color: var(--text-secondary, #949ba4);
	margin: 0;
}
</style>
