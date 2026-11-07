<script lang="ts">
	import type { Snippet } from "svelte";
	import { UserPlus, UserCheck, Loader2, RotateCcw } from "@lucide/svelte";
	import { Popover } from "bits-ui";
	import type { MemberOnSidebar, GatewaySpace, Role } from "$lib/types";
	import { currentUser, friends, pendingFriendRequests, sentFriendRequests, userActivities } from "$lib/stores.svelte";
	import { BADGES } from "$lib/badges";
	import { assignRoleToMember, removeRoleFromMember } from "$lib/api/roles";
	import { sendFriendRequest, getSentRequests, acceptFriendRequest } from "$lib/api/friends";
	import { rememberFriendStatuses } from "$lib/api/ws/connection";
	import { Permission, ALL_PERMISSIONS, canManageRoleAt, hasSpacePermission } from "$lib/permissions";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import ActivityList from "$lib/components/ActivityList.svelte";
	import ProfileBio from "$lib/components/ProfileBio.svelte";
	import StatusDot from "$lib/components/StatusDot.svelte";

	let {
		member,
		spaceId = null,
		space = null,
		side = "left",
		open = false,
		onOpenChange = () => {},
		triggerClass = "",
		triggerStyle = "",
		onRemoveMember = undefined,
		anchor = null,
		children,
	}: {
		member: MemberOnSidebar;
		spaceId?: string | null;
		space?: GatewaySpace | null;
		side?: "left" | "right" | "top" | "bottom";
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		triggerClass?: string;
		triggerStyle?: string;
		onRemoveMember?: (userId: string) => void;
		/** What it opens beside, for one that opens by other means than a click on its children, and then has none. */
		anchor?: HTMLElement | null;
		children?: Snippet;
	} = $props();

	let showPermissions = $state(false);
	let friendRequestState = $state<Record<string, "idle" | "loading" | "sent" | "error">>({});
	let togglingRoles = $state<Record<string, boolean>>({});

	const assignableRoles = $derived(
		space ? [...space.roles].filter((r) => r.id !== spaceId).sort((a, b) => b.position - a.position) : [],
	);

	function intToHex(n: number | null | undefined): string {
		if (n == null) return "";
		return "#" + (n >>> 0).toString(16).padStart(6, "0");
	}

	function getMemberBannerStyle(m: MemberOnSidebar): string {
		const highest = [...m.roles]
			.filter((r) => r.color_from != null)
			.sort((a, b) => b.position - a.position)
			.at(0);
		if (!highest) return "background-color: var(--color-stone-600)";
		const from = intToHex(highest.color_from);
		if (highest.color_to == null) return `background-color: ${from}`;
		const to = intToHex(highest.color_to);
		const via = highest.color_via != null ? `, ${intToHex(highest.color_via)}` : "";
		return `background: linear-gradient(90deg, ${from}${via}, ${to})`;
	}

	function roleBadgeStyle(role: Role): string {
		if (role.color_from == null) return "background-color: var(--color-zinc-600)";
		const from = intToHex(role.color_from);
		if (role.color_to == null) return `background-color: ${from}`;
		const to = intToHex(role.color_to);
		const via = role.color_via != null ? `, ${intToHex(role.color_via)}` : "";
		return `background: linear-gradient(90deg, ${from}${via}, ${to})`;
	}

	function getMemberPermissions(m: MemberOnSidebar): string[] {
		const set = new Set<string>();
		if (m.is_owner) set.add("Administrator");
		let combined = 0;
		for (const role of m.roles) combined |= role.permissions;
		for (const { flag, name } of ALL_PERMISSIONS) {
			if ((combined & flag) === flag) set.add(name);
		}
		return Array.from(set).sort();
	}

	// As the API checks it: the owner and Administrators pass, ManageRoles or not. Each role then takes being below the
	// user's highest one (canManageRoleAt), which Administrator doesn't pass.
	function currentUserCanManageRoles(): boolean {
		return !!space && hasSpacePermission(space, Permission.ManageRoles);
	}

	function isFriend(userId: string): boolean {
		const me = $currentUser;
		if (!me) return false;
		return $friends.some(
			(f) =>
				(f.sender_id === me.id && f.recipient_id === userId) || (f.sender_id === userId && f.recipient_id === me.id),
		);
	}

	function hasPendingRequest(userId: string): boolean {
		const me = $currentUser;
		if (!me) return false;
		return $pendingFriendRequests.some((r) => r.sender_id === userId && r.recipient_id === me.id);
	}

	async function handleSendFriendRequest(userId: string) {
		friendRequestState[userId] = "loading";
		try {
			await sendFriendRequest(userId);
			friendRequestState[userId] = "sent";
			const sent = await getSentRequests();
			sentFriendRequests.set(sent);
		} catch {
			friendRequestState[userId] = "error";
		}
	}

	// Their request is accepted, as the Friends view does it: the API refuses one sent back while theirs waits.
	async function handleAcceptFriendRequest(userId: string) {
		const me = $currentUser;
		const request = $pendingFriendRequests.find((r) => r.sender_id === userId && r.recipient_id === me?.id);
		if (!request) return;
		friendRequestState[userId] = "loading";
		try {
			const friend = await acceptFriendRequest(request.id);
			pendingFriendRequests.update((reqs) => reqs.filter((r) => r.id !== request.id));
			rememberFriendStatuses([friend]);
			friends.update((list) => (list.some((f) => f.id === friend.id) ? list : [...list, friend]));
			friendRequestState[userId] = "idle";
		} catch {
			friendRequestState[userId] = "error";
		}
	}

	async function toggleMemberRole(m: MemberOnSidebar, roleId: string) {
		if (!spaceId) return;
		const key = `${m.id}-${roleId}`;
		const memberHasRole = m.roles.some((r) => r.id === roleId);
		togglingRoles[key] = true;
		try {
			if (memberHasRole) {
				await removeRoleFromMember(spaceId, roleId, m.member_id);
			} else {
				await assignRoleToMember(spaceId, roleId, m.member_id);
			}
		} catch (err) {
			console.error("Failed to toggle role:", err);
		} finally {
			togglingRoles[key] = false;
		}
	}
