<script lang="ts">
	import type { Snippet } from "svelte";
	import { UserPlus, UserCheck, Loader2, RotateCcw, UserMinus, Ban, MessageCircle } from "@lucide/svelte";
	import { Popover } from "bits-ui";
	import type { MemberOnSidebar, GatewaySpace, Role } from "$lib/types";
	import {
		conversations,
		currentUser,
		friends,
		pendingFriendRequests,
		sentFriendRequests,
		userActivities,
	} from "$lib/stores.svelte";
	import { BADGES } from "$lib/badges";
	import { assignRoleToMember, removeRoleFromMember } from "$lib/api/roles";
	import { sendFriendRequest, getSentRequests, acceptFriendRequest } from "$lib/api/friends";
	import { rememberFriendStatuses } from "$lib/api/ws/connection";
	import { Permission, ALL_PERMISSIONS, canManageRoleAt, hasSpacePermission } from "$lib/permissions";
	import { banRequest, kickFromSpace, moderationOf } from "$lib/moderation";
	import { chatWith } from "$lib/member-actions";
	import { canChatWith, tiesOf } from "$lib/member-menu";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import ActivityList from "$lib/components/ActivityList.svelte";
	import ProfileBio from "$lib/components/ProfileBio.svelte";
	import StatusDot from "$lib/components/StatusDot.svelte";
	import OverlayLayer from "$lib/components/OverlayLayer.svelte";
	import { GLASS, OVERLINE, buttonClass, menuItemClass } from "$lib/components/ui/recipes";
	import { t } from "$lib/i18n";

	let {
		member,
		spaceId = null,
		space = null,
		side = "left",
		open = false,
		onOpenChange = () => {},
		triggerClass = "",
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

	// Send direct message, where a member's menu offers Message (canChatWith): to someone the user has a direct
	// conversation with or is friends with, as the API starts one between friends only.
	const canMessage = $derived(
		!!$currentUser &&
			canChatWith(
				$currentUser.id,
				{ id: member.id, isBot: member.is_bot },
				tiesOf(member.id, $currentUser.id, {
					friends: $friends,
					received: $pendingFriendRequests,
					sent: $sentFriendRequests,
					conversations: $conversations,
				}),
			),
	);

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

	// The owner holds Administrator, as a role giving it would: the list names it as permissions.ts does. The names sort as
	// words, not code units, so a translated name that starts with an accented capital (French "Épingler…") sits with its
	// letter rather than after Z.
	function getMemberPermissions(m: MemberOnSidebar): string[] {
		const set = new Set<string>();
		let combined: number = m.is_owner ? Permission.Administrator : 0;
		for (const role of m.roles) combined |= role.permissions;
		for (const { flag, name } of ALL_PERMISSIONS) {
			if ((combined & flag) === flag) set.add(name);
		}
		return Array.from(set).sort((a, b) => a.localeCompare(b));
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
	<!-- A trigger says whose row it is, which a list's one right-click menu reads (MemberList, #423). -->
	{#if children}
		<Popover.Trigger class={triggerClass} data-member-id={member.id}>
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
						aria-label={t("people_profile_label", { name: member.username })}
						class="{GLASS} animate-float-in rounded-card text-duvet-ink z-[1001] w-80 origin-(--bits-floating-transform-origin) outline-none"
					>
						{@const visibleRoles = member.roles.filter((role) => role.id !== spaceId)}
						<!-- The banner, 5:2 as it's cropped (600×240). It grows a little past the card on hover; nothing clips it, so its
						     corners are its own, and what's below clips itself. The avatar comes later and covers its lower left, so it
						     fades out while the banner (peer/banner) is hovered. -->
						<div
							class="peer/banner aspect-[5/2] w-full rounded-t-[15px] transition-transform duration-150 motion-safe:hover:scale-105 motion-reduce:transition-none"
							style={member.banner_url
								? `background-image: url('${member.banner_url}'); background-size: cover; background-position: center;`
								: getMemberBannerStyle(member)}
						></div>

						<div class="relative px-4 pb-4">
							<!-- The avatar, with its status dot: it fades out while the banner before this section is hovered, over the
							     banner's 150 ms, and with less motion asked too, as a fade moves nothing. It still takes the pointer: on it,
							     the banner isn't hovered, so it shows. -->
							<div
								class="border-duvet-pop-ring bg-duvet-pop-ring absolute -top-12 left-4 rounded-full border-4 transition-opacity duration-150 in-peer-hover/banner:opacity-0 motion-reduce:transition-none"
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
											class="bg-duvet-alive/15 text-duvet-alive-text rounded-tile grid h-7 w-8 cursor-default place-items-center"
											title={t("people_profile_friends")}
											disabled
										>
											<UserCheck class="size-4" />
										</button>
									{:else if hasPendingRequest(member.id)}
										<button
											class="{buttonClass('secondary', 'sm')} w-8 px-0!"
											title={t("people_profile_accept")}
											onclick={() => handleAcceptFriendRequest(member.id)}
											disabled={reqState === "loading" || reqState === "sent"}
										>
											<UserPlus class="size-4" />
										</button>
									{:else if reqState === "sent"}
										<button
											class="bg-duvet-alive/15 text-duvet-alive-text rounded-tile grid h-7 w-8 cursor-default place-items-center"
											title={t("people_profile_request_sent")}
											disabled
										>
											<UserCheck class="size-4" />
										</button>
									{:else}
										<button
											class="{buttonClass('secondary', 'sm')} w-8 px-0!"
											title={reqState === "error" ? t("people_profile_retry") : t("people_profile_add_friend")}
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
										{showPermissions ? t("people_profile_hide_permissions") : t("people_profile_view_permissions")}
									</button>
								{/if}
							</div>

							<!-- What's under it stays in the window: Kick and Ban, and Send direct message's 46 px when it's there. -->
							<div
								class="bg-duvet-sunk mt-4 {canMessage
									? 'max-h-[max(160px,calc(100vh-376px))]'
									: 'max-h-[max(160px,calc(100vh-330px))]'} overflow-hidden overflow-y-auto rounded-[14px] p-3"
							>
								<h2
									class="text-duvet-ink text-[16px] leading-[1.15] font-medium tracking-[-0.012em] break-words select-text"
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
									<h3 class="{OVERLINE} mb-1.5 text-left">
										{t("people_profile_about")}
									</h3>
									<ProfileBio bio={member.bio} />
								{/if}

								<ActivityList activities={$userActivities[member.id]} />

								{#if visibleRoles.length > 0}
									<div class="bg-duvet-line my-3 h-px w-full"></div>
									<h3 class="{OVERLINE} mb-1.5 text-left">
										{t("people_profile_roles")}
									</h3>
									<div class="flex flex-wrap gap-1">
										{#each visibleRoles as role}
											<div class="bg-duvet-secondary-fill rounded-chip flex h-[22px] w-max items-center gap-1.5 px-2">
												<div class="size-[9px] rounded-full" style={roleBadgeStyle(role)}></div>
												<span class="text-duvet-ink text-[11.5px] font-medium">{role.name}</span>
											</div>
										{/each}
									</div>
								{/if}

								{#if showPermissions}
									<div class="bg-duvet-line my-3 h-px w-full"></div>
									<h3 class="{OVERLINE} mb-1.5 text-left">
										{t("people_profile_permissions")}
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
										<span class="text-duvet-ink2 text-xs italic">{t("people_profile_no_permissions")}</span>
									{/if}
								{/if}

								{#if currentUserCanManageRoles() && space && assignableRoles.length > 0}
									<div class="bg-duvet-line my-3 h-px w-full"></div>
									<h3 class="{OVERLINE} mb-1.5 text-left">
										{t("people_profile_assign_roles")}
									</h3>
									<div class="max-h-32 space-y-1.5 overflow-y-auto">
										{#each assignableRoles as role}
											{@const memberHasRole = member.roles.some((mr) => mr.id === role.id)}
											{@const toggleKey = `${member.id}-${role.id}`}
											{@const manageable = canManageRoleAt(space, role.position)}
											<button
												class="rounded-chip flex h-[22px] w-fit items-center px-2 text-[11.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none {memberHasRole
													? 'bg-duvet-chosen text-duvet-chosen-ink'
													: 'bg-duvet-secondary-fill text-duvet-ink hover:bg-duvet-hover-strong'}"
												onclick={() => toggleMemberRole(member, role.id)}
												disabled={togglingRoles[toggleKey] || !manageable}
												title={manageable ? undefined : t("people_profile_role_locked")}
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

							<!-- Their direct conversation, opened as their menu's Message opens it (the app's page): the one there is, or
							     a new one. -->
							{#if canMessage}
								<button
									class="{buttonClass('primary')} mt-3 w-full"
									onclick={() => {
										onOpenChange(false);
										chatWith(member.id);
									}}
								>
									<MessageCircle class="size-4" />
									{t("people_profile_message")}
								</button>
							{/if}

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
											<span class="truncate">{t("people_kick_member", { name: member.username })}</span>
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
											<span class="truncate">{t("people_ban_member", { name: member.username })}</span>
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
										{t("people_remove_from_group")}
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
