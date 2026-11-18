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

	function convertMember(
		member: GatewayMember,
		sp: GatewaySpace,
		users: Map<string, GatewaySpace["users"][number]>,
		roles: Map<string, GatewaySpace["roles"][number]>,
	): MemberOnSidebar | null {
		const u = users.get(member.user_id);
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
				.map((rid) => roles.get(rid))
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
	 * and the faces in a pane's bar both list these, so they agree. Each user and role is looked up in a map: a scan per
	 * member was quadratic in the members loaded, at every presence (#327). */
	export function spaceMembers(space: GatewaySpace | null): MemberOnSidebar[] {
		if (!space) return [];
		const users = new Map(space.users.map((u) => [u.id, u]));
		const roles = new Map(space.roles.map((r) => [r.id, r]));
		return space.members
			.map((m) => convertMember(m, space, users, roles))
			.filter((m): m is MemberOnSidebar => m !== null);
	}
</script>

<script lang="ts">
	import { Crown as CrownSimpleIcon, Mic as MicIcon } from "@lucide/svelte";
	import { currentUser, ownTyping, typingNow, userActivities } from "$lib/stores.svelte";
	import { isSpotify, shownActivities } from "$lib/activity";
	import MemberBanner from "$lib/components/MemberBanner.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import StatusDot from "$lib/components/StatusDot.svelte";
	import MemberProfilePopover from "$lib/components/MemberProfilePopover.svelte";
	import { MEMBER_ROW, memberGroups, shownRows } from "$lib/members";

	// The members, in the groups memberGroups (lib/members.ts) makes, each opening their profile. The members popover of a
	// pane's bar and a group's members panel both show it; the one around it scrolls it.
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

	// Who shows as typing or recording in the chat right now: everyone else as its rows and tabs show them (typingNow),
	// until their notice gets old, and the user on their own row, the one place their own typing shows (ownTyping).
	const typers = $derived(channelId ? ($typingNow[channelId] ?? []) : []);
	// Whether the user is recording, while their own typing shows; undefined when it doesn't.
	const ownRecording = $derived(channelId ? $ownTyping[channelId] : undefined);

	function isTyping(userId: string): boolean {
		if (userId === $currentUser?.id) return ownRecording !== undefined;
		return typers.some((u) => u.user_id === userId);
	}

	// Whether the member's typing notice says they are recording a voice message.
	function isRecording(userId: string): boolean {
		if (userId === $currentUser?.id) return ownRecording === true;
		return !!typers.find((u) => u.user_id === userId)?.recording;
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
			member.status === "offline" ? `color-mix(in oklab, ${color} 60%, var(--duvet-pop-ring))` : color;
		const highest = [...member.roles]
			.filter((r) => r.color_from !== null && r.color_from !== undefined)
			.sort((a, b) => b.position - a.position)
			.at(0);
		if (!highest) return `color: ${dim("var(--duvet-ink)")}`;
		const from = dim(intToHex(highest.color_from));
		if (highest.color_to === null || highest.color_to === undefined) return `color: ${from}`;
		const to = dim(intToHex(highest.color_to));
		const via =
			highest.color_via !== null && highest.color_via !== undefined ? `, ${dim(intToHex(highest.color_via))}` : "";
		return `background: linear-gradient(90deg, ${from}${via}, ${to}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;`;
	}

	// ── Profile popup ──────────────────────────────────────────────────────────
	let activePopoverMemberId = $state<string | null>(null);

	// A space's list has its roles; a conversation's (no space) has none.
	const groupedMembers = $derived(memberGroups(members, spaceId !== null));

	// ── The rows in view ───────────────────────────────────────────────────────
	// Only the rows in view are mounted, with some more on each side, between spacers that keep the list's height: a
	// list scrolled through mounted a whole Space's rows, each with its avatar, banner and popover (#327). The view is
	// the part of the list the element around it that scrolls shows; until it's measured, the list's top.
	let root = $state<HTMLElement>();
	let view = $state({ top: 0, bottom: 1200 });
	const windows = $derived(
		shownRows(
			groupedMembers.map((g) => g.members.length),
			view.top,
			view.bottom,
		),
	);

	// The nearest element around the list that scrolls: the members column's, or the members popover's.
	function scrollerOf(el: HTMLElement): HTMLElement | null {
		for (let at = el.parentElement; at; at = at.parentElement) {
			if (/auto|scroll/.test(getComputedStyle(at).overflowY)) return at;
		}
		return null;
	}

	// A profile whose row left the view closes with it, rather than open again as the row comes back.
	$effect(() => {
		const open = activePopoverMemberId;
		if (
			open &&
			!groupedMembers.some((group, g) => group.members.slice(...(windows[g] ?? [0, 0])).some((m) => m.id === open))
		) {
			activePopoverMemberId = null;
		}
	});

	$effect(() => {
		const el = root;
		const scroller = el && scrollerOf(el);
		if (!el || !scroller) return;
		let frame = 0;
		const read = () => {
			frame = 0;
			// How far the list's top is above the scroller's: the list's part in view starts there.
			const top = scroller.getBoundingClientRect().top - el.getBoundingClientRect().top;
			view = { top, bottom: top + scroller.clientHeight };
		};
		// One read a frame, however many scroll events come in it.
		const measure = () => {
			frame ||= requestAnimationFrame(read);
		};
		read();
		scroller.addEventListener("scroll", measure, { passive: true });
		const resized = new ResizeObserver(measure);
		resized.observe(scroller);
		return () => {
			scroller.removeEventListener("scroll", measure);
			resized.disconnect();
			cancelAnimationFrame(frame);
		};
	});
</script>

<div bind:this={root}>
	{#each groupedMembers as group, g}
		{@const [start, end] = windows[g] ?? [0, 0]}
		<div>
			<!-- The heading stays at the top while its rows scroll under it, on the colour a popover has behind it. -->
			<div
				class="text-duvet-ink2 bg-duvet-pop-ring sticky top-0 z-10 flex h-9 items-end px-4 pb-1.5 text-[10.5px] font-semibold tracking-[0.06em] uppercase select-none"
			>
				{group.title} — {group.members.length}
			</div>

			{#if start > 0}
				<div style="height: {start * MEMBER_ROW}px"></div>
			{/if}
			{#each group.members.slice(start, end) as member (member.id)}
				<MemberProfilePopover
					{member}
					{spaceId}
					{space}
					side={profileSide}
					open={activePopoverMemberId === member.id}
					onOpenChange={(o) => {
						activePopoverMemberId = o ? member.id : null;
					}}
					triggerClass="group relative mx-2 flex h-10 w-[calc(100%-1rem)] items-center overflow-hidden rounded-xl px-2 text-duvet-ink hover:bg-duvet-hover data-[state=open]:bg-duvet-hover"
					{onRemoveMember}
				>
					{#snippet children()}
						<MemberBanner src={member.banner_url} offline={member.status === "offline"} />
						<div class="relative flex min-w-0 items-center gap-2.5">
							<div class="relative shrink-0 {member.status === 'offline' ? 'opacity-60' : ''}">
								<UserAvatar src={member.avatar_url} name={member.username} size={30} />
								{#if isTyping(member.id)}
									<span
										class="border-duvet-pop-ring bg-duvet-secondary-fill absolute -right-0.5 -bottom-0.5 flex h-3 w-4 items-center justify-center gap-0.5 rounded-full border-2"
									>
										{#if isRecording(member.id)}
											<MicIcon class="text-duvet-danger size-2 animate-pulse" />
										{:else}
											<span class="bg-duvet-ink2 animate-member-typing-bounce block size-0.5 rounded-full"></span>
											<span
												class="bg-duvet-ink2 animate-member-typing-bounce block size-0.5 rounded-full"
												style="animation-delay:0.2s"
											></span>
											<span
												class="bg-duvet-ink2 animate-member-typing-bounce block size-0.5 rounded-full"
												style="animation-delay:0.4s"
											></span>
										{/if}
									</span>
								{:else}
									<StatusDot
										status={member.status}
										mobileOnly={member.mobile_only}
										class="text-duvet-pop-ring absolute -right-0.5 -bottom-0.5 w-2.5 border-2"
									/>
								{/if}
							</div>

							<div class="min-w-0 text-left">
								<span
									class="flex items-center gap-1 truncate text-[13.5px] leading-5 font-semibold"
									style={getMemberColorStyle(member)}
								>
									<span class="truncate">{member.username}</span>
									{#if member.is_bot}
										<span
											class="bg-duvet-secondary-fill text-duvet-ink2 rounded-[5px] px-1 text-[9.5px] leading-[14px] font-bold tracking-[0.04em] [-webkit-text-fill-color:currentColor] {member.status ===
											'offline'
												? 'opacity-60'
												: ''}">BOT</span
										>
									{/if}
									{#if member.is_owner}
										<CrownSimpleIcon
											class="text-duvet-crown size-[13px] shrink-0 {member.status === 'offline' ? 'opacity-60' : ''}"
										/>
									{/if}
								</span>
								{#if shownActivities($userActivities[member.id]).length}
									{@const activity = shownActivities($userActivities[member.id])[0]!}
									<p class="text-duvet-ink2 truncate text-[11.5px] leading-4">
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
			{#if end < group.members.length}
				<div style="height: {(group.members.length - end) * MEMBER_ROW}px"></div>
			{/if}
		</div>
	{/each}
</div>
