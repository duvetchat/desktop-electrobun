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

	/**
	 * One user of a Space as its member list shows them, whether their member row is there or not yet: a voice room's
	 * people come with their user before a page of members brings theirs, and have no member ID until then. Null when
	 * the Space has no such user.
	 */
	export function spaceMember(space: GatewaySpace, userId: string): MemberOnSidebar | null {
		const user = space.users.find((u) => u.id === userId);
		if (!user) return null;
		const member = space.members.find((m) => m.user_id === userId) ?? {
			id: "",
			space_id: space.id,
			user_id: userId,
			alias: null,
			created_at: "",
			updated_at: "",
		};
		return convertMember(member, space, new Map([[user.id, user]]), new Map(space.roles.map((r) => [r.id, r])));
	}
</script>

<script lang="ts">
	import { currentUser, ownTyping, typingNow, userActivities } from "$lib/stores.svelte";
	import { isSpotify, shownActivities } from "$lib/activity";
	import PersonButton from "$lib/components/PersonButton.svelte";
	import MemberMenu from "$lib/components/MemberMenu.svelte";
	import ContextMenu from "$lib/components/ui/ContextMenu.svelte";
	import { OVERLINE } from "$lib/components/ui/recipes";
	import { MEMBER_ROW_TRIGGER } from "$lib/components/people/recipes";
	import { withoutLongPress } from "$lib/default-menu";
	import { personOf } from "$lib/member-menu";
	import { MEMBER_ROW, memberGroups, shownRows } from "$lib/members";

	// The members, in the groups memberGroups (lib/members.ts) makes, each opening their profile, and their menu on a
	// right-click (MemberMenu, #423). The members popover of a pane's bar and the members column beside a chat both show
	// it (MembersPanel); the one around it scrolls it.
	let {
		members,
		spaceId = null,
		space = null,
		channelId = null,
		onRemoveMember = undefined,
		onMention = undefined,
		profileSide = "left",
		surface = "popover",
	}: {
		members: MemberOnSidebar[];
		spaceId?: string | null;
		space?: GatewaySpace | null;
		/** The room or the conversation whose typing the faces show. */
		channelId?: string | null;
		/** Takes a member out of the group, for its owner. */
		onRemoveMember?: (userId: string) => Promise<void>;
		/** Mentions a member in the chat's message box. */
		onMention?: (userId: string) => void;
		/** Where a member's profile opens, beside the list. */
		profileSide?: "left" | "right" | "top" | "bottom";
		/** What the list is drawn on, whose colour its sticky headings, its status rings and its offline names take: the
		 * popover's, or the pane's, as the members column. */
		surface?: "popover" | "pane";
	} = $props();

	// The colour behind the list, as each class and style needs it.
	const ground = $derived(
		surface === "pane"
			? { bg: "bg-duvet-bg", border: "border-duvet-bg", ring: "text-duvet-bg", color: "var(--duvet-bg)" }
			: {
					bg: "bg-duvet-pop-ring",
					border: "border-duvet-pop-ring",
					ring: "text-duvet-pop-ring",
					color: "var(--duvet-pop-ring)",
				},
	);

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

	// An offline member's name is dimmed by mixing its color into the list's background, not with an
	// opacity: text under an opacity loses ClearType and looks thinner than the online names.
	function getMemberColorStyle(member: MemberOnSidebar): string {
		const dim = (color: string) =>
			member.status === "offline" ? `color-mix(in oklab, ${color} 60%, ${ground.color})` : color;
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

	// ── The member menu ────────────────────────────────────────────────────────
	// One for the list, as the message list has one: a right-click on a row opens it for that row's member.
	let menuOpen = $state(false);
	let menuFor = $state.raw<MemberOnSidebar | null>(null);
	function pickMember(e: MouseEvent): boolean {
		const row = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-member-id]") : null;
		const member = row ? members.find((m) => m.id === row.dataset.memberId) : undefined;
		if (!member) return false;
		menuFor = member;
		return true;
	}

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

<ContextMenu bind:open={menuOpen} label="Member">
	{#snippet target(props)}
		<div
			{...withoutLongPress(props)}
			bind:this={root}
			oncontextmenu={(e) => {
				if (pickMember(e)) (props.oncontextmenu as ((e: MouseEvent) => void) | undefined)?.(e);
			}}
		>
			{@render rows()}
		</div>
	{/snippet}
	{#if menuFor}
		{@const member = menuFor}
		<MemberMenu
			person={personOf(member, space)}
			{space}
			onProfile={() => (activePopoverMemberId = member.id)}
			{onMention}
			onRemoveFromGroup={onRemoveMember}
		/>
	{/if}
</ContextMenu>

{#snippet rows()}
	{#each groupedMembers as group, g}
		{@const [start, end] = windows[g] ?? [0, 0]}
		<div>
			<!-- The heading stays at the top while its rows scroll under it, on the list's own colour. -->
			<div class="{OVERLINE} {ground.bg} sticky top-0 z-10 flex h-9 items-end px-4 pb-1.5 select-none">
				{group.title} — {group.members.length}
			</div>

			{#if start > 0}
				<div style="height: {start * MEMBER_ROW}px"></div>
			{/if}
			{#each group.members.slice(start, end) as member (member.id)}
				<div class="flex flex-col gap-2">
					<PersonButton
						{member}
						{spaceId}
						{space}
						side={profileSide}
						open={activePopoverMemberId === member.id}
						onOpenChange={(o) => {
							activePopoverMemberId = o ? member.id : null;
						}}
						triggerClass={MEMBER_ROW_TRIGGER}
						{onRemoveMember}
						banner
						badges
						dimOffline
						typing={isTyping(member.id)}
						recording={isRecording(member.id)}
						statusClass={ground.ring}
						typingBorderClass={ground.border}
						nameStyle={getMemberColorStyle(member)}
					>
						{#snippet subtitle()}
							{#if shownActivities($userActivities[member.id]).length}
								{@const activity = shownActivities($userActivities[member.id])[0]!}
								<p class="text-duvet-ink2 truncate text-[11.5px] leading-4">
									{isSpotify(activity)
										? "Listening to Spotify"
										: `${activity.name}${activity.state ? ` — ${activity.state}` : ""}`}
								</p>
							{/if}
						{/snippet}
					</PersonButton>
				</div>
			{/each}
			{#if end < group.members.length}
				<div style="height: {(group.members.length - end) * MEMBER_ROW}px"></div>
			{/if}
		</div>
	{/each}
{/snippet}
