<script lang="ts">
	import { tick } from "svelte";
	import { Crown as CrownIcon } from "@lucide/svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import MemberPagesStatus from "$lib/components/MemberPagesStatus.svelte";
	import SpaceMemberDetails from "$lib/components/SpaceMemberDetails.svelte";
	import { CARD, FIELD_SM, NOTE, SELECT } from "$lib/components/settings/recipes";
	import { getAvatarURL } from "$lib/common/common";
	import {
		findMembers,
		joinedOn,
		LISTED_MEMBERS_MAX,
		managedMembers,
		MEMBER_ROW,
		NO_ROLE,
		shownRows,
		type MemberSort,
	} from "$lib/members";
	import { loadEveryMember, moreMembers } from "$lib/stores/member-pages.svelte";
	import type { GatewaySpace } from "$lib/types";

	// The Members section of a Space's settings (#380), as the mobile app's Members page: the Space's members, found by
	// name, alias, username or ID, and by role, sorted by name or by when they joined, each opening their details (their
	// roles to give and take, Kick and Ban). The API finds no one by name, so the section loads the Space's pages one
	// after another while it shows, up to LISTED_MEMBERS_MAX of its users, into the app's Space, which the members
	// popover shares and the gateway's events keep current. Only the rows in view are mounted, as in the members list.
	let {
		space,
		paging = true,
	}: {
		space: GatewaySpace;
		/** Whether it loads the Space's pages. A Space settings window doesn't: its Space is the main window's, which
		 *  replaces it, pages and all, at each change. */
		paging?: boolean;
	} = $props();

	let query = $state("");
	let role = $state("");
	let sort = $state<MemberSort>("name");
	let pickedId = $state<string | null>(null);

	const members = $derived(managedMembers(space));
	// The Space's roles but @everyone, the highest first, which the filter offers.
	const roles = $derived(space.roles.filter((r) => r.id !== space.id).sort((a, b) => b.position - a.position));
	const shown = $derived(findMembers(members, { query, role, sort }));
	const picked = $derived(pickedId ? (members.find((m) => m.id === pickedId) ?? null) : null);

	$effect(() => {
		if (paging) void loadEveryMember(space.id, space.users.length, LISTED_MEMBERS_MAX);
	});

	// A role deleted meanwhile filters nothing.
	$effect(() => {
		if (role && role !== NO_ROLE && !roles.some((r) => r.id === role)) role = "";
	});

	const counts = new Intl.NumberFormat();
	const countLabel = $derived(
		shown.length === members.length
			? `${counts.format(members.length)} ${members.length === 1 ? "member" : "members"}`
			: `${counts.format(shown.length)} of ${counts.format(members.length)} members`,
	);
	// The pages stopped at their limit with members left: the list says so.
	const capped = $derived(paging && moreMembers(space.id) && space.users.length >= LISTED_MEMBERS_MAX);

	// ── The rows in view ─────────────────────────────────────────────────────
	// As the members list mounts them (shownRows, lib/members.ts): MEMBER_ROW px each under a GROUP_HEADING px heading,
	// the view being the part of the list the settings' page shows as it scrolls.
	let root = $state<HTMLElement>();
	let view = $state({ top: 0, bottom: 1200 });
	const [start, end] = $derived(shownRows([shown.length], view.top, view.bottom)[0] ?? [0, 0]);

	// The nearest element around the list that scrolls: the settings' page.
	function scrollerOf(el: HTMLElement): HTMLElement | null {
		for (let at = el.parentElement; at; at = at.parentElement) {
			if (/auto|scroll/.test(getComputedStyle(at).overflowY)) return at;
		}
		return null;
	}

	// The part of the list in view: from how far its top is above the scroller's.
	function readView(el: HTMLElement, scroller: HTMLElement) {
		const top = scroller.getBoundingClientRect().top - el.getBoundingClientRect().top;
		view = { top, bottom: top + scroller.clientHeight };
	}

	$effect(() => {
		const el = root;
		const scroller = el && scrollerOf(el);
		if (!el || !scroller) return;
		let frame = 0;
		const read = () => {
			frame = 0;
			readView(el, scroller);
		};
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

	// ── A member's details ───────────────────────────────────────────────────
	// They take the list's place, which keeps where it was scrolled to, and the row they came from has the keyboard
	// back.
	let listTop = 0;

	async function pick(id: string) {
		const scroller = root && scrollerOf(root);
		listTop = scroller?.scrollTop ?? 0;
		pickedId = id;
		await tick();
		if (scroller) scroller.scrollTop = 0;
	}

	async function back() {
		const id = pickedId;
		pickedId = null;
		await tick();
		const el = root;
		const scroller = el && scrollerOf(el);
		if (!el || !scroller) return;
		scroller.scrollTop = listTop;
		// The rows there now, rather than at the next frame's scroll, so the one they came from is there to focus.
		readView(el, scroller);
		await tick();
		el.querySelector<HTMLElement>(`[data-member="${id}"]`)?.focus();
	}

	// One who left, or was kicked or banned, goes back to the list.
	$effect(() => {
		if (pickedId && !picked) void back();
	});

	const rolesOf = (roleNames: { name: string }[]) => roleNames.map((r) => r.name).join(", ");
</script>

{#if picked}
	{#key picked.id}
		<SpaceMemberDetails {space} member={picked} onBack={() => void back()} />
	{/key}
{:else}
	<div class="flex flex-col gap-3">
		<div class="flex flex-wrap items-center gap-2">
			<input
				type="search"
				bind:value={query}
				placeholder="Search by name or ID"
				aria-label="Search members"
				autocomplete="off"
				spellcheck="false"
				class="{FIELD_SM} min-w-48 flex-1"
			/>
			<select bind:value={role} aria-label="Filter by role" class={SELECT}>
				<option value="">All roles</option>
				{#each roles as r (r.id)}
					<option value={r.id}>{r.name}</option>
				{/each}
				<option value={NO_ROLE}>No roles</option>
			</select>
			<select bind:value={sort} aria-label="Sort members" class={SELECT}>
				<option value="name">By name</option>
				<option value="newest">Newest first</option>
				<option value="oldest">Oldest first</option>
			</select>
		</div>

		<div class={CARD} bind:this={root}>
			<div
				class="text-duvet-ink2 flex h-9 items-end gap-3 px-3.5 pb-1.5 text-[10.5px] font-semibold tracking-[0.06em] uppercase select-none"
			>
				<span class="min-w-0 flex-1 truncate">{countLabel}</span>
				<span class="shrink-0">Joined</span>
			</div>
			{#if start > 0}
				<div style="height: {start * MEMBER_ROW}px"></div>
			{/if}
			{#each shown.slice(start, end) as member (member.id)}
				<button
					type="button"
					data-member={member.id}
					class="hover:bg-duvet-hover-soft flex h-10 w-full items-center gap-2.5 px-3.5 text-left transition-colors motion-reduce:transition-none"
					onclick={() => void pick(member.id)}
				>
					<UserAvatar src={getAvatarURL(member.id, member.avatar)} name={member.username} size={28} />
					<span class="min-w-0 flex-1">
						<span class="flex min-w-0 items-center gap-1 text-[13px] leading-[18px] font-medium">
							<span class="truncate">{member.name}</span>
							{#if member.isBot}
								<span
									class="bg-duvet-secondary-fill text-duvet-ink2 rounded-[5px] px-1 text-[9.5px] leading-[14px] font-bold tracking-[0.04em]"
									>BOT</span
								>
							{/if}
							{#if member.isOwner}
								<CrownIcon class="text-duvet-crown size-[13px] shrink-0" />
							{/if}
						</span>
						<span class="text-duvet-ink2 block truncate text-[11.5px] leading-4"
							>@{member.username}{member.roles.length > 0 ? ` · ${rolesOf(member.roles)}` : ""}</span
						>
					</span>
					<span class="text-duvet-ink2 shrink-0 text-[11.5px] tabular-nums">{joinedOn(member.joinedAt) ?? ""}</span>
				</button>
			{/each}
			{#if end < shown.length}
				<div style="height: {(shown.length - end) * MEMBER_ROW}px"></div>
			{/if}
			{#if shown.length === 0}
				<p class="text-duvet-ink2 px-3.5 py-6 text-center text-[13px]">No one matches</p>
			{/if}
		</div>

		{#if paging}
			<MemberPagesStatus spaceId={space.id} />
		{/if}
		{#if capped}
			<p class={NOTE}>The first {counts.format(LISTED_MEMBERS_MAX)} members are listed.</p>
		{/if}
	</div>
{/if}
