<script lang="ts">
import { onMount } from "svelte";
import { get } from "svelte/store";
import { currentUser, pendingFriendRequests, friends } from "$lib/stores.svelte";
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
import { UserPlus, UserCheck, UserX, Users, Clock, Send } from "@lucide/svelte";
import UserAvatar from "$lib/components/UserAvatar.svelte";

type Tab = "friends" | "pending" | "sent" | "add";
let activeTab = $state<Tab>("friends");

let sentRequests = $state<FriendRequest[]>([]);
let sentRequestUsers = $state<Map<string, UserPublic>>(new Map());
let addUserId = $state("");
let addError = $state("");
let addSuccess = $state("");
let loading = $state(false);

async function loadSentUsers(sent: FriendRequest[]) {
	const entries = await Promise.allSettled(
		sent.map(async (r) => {
			const user = await getUser(r.recipient_id);
			return [r.recipient_id, user] as const;
		}),
	);
	const map = new Map<string, UserPublic>();
	for (const result of entries) {
		if (result.status === "fulfilled") {
			map.set(result.value[0], result.value[1]);
		}
	}
	sentRequestUsers = map;
}

onMount(async () => {
	try {
		const [pending, sent, friendList] = await Promise.all([
			getPendingRequests(),
			getSentRequests(),
			getFriends(),
		]);
		pendingFriendRequests.set(pending);
		sentRequests = sent;
		friends.set(friendList);
		await loadSentUsers(sent);
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
		sentRequests = sent;
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
		sentRequests = sentRequests.filter((r) => r.id !== request.id);
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
</script>

<div class="friends-view">
	<div class="friends-header">
		<h2>Amigos</h2>
		<div class="tabs">
			<button
				class="tab"
				class:active={activeTab === "friends"}
				onclick={() => (activeTab = "friends")}
			>
				<Users size={14} />
				Todos
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
		{#if activeTab === "friends"}
			{#if $friends.length === 0}
				<div class="empty-state">
					<Users size={40} />
					<p>No tienes amigos todavía</p>
				</div>
			{:else}
				<ul class="list">
					{#each $friends as friend (friend.id)}
						<li class="list-item">
							<div class="avatar-placeholder">
								{getFriendUserId(friend).slice(0, 2).toUpperCase()}
							</div>
							<div class="info">
								<span class="label">ID: {getFriendUserId(friend)}</span>
							</div>
							<div class="actions">
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
						<li class="list-item">
							<div class="avatar-placeholder">
								{req.sender_id.slice(0, 2).toUpperCase()}
							</div>
							<div class="info">
								<span class="label">De: {req.sender_id}</span>
								<span class="sublabel">{new Date(req.created_at).toLocaleDateString()}</span>
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
			{#if sentRequests.length === 0}
				<div class="empty-state">
					<Send size={40} />
					<p>No has enviado solicitudes</p>
				</div>
			{:else}
				<ul class="list">
					{#each sentRequests as req (req.id)}
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
</div>

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
</style>
