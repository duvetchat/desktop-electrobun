<script lang="ts">
	import type { Snippet } from "svelte";
	import { UserPlus, UserCheck, Loader2, RotateCcw, UserMinus, Ban } from "@lucide/svelte";
	import { Popover } from "bits-ui";
	import type { MemberOnSidebar, GatewaySpace, Role } from "$lib/types";
	import { currentUser, friends, pendingFriendRequests, sentFriendRequests, userActivities } from "$lib/stores.svelte";
	import { BADGES } from "$lib/badges";
	import { assignRoleToMember, removeRoleFromMember } from "$lib/api/roles";
	import { sendFriendRequest, getSentRequests, acceptFriendRequest } from "$lib/api/friends";
	import { rememberFriendStatuses } from "$lib/api/ws/connection";
	import { Permission, ALL_PERMISSIONS, canManageRoleAt, hasSpacePermission } from "$lib/permissions";
	import { banRequest, kickFromSpace, moderationOf } from "$lib/moderation";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import ActivityList from "$lib/components/ActivityList.svelte";
	import ProfileBio from "$lib/components/ProfileBio.svelte";
	import StatusDot from "$lib/components/StatusDot.svelte";
	import OverlayLayer from "$lib/components/OverlayLayer.svelte";
	import { GLASS, buttonClass, menuItemClass } from "$lib/components/ui/recipes";

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
	// Whether it's open, as its owner says (open) or as its trigger opens and closes it: its portal mounts only then, as
	// bits-ui's Portal mounts what it holds as it's created, open or not, under every author and member row (#319).
	let shown = $derived(open);
	let friendRequestState = $state<Record<string, "idle" | "loading" | "sent" | "error">>({});
	let togglingRoles = $state<Record<string, boolean>>({});

	// Kick and Ban, when the API would let the user act on this member (moderationOf): in a space only.
	const moderation = $derived(spaceId ? moderationOf(space, member) : null);

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
		if (!highest) return "background-color: color-mix(in oklab, var(--duvet-ink2) 50%, var(--duvet-card))";
		const from = intToHex(highest.color_from);
		if (highest.color_to == null) return `background-color: ${from}`;
		const to = intToHex(highest.color_to);
		const via = highest.color_via != null ? `, ${intToHex(highest.color_via)}` : "";
		return `background: linear-gradient(90deg, ${from}${via}, ${to})`;
	}

	function roleBadgeStyle(role: Role): string {
		if (role.color_from == null) return "background-color: var(--duvet-ink2)";
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
		shown = o;
		if (!o) showPermissions = false;
		onOpenChange(o);
	}}
