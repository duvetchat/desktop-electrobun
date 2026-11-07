<script lang="ts" module>
	import {
		userStatusToString,
		type GatewayMember,
		type GatewaySpace,
		type MemberOnSidebar,
		type Role,
	} from "$lib/types";
	import { userStatusCache } from "$lib/api/ws/connection";
	import { memberMobileOnly, memberStatus } from "$lib/status";
	import { getAvatarURL } from "$lib/common/common";

	function convertMember(member: GatewayMember, sp: GatewaySpace): MemberOnSidebar | null {
		const u = sp.users.find((usr) => usr.id === member.user_id);
		if (!u) return null;
		const status = userStatusToString(memberStatus(userStatusCache, u, sp.id));
		return {
			id: u.id,
			member_id: member.id,
			username: member.alias ?? u.alias ?? u.username,
			raw_username: u.username,
			avatar_url: getAvatarURL(u.id, u.avatar),
			banner_url: getAvatarURL(u.id, u.banner),
			status,
			mobile_only: memberMobileOnly(userStatusCache, u),
			badges: u.badges ?? 0,
			is_bot: u.is_bot ?? false,
			is_owner: u.id === sp.owner_id,
			bio: u.custom ?? "",
			roles: (sp.member_roles[u.id] ?? [])
				.map((rid) => sp.roles.find((r) => r.id === rid))
				.filter(Boolean)
				.map(
					(r): Role => ({
						id: r!.id,
						name: r!.name,
						color_from: r!.color_from,
						color_via: r!.color_via,
						color_to: r!.color_to,
						permissions: r!.permissions,
						hoisted: r!.hoisted,
						position: r!.position,
					}),
				)
				.sort((a, b) => b.position - a.position),
		};
	}

	/** A space's members as its member list shows them: the ones loaded so far, with their statuses. The members column
	 * and the faces in a pane's bar both list these, so they agree. */
	export function spaceMembers(space: GatewaySpace | null): MemberOnSidebar[] {
		return space
			? space.members.map((m) => convertMember(m, space)).filter((m): m is MemberOnSidebar => m !== null)
			: [];
	}
</script>

<script lang="ts">
	import { Crown as CrownSimpleIcon, Mic as MicIcon } from "@lucide/svelte";
	import { typingUsers, userActivities } from "$lib/stores.svelte";
	import { isSpotify, shownActivities } from "$lib/activity";
	import MemberBanner from "$lib/components/MemberBanner.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import StatusDot from "$lib/components/StatusDot.svelte";
	import MemberProfilePopover from "$lib/components/MemberProfilePopover.svelte";

	// The members, grouped under their highest hoisted role and the rest under Members, each opening their profile. The
	// members column and the members popover of a pane's bar both show it; the one around it scrolls it.
	let {
		members,
		spaceId = null,
		space = null,
		channelId = null,
		onRemoveMember = undefined,
		profileSide = "left",
	}: {
		members: MemberOnSidebar[];
		spaceId?: string | null;
		space?: GatewaySpace | null;
		/** The room or the conversation whose typing the faces show. */
		channelId?: string | null;
		onRemoveMember?: (userId: string) => void;
		/** Where a member's profile opens, beside the list. */
		profileSide?: "left" | "right" | "top" | "bottom";
	} = $props();

	const TYPING_TIMEOUT = 5000;
	let now = $state(Date.now());
	$effect(() => {
		const t = setInterval(() => {
			now = Date.now();
		}, 1000);
		return () => clearInterval(t);
	});

	function isTyping(userId: string): boolean {
		if (!channelId) return false;
		const entry = ($typingUsers[channelId] ?? []).find((u) => u.user_id === userId);
		return !!entry && now - entry.timestamp < TYPING_TIMEOUT;
	}

	// Whether the member's typing notice says they are recording a voice message.
	function isRecording(userId: string): boolean {
		return isTyping(userId) && !!($typingUsers[channelId ?? ""] ?? []).find((u) => u.user_id === userId)?.recording;
	}

	// ── Helpers ────────────────────────────────────────────────────────────────
	function intToHex(n: number | null | undefined): string {
		if (n === null || n === undefined) return "";
		return "#" + (n >>> 0).toString(16).padStart(6, "0");
	}

	// An offline member's name is dimmed by mixing its color into the sidebar's background, not with an
	// opacity: text under an opacity loses ClearType and looks thinner than the online names.
	function getMemberColorStyle(member: MemberOnSidebar): string {
		const dim = (color: string) =>
			member.status === "offline" ? `color-mix(in oklab, ${color} 60%, var(--duvet-bg))` : color;
		const highest = [...member.roles]
			.filter((r) => r.color_from !== null && r.color_from !== undefined)
			.sort((a, b) => b.position - a.position)
			.at(0);
		if (!highest) return `color: ${dim("var(--color-zinc-100)")}`;
		const from = dim(intToHex(highest.color_from));
		if (highest.color_to === null || highest.color_to === undefined) return `color: ${from}`;
		const to = dim(intToHex(highest.color_to));
		const via =
			highest.color_via !== null && highest.color_via !== undefined ? `, ${dim(intToHex(highest.color_via))}` : "";
		return `background: linear-gradient(90deg, ${from}${via}, ${to}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;`;
	}

	function groupMembers(list: MemberOnSidebar[]) {
		const hoistedRoles = new Map<string, Role & { members: MemberOnSidebar[] }>();

		const allHoisted = list
			.flatMap((m) => m.roles)
			.filter((r) => r.hoisted)
			.sort((a, b) => b.position - a.position);

		for (const role of allHoisted) {
			if (!hoistedRoles.has(role.id)) {
				hoistedRoles.set(role.id, { ...role, members: [] });
			}
		}

		for (const member of list) {
			const highest = [...member.roles]
				.filter((r) => r.hoisted)
				.sort((a, b) => b.position - a.position)
				.at(0);

			if (highest) {
				hoistedRoles.get(highest.id)?.members.push(member);
			}
		}

		return {
			roles: [...hoistedRoles.values()].filter((r) => r.members.length),
			unassigned: list.filter((m) => !m.roles.some((r) => r.hoisted)),
		};
	}

	// ── Profile popup ──────────────────────────────────────────────────────────
	let activePopoverMemberId = $state<string | null>(null);

	const groupedMembers = $derived(groupMembers(members));
