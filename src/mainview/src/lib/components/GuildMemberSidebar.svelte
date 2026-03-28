<script lang="ts">
	import { Crown as CrownSimpleIcon } from "@lucide/svelte";
	import type { MemberOnSidebar, Role, GatewaySpace, GatewayMember } from "$lib/types";
	import { currentUser, gatewaySpaces, typingUsers } from "$lib/stores.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { getSpaceMembers, MEMBERS_PAGE_SIZE, type SpaceMemberWithUser } from "$lib/api/spaces";
	import MemberProfilePopover from "$lib/components/MemberProfilePopover.svelte";

	let {
		spaceId = null,
		space = null,
		channelId = null,
		overrideMembers = undefined,
		onRemoveMember = undefined,
		collapsed = false,
	}: {
		spaceId?: string | null;
		space?: GatewaySpace | null;
		channelId?: string | null;
		overrideMembers?: MemberOnSidebar[];
		onRemoveMember?: (userId: string) => void;
		collapsed?: boolean;
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

	// ── Pagination ─────────────────────────────────────────────────────────────
	let cursor: { id: string; pos: number | null } | null = null;
	let hasMore = $state(true);
	let loading = $state(false);
	let listEl: HTMLElement;
	let abortController: AbortController | null = null;
	let prevSpaceId: string | null = null;

	function convertMember(member: GatewayMember, sp: GatewaySpace): MemberOnSidebar | null {
		const u = sp.users.find((u) => u.id === member.user_id);
		if (!u) return null;
		const sid = u.status_id as number;
		const status: MemberOnSidebar["status"] = sid === 1 ? "online" : sid === 2 ? "dnd" : "offline";
		return {
			id: u.id,
			member_id: member.id,
			username: member.alias ?? u.alias ?? u.username,
			raw_username: u.username,
			avatar_url: u.avatar ?? null,
			banner_url: u.banner ?? null,
			status,
			is_bot: false,
			is_owner: u.id === sp.owner_id,
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

	function mergeIntoStore(rows: SpaceMemberWithUser[]) {
		if (!spaceId) return;
		gatewaySpaces.update((spaces) =>
			spaces.map((s) => {
				if (s.id !== spaceId) return s;
				const existingUserIds = new Set(s.users.map((u) => u.id));
				const incomingUserIds = new Set(rows.map((r) => r.user.id));
				// Replace any placeholder members for the same users with real data
				const filteredMembers = s.members.filter((m) => !incomingUserIds.has(m.user_id));
				const newUsers = rows.map((r) => r.user).filter((u) => !existingUserIds.has(u.id));
				const newMembers = rows.map(({ user: _u, max_pos: _p, ...m }) => m);
				return {
					...s,
					users: [...s.users, ...newUsers],
					members: [...filteredMembers, ...newMembers],
				};
			}),
		);
	}

	async function loadMore() {
		if (!spaceId || loading || !hasMore) return;
		loading = true;
		abortController = new AbortController();
		try {
			const page = await getSpaceMembers(spaceId, cursor ?? undefined, abortController.signal);
			mergeIntoStore(page);
			if (page.length < MEMBERS_PAGE_SIZE) {
				hasMore = false;
			} else {
				const last = page[page.length - 1];
				cursor = {
					id: last.id,
					pos: last.max_pos === -1 ? null : last.max_pos,
				};
			}
		} catch (e: unknown) {
			if (e instanceof Error && e.name !== "AbortError") {
				console.error("[members] pagination error:", e);
			}
		} finally {
			loading = false;
		}
	}

	function handleScroll() {
		if (!listEl || loading || !hasMore) return;
		const { scrollTop, scrollHeight, clientHeight } = listEl;
		if (scrollHeight - scrollTop - clientHeight < 150) {
			void loadMore();
		}
	}

	// ── Helpers ────────────────────────────────────────────────────────────────
	function intToHex(n: number | null | undefined): string {
		if (n == null) return "";
		return "#" + (n >>> 0).toString(16).padStart(6, "0");
	}

	function getMemberColorStyle(member: MemberOnSidebar): string {
		const highest = [...member.roles]
			.filter((r) => r.color_from != null)
			.sort((a, b) => b.position - a.position)
			.at(0);
		if (!highest) return "color: var(--color-zinc-100)";
		const from = intToHex(highest.color_from);
		if (highest.color_to == null) return `color: ${from}`;
		const to = intToHex(highest.color_to);
		const via = highest.color_via != null ? `, ${intToHex(highest.color_via)}` : "";
		return `background: linear-gradient(90deg, ${from}${via}, ${to}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;`;
	}

	function groupMembers(members: MemberOnSidebar[]) {
		const hoistedRoles = new Map<string, Role & { members: MemberOnSidebar[] }>();

		const allHoisted = members
			.flatMap((m) => m.roles)
			.filter((r) => r.hoisted)
			.sort((a, b) => b.position - a.position);

		for (const role of allHoisted) {
			if (!hoistedRoles.has(role.id)) {
				hoistedRoles.set(role.id, { ...role, members: [] });
			}
		}

		for (const member of members) {
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
			unassigned: members.filter((m) => !m.roles.some((r) => r.hoisted)),
		};
	}

	// ── Profile popup ──────────────────────────────────────────────────────────
	let activePopoverMemberId = $state<string | null>(null);

	const pagedMembers = $derived(
		overrideMembers !== undefined
			? overrideMembers
			: space
				? space.members.map((m) => convertMember(m, space!)).filter((m): m is MemberOnSidebar => m !== null)
				: [],
	);

	const groupedMembers = $derived(groupMembers(pagedMembers));

	// Reset and reload when the active space changes

	$effect(() => {
		if (overrideMembers !== undefined) return;
		if (spaceId === prevSpaceId) return;
		prevSpaceId = spaceId;
		abortController?.abort();
		cursor = null;
		hasMore = true;
		loading = false;
		if (spaceId) void loadMore();
	});
</script>

<div
	class="flex shrink-0 flex-col overflow-hidden border-l border-zinc-800 bg-zinc-900 transition-[width] duration-200 {collapsed
		? 'w-0 border-l-0'
		: 'w-64'}"
>
	<div class="flex h-10 shrink-0 items-center justify-between border-b border-zinc-800 px-3">
		<p class="text-xs font-bold tracking-wide text-zinc-200 uppercase">Members</p>
		<span class="text-[11px] text-zinc-500">{pagedMembers.filter((x) => x.status !== "offline").length} connected</span>
	</div>
	<div class="flex-1 overflow-y-auto" bind:this={listEl} onscroll={handleScroll}>
		{#each [...groupedMembers.roles.map( (r) => ({ title: r.name, members: r.members }), ), ...(groupedMembers.unassigned.length ? [{ title: "Members", members: groupedMembers.unassigned }] : [])] as group}
			<div>
				<div
					class="sticky top-0 z-10 flex h-10 items-center bg-zinc-900 px-3 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase select-none"
				>
					{group.title}
				</div>

				{#each group.members as member}
					<MemberProfilePopover
						{member}
						{spaceId}
						{space}
						side="left"
						open={activePopoverMemberId === member.id}
						onOpenChange={(o) => {
							activePopoverMemberId = o ? member.id : null;
						}}
						triggerClass="group mb-0.5 flex h-10 w-full items-center px-3 text-zinc-200 hover:bg-zinc-800 hover:text-white {member.status ===
						'offline'
							? 'opacity-60'
							: ''}"
						{onRemoveMember}
					>
						{#snippet children()}
							<div class="flex min-w-0 items-center gap-2.5">
								<div class="relative shrink-0">
									<UserAvatar src={member.avatar_url} name={member.username} size={30} />
									{#if isTyping(member.id)}
										<span
											class="absolute -right-0.5 -bottom-0.5 flex h-3 w-4 items-center justify-center gap-0.5 rounded-full border-2 border-zinc-900 bg-zinc-700"
										>
											<span
												class="block size-0.5 animate-[member-typing-bounce_1.2s_ease-in-out_infinite] rounded-full bg-[oklch(0.75_0.01_80)]"
											></span>
											<span
												class="block size-0.5 animate-[member-typing-bounce_1.2s_ease-in-out_infinite] rounded-full bg-[oklch(0.75_0.01_80)]"
												style="animation-delay:0.2s"
											></span>
											<span
												class="block size-0.5 animate-[member-typing-bounce_1.2s_ease-in-out_infinite] rounded-full bg-[oklch(0.75_0.01_80)]"
												style="animation-delay:0.4s"
											></span>
										</span>
									{:else}
										<span
											class="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-zinc-900
                                            {member.status === 'online'
												? 'bg-stone-300'
												: member.status === 'idle'
													? 'bg-amber-500'
													: member.status === 'dnd'
														? 'bg-red-500'
														: 'bg-zinc-500'}"
										></span>
									{/if}
								</div>

								<div class="min-w-0">
									<span class="inline-flex items-center gap-1 truncate font-medium" style={getMemberColorStyle(member)}>
										<span class="truncate">{member.username}</span>
										{#if member.is_bot}
											<span class="text-xxs text-zinc-400">BOT</span>
										{/if}
										{#if member.is_owner}
											<CrownSimpleIcon class="size-3 text-amber-500" />
										{/if}
									</span>
								</div>
							</div>
						{/snippet}
					</MemberProfilePopover>
				{/each}
			</div>
		{/each}

		{#if loading}
			<div class="flex justify-center py-3">
				<div class="size-4 animate-spin rounded-full border-2 border-zinc-500 border-t-zinc-300"></div>
			</div>
		{/if}
	</div>
</div>

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