</script>

<Popover.Root
	{open}
	onOpenChange={(o) => {
		if (!o) showPermissions = false;
		onOpenChange(o);
	}}
>
	{#if children}
		<Popover.Trigger class={triggerClass} style={triggerStyle}>
			{@render children()}
		</Popover.Trigger>
	{/if}
	<Popover.Portal>
		<!-- Beside an anchor the focus isn't handed back as it closes: a press on a mention's chip focused the text around it,
		     a whole message or search result, and a focus there would scroll it into view, ring it, and have Enter edit it. -->
		<Popover.Content
			customAnchor={anchor}
			onCloseAutoFocus={(e) => {
				if (anchor) e.preventDefault();
			}}
			{side}
			align="start"
			sideOffset={10}
			class="z-301 w-80 rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
		>
			{@const visibleRoles = member.roles.filter((role) => role.id !== spaceId)}
			<!-- The banner, 5:2 as it's cropped (600×240). It grows a little past the card on hover, under the avatar, which comes
			     later; nothing clips it, so its corners are its own, and what's below clips itself. -->
			<div
				class="aspect-[5/2] w-full rounded-t-[11px] transition-transform duration-150 motion-safe:hover:scale-105"
				style={member.banner_url
					? `background-image: url('${member.banner_url}'); background-size: cover; background-position: center;`
					: getMemberBannerStyle(member)}
			></div>

			<div class="relative px-4 pb-4">
				<div class="absolute -top-12 left-4 rounded-full border-[6px] border-zinc-800 bg-zinc-950">
					<UserAvatar src={member.avatar_url} name={member.username} size={80} />
					<!-- Coloured as every status dot (statusDotClass, lib/status.ts): online in the theme's colour -->
					<StatusDot
						status={member.status}
						mobileOnly={member.mobile_only}
						class="absolute right-0 bottom-0 w-6 border-4 text-zinc-800"
					/>
				</div>

				<div class="relative z-10 mt-2 flex h-10 w-full items-center justify-end gap-2">
					{#if $currentUser && member.id !== $currentUser.id}
						{@const reqState = friendRequestState[member.id] ?? "idle"}
						{#if isFriend(member.id)}
							<button
								class="flex cursor-default items-center justify-center rounded-lg bg-green-600/20 px-2.5 py-1.5 text-green-400"
								title="Friends"
								disabled
							>
								<UserCheck class="size-4" />
							</button>
						{:else if hasPendingRequest(member.id)}
							<button
								class="flex items-center justify-center rounded-lg bg-white/10 px-2.5 py-1.5 transition-colors hover:bg-white/20 disabled:opacity-50"
								title="Accept request"
								onclick={() => handleAcceptFriendRequest(member.id)}
								disabled={reqState === "loading" || reqState === "sent"}
							>
								<UserPlus class="size-4" />
							</button>
						{:else if reqState === "sent"}
							<button
								class="flex cursor-default items-center justify-center rounded-lg bg-green-600/20 px-2.5 py-1.5 text-green-400"
								title="Request sent"
								disabled
							>
								<UserCheck class="size-4" />
							</button>
						{:else}
							<button
								class="flex items-center justify-center rounded-lg bg-white/10 px-2.5 py-1.5 transition-colors hover:bg-white/20 disabled:opacity-50"
								title={reqState === "error" ? "Retry" : "Add friend"}
								onclick={() => handleSendFriendRequest(member.id)}
								disabled={reqState === "loading"}
							>
								{#if reqState === "loading"}
									<Loader2 class="size-4 animate-spin" />
								{:else if reqState === "error"}
									<RotateCcw class="size-4" />
								{:else}
									<UserPlus class="size-4" />
								{/if}
							</button>
						{/if}
					{/if}
					<!-- Permissions are a space's (its roles): a DM or a group has none, so there's nothing to view there. -->
					{#if spaceId}
						<button
							class="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20"
							onclick={() => (showPermissions = !showPermissions)}
						>
							{showPermissions ? "Hide" : "View"} Permissions
						</button>
					{/if}
				</div>

				<div class="mt-4 overflow-hidden rounded-lg bg-zinc-950 p-3">
					<h2 class="text-lg leading-tight font-bold text-zinc-100 select-text">
						{member.username}
					</h2>
					<p class="text-sm font-medium text-zinc-400 select-text">
						@{member.raw_username}
					</p>

					{#if BADGES.some((b) => member.badges & b.flag)}
						<div class="mt-2 flex gap-1">
							{#each BADGES.filter((b) => member.badges & b.flag) as badge}
								<img src={badge.icon} alt={badge.name} title={badge.name} class="h-6 w-6 rounded" />
							{/each}
						</div>
					{/if}

					{#if member.bio}
						<div class="my-3 h-px w-full bg-zinc-800"></div>
						<h3 class="mb-1 text-left text-[11px] font-bold tracking-wide text-zinc-400 uppercase">About</h3>
						<ProfileBio bio={member.bio} />
					{/if}

					<ActivityList activities={$userActivities[member.id]} />

					{#if visibleRoles.length > 0}
						<div class="my-3 h-px w-full bg-zinc-800"></div>
						<h3 class="mb-2 text-left text-[11px] font-bold tracking-wide text-zinc-400 uppercase">Roles</h3>
						<div class="flex flex-wrap gap-1">
							{#each visibleRoles as role}
								<div
									class="flex w-min items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 shadow-sm"
								>
									<div class="h-3 w-3 rounded-full" style={roleBadgeStyle(role)}></div>
									<span class="text-xs font-medium text-zinc-300">{role.name}</span>
								</div>
							{/each}
						</div>
					{/if}

					{#if showPermissions}
						<div class="my-3 h-px w-full bg-zinc-800"></div>
						<h3 class="mb-2 text-left text-[11px] font-bold tracking-wide text-zinc-400 uppercase">Permissions</h3>
						{@const memberPermissions = getMemberPermissions(member)}
						{#if memberPermissions.length > 0}
							<div class="flex flex-col gap-1.5">
								{#each memberPermissions as permission}
									<div class="flex items-center text-xs text-zinc-300">
										<span class="mr-2 h-1.5 w-1.5 rounded-full bg-stone-400"></span>
										{permission}
									</div>
								{/each}
							</div>
						{:else}
							<span class="text-xs text-zinc-400 italic">No permissions</span>
						{/if}
					{/if}

					{#if currentUserCanManageRoles() && space && assignableRoles.length > 0}
						<div class="my-3 h-px w-full bg-zinc-800"></div>
						<h3 class="mb-2 text-left text-[11px] font-bold tracking-wide text-zinc-400 uppercase">Assign Roles</h3>
						<div class="max-h-32 space-y-1.5 overflow-y-auto">
							{#each assignableRoles as role}
								{@const memberHasRole = member.roles.some((mr) => mr.id === role.id)}
								{@const toggleKey = `${member.id}-${role.id}`}
								{@const manageable = canManageRoleAt(space, role.position)}
								<button
									class="w-fit rounded-full px-2 py-0.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 {memberHasRole
										? 'bg-fill-600 text-fixed-white hover:bg-fill-500'
										: 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}"
									onclick={() => toggleMemberRole(member, role.id)}
									disabled={togglingRoles[toggleKey] || !manageable}
									title={manageable ? undefined : "Only roles below your highest role can be assigned or removed"}
								>
									<div class="flex items-center gap-1">
										<div class="h-2.5 w-2.5 rounded-full" style={roleBadgeStyle(role)}></div>
										<span class="flex-1 text-left">{role.name}</span>
										{#if memberHasRole}
											<span class="text-xxs">✓</span>
										{/if}
									</div>
								</button>
							{/each}
						</div>
					{/if}
				</div>

				{#if onRemoveMember && $currentUser && member.id !== $currentUser.id}
					<div class="mt-3 border-t border-zinc-800 pt-3">
						<button
							class="w-full rounded-lg px-3 py-1.5 text-left text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10"
							onclick={() => {
								onRemoveMember!(member.id);
								onOpenChange(false);
							}}
						>
							Remove from group
						</button>
					</div>
				{/if}
			</div>
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