</script>

{#each [...groupedMembers.roles.map( (r) => ({ title: r.name, members: r.members }), ), ...(groupedMembers.unassigned.length ? [{ title: "Members", members: groupedMembers.unassigned }] : [])] as group}
	<div>
		<div
			class="bg-duvet-bg text-duvet-ink2 sticky top-0 z-10 flex h-9 items-end px-4 pb-1.5 text-[13px] font-bold select-none"
		>
			{group.title} — {group.members.length}
		</div>

		{#each group.members as member}
			<MemberProfilePopover
				{member}
				{spaceId}
				{space}
				side={profileSide}
				open={activePopoverMemberId === member.id}
				onOpenChange={(o) => {
					activePopoverMemberId = o ? member.id : null;
				}}
				triggerClass="group relative mx-2 flex h-10 w-[calc(100%-1rem)] items-center overflow-hidden rounded-row px-2 text-duvet-ink hover:bg-duvet-card focus-visible:outline-2 focus-visible:outline-duvet-accent"
				{onRemoveMember}
			>
				{#snippet children()}
					<MemberBanner src={member.banner_url} offline={member.status === "offline"} />
					<div class="relative flex min-w-0 items-center gap-2.5">
						<div class="relative shrink-0 {member.status === 'offline' ? 'opacity-60' : ''}">
							<UserAvatar src={member.avatar_url} name={member.username} size={30} />
							{#if isTyping(member.id)}
								<span
									class="border-duvet-bg absolute -right-0.5 -bottom-0.5 flex h-3 w-4 items-center justify-center gap-0.5 rounded-full border-2 bg-zinc-700"
								>
									{#if isRecording(member.id)}
										<MicIcon class="size-2 animate-pulse text-red-400" />
									{:else}
										<span
											class="bg-night-75 block size-0.5 animate-[member-typing-bounce_1.2s_ease-in-out_infinite] rounded-full"
										></span>
										<span
											class="bg-night-75 block size-0.5 animate-[member-typing-bounce_1.2s_ease-in-out_infinite] rounded-full"
											style="animation-delay:0.2s"
										></span>
										<span
											class="bg-night-75 block size-0.5 animate-[member-typing-bounce_1.2s_ease-in-out_infinite] rounded-full"
											style="animation-delay:0.4s"
										></span>
									{/if}
								</span>
							{:else}
								<StatusDot
									status={member.status}
									mobileOnly={member.mobile_only}
									class="text-duvet-bg absolute -right-0.5 -bottom-0.5 w-2.5 border-2"
								/>
							{/if}
						</div>

						<div class="min-w-0 text-left">
							<span class="flex items-center gap-1 truncate leading-5 font-medium" style={getMemberColorStyle(member)}>
								<span class="truncate">{member.username}</span>
								{#if member.is_bot}
									<span class="text-xxs text-zinc-400 {member.status === 'offline' ? 'opacity-60' : ''}">BOT</span>
								{/if}
								{#if member.is_owner}
									<CrownSimpleIcon class="size-3 text-amber-500 {member.status === 'offline' ? 'opacity-60' : ''}" />
								{/if}
							</span>
							{#if shownActivities($userActivities[member.id]).length}
								{@const activity = shownActivities($userActivities[member.id])[0]}
								<p class="truncate text-xs text-zinc-500">
									{isSpotify(activity)
										? "Listening to Spotify"
										: `${activity.name}${activity.state ? ` — ${activity.state}` : ""}`}
								</p>
							{/if}
						</div>
					</div>
				{/snippet}
			</MemberProfilePopover>
		{/each}
	</div>
{/each}

<style>
	@keyframes member-typing-bounce {
		0%,
		60%,
		100% {
			transform: translateY(0);
			opacity: 0.5;
		}
		30% {
			transform: translateY(-2px);
			opacity: 1;
		}
	}
</style>
