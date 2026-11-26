<script lang="ts">
	import { tick } from "svelte";
	import { Crown as CrownIcon } from "@lucide/svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import MemberPagesStatus from "$lib/components/MemberPagesStatus.svelte";
	import SpaceMemberDetails from "$lib/components/SpaceMemberDetails.svelte";
	import MemberMenu from "$lib/components/MemberMenu.svelte";
	import ContextMenu from "$lib/components/ui/ContextMenu.svelte";
	import { OVERLINE } from "$lib/components/ui/recipes";
	import { withoutLongPress } from "$lib/default-menu";
	import { personOf } from "$lib/member-menu";
	import { CARD, FIELD_SM, NOTE, SELECT } from "$lib/components/settings/recipes";
	import { getAvatarURL } from "$lib/common/common";
	import { t } from "$lib/i18n";
	import { formatList } from "$lib/i18n/format";
	import {
		findMembers,
		joinedOn,
		LISTED_MEMBERS_MAX,
		MANAGED_MEMBER_ROW,
		managedMembers,
		NO_ROLE,
		shownRows,
		type ManagedMember,
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

	const countLabel = $derived(
		shown.length === members.length
			? t("space_members_count", { count: members.length })
			: t("space_members_count_found", { shown: shown.length, total: members.length }),
	);
	// The pages stopped at their limit with members left: the list says so.
	const capped = $derived(paging && moreMembers(space.id) && space.users.length >= LISTED_MEMBERS_MAX);

	// ── The rows in view ─────────────────────────────────────────────────────
	// As the members list mounts them (shownRows, lib/members.ts): MANAGED_MEMBER_ROW px each under a GROUP_HEADING px
	// heading, the view being the part of the list the settings' page shows as it scrolls.
	let root = $state<HTMLElement>();
	let view = $state({ top: 0, bottom: 1200 });
	const [start, end] = $derived(
		shownRows([shown.length], view.top, view.bottom, undefined, MANAGED_MEMBER_ROW)[0] ?? [0, 0],
	);

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

	// The role names one after another, as the locale lists them: "Mods, Helpers" in English.
	const rolesOf = (roleNames: { name: string }[]) =>
		formatList(
			roleNames.map((r) => r.name),
			{ type: "unit", style: "short" },
		);

	// ── A member's menu (#423) ───────────────────────────────────────────────
	// One for the list, as the members list has one: a right-click on a row opens it for that member. Its Profile is
	// their details here, as the row's click. (No profile card: this section is also a window's of its own, whose page
	// never reaches the gateway's connection, which the card's module does: lib/module-graph.ts.)
	let menuFor = $state.raw<ManagedMember | null>(null);
	function pickMember(e: MouseEvent): boolean {
		const row = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-member]") : null;
		const member = row ? shown.find((m) => m.id === row.dataset.member) : undefined;
		if (!member) return false;
		menuFor = member;
		return true;
	}
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
				placeholder={t("space_members_search_placeholder")}
				aria-label={t("space_members_search")}
				autocomplete="off"
				spellcheck="false"
				class="{FIELD_SM} min-w-48 flex-1"
			/>
			<select bind:value={role} aria-label={t("space_members_role_filter")} class={SELECT}>
				<option value="">{t("space_members_role_all")}</option>
				{#each roles as r (r.id)}
					<option value={r.id}>{r.name}</option>
				{/each}
				<option value={NO_ROLE}>{t("space_members_role_none")}</option>
			</select>
			<select bind:value={sort} aria-label={t("space_members_sort")} class={SELECT}>
				<option value="name">{t("space_members_sort_name")}</option>
				<option value="newest">{t("space_members_sort_newest")}</option>
				<option value="oldest">{t("space_members_sort_oldest")}</option>
			</select>
		</div>

		<ContextMenu label={t("space_members_menu")}>
			{#snippet target(props)}
				<div
					{...withoutLongPress(props)}
					class={CARD}
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
					person={personOf(
						{ id: member.id, member_id: member.memberId ?? "", username: member.name, is_bot: member.isBot },
						space,
					)}
					{space}
					onProfile={() => void pick(member.id)}
				/>
			{/if}
		</ContextMenu>

		{#snippet rows()}
			<div class="{OVERLINE} flex h-9 items-end gap-3 px-3.5 pb-1.5 select-none">
				<span class="min-w-0 flex-1 truncate">{countLabel}</span>
				<span class="shrink-0">{t("space_member_joined")}</span>
			</div>
			{#if start > 0}
				<div style="height: {start * MANAGED_MEMBER_ROW}px"></div>
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
									>{t("space_members_bot")}</span
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
				<div style="height: {(shown.length - end) * MANAGED_MEMBER_ROW}px"></div>
			{/if}
			{#if shown.length === 0}
				<p class="text-duvet-ink2 px-3.5 py-6 text-center text-[13px]">{t("space_members_no_match")}</p>
			{/if}
		{/snippet}

		{#if paging}
			<MemberPagesStatus spaceId={space.id} />
		{/if}
		{#if capped}
			<p class={NOTE}>{t("space_members_capped", { count: LISTED_MEMBERS_MAX })}</p>
		{/if}
	</div>
{/if}