>
	{#if children}
		<Popover.Trigger class={triggerClass} style={triggerStyle}>
			{@render children()}
		</Popover.Trigger>
	{/if}
	{#if shown}
		<Popover.Portal>
			<!-- Beside an anchor the focus isn't handed back as it closes: a press on a mention's chip focused the text around it,
			     a whole message or search result, and a focus there would scroll it into view, ring it, and have Enter edit it. -->
			<!-- In front of what it opened from, the members popover too (lib/overlay-layers.ts). -->
			<OverlayLayer>
				{#snippet children()}
					<Popover.Content
						customAnchor={anchor}
						onCloseAutoFocus={(e) => {
							if (anchor) e.preventDefault();
						}}
						{side}
						align="start"
						sideOffset={10}
						collisionPadding={10}
						role="dialog"
						aria-label="{member.username}'s profile"
						class="{GLASS} animate-float-in rounded-card text-duvet-ink z-[1001] w-80 origin-(--bits-floating-transform-origin) outline-none"
					>
						{@const visibleRoles = member.roles.filter((role) => role.id !== spaceId)}
						<!-- The banner, 5:2 as it's cropped (600×240). It grows a little past the card on hover; nothing clips it, so its
						     corners are its own, and what's below clips itself. The avatar comes later and covers its lower left, so it
						     fades out while the banner (peer/banner) is hovered. -->
						<div
							class="peer/banner aspect-[5/2] w-full rounded-t-[15px] transition-transform duration-150 motion-safe:hover:scale-105"
							style={member.banner_url
								? `background-image: url('${member.banner_url}'); background-size: cover; background-position: center;`
								: getMemberBannerStyle(member)}
						></div>

						<div class="relative px-4 pb-4">
							<!-- The avatar, with its status dot: it fades out while the banner before this section is hovered, over the
							     banner's 150 ms, and with less motion asked too, as a fade moves nothing. It still takes the pointer: on it,
							     the banner isn't hovered, so it shows. -->
							<div
								class="border-duvet-pop-ring bg-duvet-pop-ring absolute -top-12 left-4 rounded-full border-4 transition-opacity duration-150 in-peer-hover/banner:opacity-0"
							>
								<UserAvatar src={member.avatar_url} name={member.username} size={80} />
								<!-- Coloured as every status dot (statusDotClass, lib/status.ts): online in the theme's colour -->
								<StatusDot
									status={member.status}
									mobileOnly={member.mobile_only}
									class="text-duvet-bg absolute right-0 bottom-0 w-6 border-4"
								/>
							</div>

							<div class="relative z-10 mt-2 flex h-10 w-full items-center justify-end gap-2">
								{#if $currentUser && member.id !== $currentUser.id}
									{@const reqState = friendRequestState[member.id] ?? "idle"}
									{#if isFriend(member.id)}
										<button
											class="bg-duvet-alive/15 text-duvet-alive grid h-7 w-8 cursor-default place-items-center rounded-[9px]"
											title="Friends"
											disabled
										>
											<UserCheck class="size-4" />
										</button>
									{:else if hasPendingRequest(member.id)}
										<button
											class="{buttonClass('secondary', 'sm')} w-8 px-0!"
											title="Accept request"
											onclick={() => handleAcceptFriendRequest(member.id)}
											disabled={reqState === "loading" || reqState === "sent"}
										>
											<UserPlus class="size-4" />
										</button>
									{:else if reqState === "sent"}
										<button
											class="bg-duvet-alive/15 text-duvet-alive grid h-7 w-8 cursor-default place-items-center rounded-[9px]"
											title="Request sent"
											disabled
										>
											<UserCheck class="size-4" />
										</button>
									{:else}
										<button
											class="{buttonClass('secondary', 'sm')} w-8 px-0!"
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
									<button class={buttonClass("secondary", "sm")} onclick={() => (showPermissions = !showPermissions)}>
										{showPermissions ? "Hide" : "View"} Permissions
									</button>
								{/if}
							</div>

							<div
								class="bg-duvet-sunk mt-4 max-h-[max(160px,calc(100vh-330px))] overflow-hidden overflow-y-auto rounded-[14px] p-3"
							>
								<h2
									class="font-serif-lg text-duvet-ink text-[21px] leading-[1.15] font-medium tracking-[-0.012em] break-words select-text"
								>
									{member.username}
								</h2>
								<p class="text-duvet-ink2 mt-0.5 text-[12.5px] select-text">
									@{member.raw_username}
								</p>

								{#if BADGES.some((b) => member.badges & b.flag)}
									<div class="mt-2 flex gap-1">
										{#each BADGES.filter((b) => member.badges & b.flag) as badge}
											<img src={badge.icon} alt={badge.name} title={badge.name} class="size-6 rounded-md" />
										{/each}
									</div>
								{/if}

								{#if member.bio}
									<div class="bg-duvet-line my-3 h-px w-full"></div>
									<h3 class="text-duvet-ink2 mb-1.5 text-left text-[10.5px] font-semibold tracking-[0.06em] uppercase">
										About
									</h3>
									<ProfileBio bio={member.bio} />
								{/if}

								<ActivityList activities={$userActivities[member.id]} />

								{#if visibleRoles.length > 0}
									<div class="bg-duvet-line my-3 h-px w-full"></div>
									<h3 class="text-duvet-ink2 mb-1.5 text-left text-[10.5px] font-semibold tracking-[0.06em] uppercase">
										Roles
									</h3>
									<div class="flex flex-wrap gap-1">
										{#each visibleRoles as role}
											<div class="bg-duvet-secondary-fill flex h-[22px] w-max items-center gap-1.5 rounded-[7px] px-2">
												<div class="size-[9px] rounded-full" style={roleBadgeStyle(role)}></div>
												<span class="text-duvet-ink text-[11.5px] font-medium">{role.name}</span>
											</div>
										{/each}
									</div>
								{/if}

								{#if showPermissions}
									<div class="bg-duvet-line my-3 h-px w-full"></div>
									<h3 class="text-duvet-ink2 mb-1.5 text-left text-[10.5px] font-semibold tracking-[0.06em] uppercase">
										Permissions
									</h3>
									{@const memberPermissions = getMemberPermissions(member)}
									{#if memberPermissions.length > 0}
										<div class="flex flex-col gap-1.5">
											{#each memberPermissions as permission}
												<div class="text-duvet-ink flex items-center text-xs">
													<span class="bg-duvet-ink2 mr-2 size-1 rounded-full"></span>
													{permission}
												</div>
											{/each}
										</div>
									{:else}
										<span class="text-duvet-ink2 text-xs italic">No permissions</span>
									{/if}
								{/if}

								{#if currentUserCanManageRoles() && space && assignableRoles.length > 0}
									<div class="bg-duvet-line my-3 h-px w-full"></div>
									<h3 class="text-duvet-ink2 mb-1.5 text-left text-[10.5px] font-semibold tracking-[0.06em] uppercase">
										Assign Roles
									</h3>
									<div class="max-h-32 space-y-1.5 overflow-y-auto">
										{#each assignableRoles as role}
											{@const memberHasRole = member.roles.some((mr) => mr.id === role.id)}
											{@const toggleKey = `${member.id}-${role.id}`}
											{@const manageable = canManageRoleAt(space, role.position)}
											<button
												class="flex h-[22px] w-fit items-center rounded-[7px] px-2 text-[11.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none {memberHasRole
													? 'bg-duvet-chosen text-duvet-chosen-ink'
													: 'bg-duvet-secondary-fill text-duvet-ink hover:bg-duvet-hover-strong'}"
												onclick={() => toggleMemberRole(member, role.id)}
												disabled={togglingRoles[toggleKey] || !manageable}
												title={manageable ? undefined : "Only roles below your highest role can be assigned or removed"}
											>
												<div class="flex items-center gap-1.5">
													<div class="size-[9px] rounded-full" style={roleBadgeStyle(role)}></div>
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

							{#if moderation}
								<div class="border-duvet-line mt-3 flex flex-col gap-0.5 border-t pt-2">
									{#if moderation.kick}
										<button
											class="{menuItemClass(true)} hover:bg-duvet-accent-tint"
											onclick={() => {
												const { target } = moderation;
												onOpenChange(false);
												void kickFromSpace(target);
											}}
										>
											<UserMinus size={16} class="shrink-0" />
											<span class="truncate">Kick {member.username}</span>
										</button>
									{/if}
									{#if moderation.ban}
										<button
											class="{menuItemClass(true)} hover:bg-duvet-accent-tint"
											onclick={() => {
												banRequest.set(moderation.target);
												onOpenChange(false);
											}}
										>
											<Ban size={16} class="shrink-0" />
											<span class="truncate">Ban {member.username}</span>
										</button>
									{/if}
								</div>
							{/if}

							{#if onRemoveMember && $currentUser && member.id !== $currentUser.id}
								<div class="border-duvet-line mt-3 border-t pt-2">
									<button
										class="{menuItemClass(true)} hover:bg-duvet-accent-tint"
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
				{/snippet}
			</OverlayLayer>
		</Popover.Portal>
	{/if}
</Popover.Root>
