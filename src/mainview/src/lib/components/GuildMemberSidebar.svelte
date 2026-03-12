<script lang="ts">
import { Crown as CrownSimpleIcon } from "@lucide/svelte";
import type {
	MemberOnSidebar,
	Role,
	GatewaySpace,
	GatewayMember,
} from "$lib/types";
import { currentUser, gatewaySpaces } from "$lib/stores.svelte";
import { assignRoleToMember, removeRoleFromMember } from "$lib/api/roles";
import { Permission } from "$lib/permissions";
import UserAvatar from "$lib/components/UserAvatar.svelte";
import {
	getSpaceMembers,
	MEMBERS_PAGE_SIZE,
	type SpaceMemberWithUser,
} from "$lib/api/spaces";
import { Popover } from "bits-ui";

let {
	spaceId = null,
	space = null,
}: {
	spaceId?: string | null;
	space?: GatewaySpace | null;
} = $props();

// ── Pagination ─────────────────────────────────────────────────────────────
let cursor: { id: string; pos: number | null } | null = null;
let hasMore = $state(true);
let loading = $state(false);
let listEl: HTMLElement;
let abortController: AbortController | null = null;
let prevSpaceId: string | null = null;

function convertMember(
	member: GatewayMember,
	sp: GatewaySpace,
): MemberOnSidebar | null {
	const u = sp.users.find((u) => u.id === member.user_id);
	if (!u) return null;
	const sid = u.status_id as number;
	const status: MemberOnSidebar["status"] =
		sid === 1 ? "online" : sid === 2 ? "dnd" : "offline";
	return {
		id: u.id,
		member_id: member.id,
		username: member.alias ?? u.alias ?? u.username,
		avatar_url: u.avatar ?? null,
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
			const incomingUserIds = new Set(rows.map((r) => r.users.id));
			// Replace any placeholder members for the same users with real data
			const filteredMembers = s.members.filter(
				(m) => !incomingUserIds.has(m.user_id),
			);
			const newUsers = rows
				.map((r) => r.users)
				.filter((u) => !existingUserIds.has(u.id));
			const newMembers = rows.map(({ users: _u, max_pos: _p, ...m }) => m);
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
		const page = await getSpaceMembers(
			spaceId,
			cursor ?? undefined,
			abortController.signal,
		);
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
	const via =
		highest.color_via != null ? `, ${intToHex(highest.color_via)}` : "";
	return `background: linear-gradient(90deg, ${from}${via}, ${to}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;`;
}

function getMemberBannerStyle(member: MemberOnSidebar): string {
	const highest = [...member.roles]
		.filter((r) => r.color_from != null)
		.sort((a, b) => b.position - a.position)
		.at(0);
	if (!highest) return "background-color: var(--color-stone-600)";
	const from = intToHex(highest.color_from);
	if (highest.color_to == null) return `background-color: ${from}`;
	const to = intToHex(highest.color_to);
	const via =
		highest.color_via != null ? `, ${intToHex(highest.color_via)}` : "";
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
let showMemberPermissions = $state(false);
let togglingRoles = $state<Record<string, boolean>>({});

const pagedMembers = $derived(space
	? space.members
			.map((m) => convertMember(m, space!))
			.filter((m): m is MemberOnSidebar => m !== null)
	: []);

const assignableRoles = $derived(space
	? [...space.roles]
			.filter((r) => r.id !== spaceId)
			.sort((a, b) => b.position - a.position)
	: []);

const groupedMembers = $derived(groupMembers(pagedMembers));

// Reset and reload when the active space changes

$effect(() => {
	if (spaceId === prevSpaceId) {
		return;
	}
	prevSpaceId = spaceId;
	abortController?.abort();
	cursor = null;
	hasMore = true;
	loading = false;
	if (spaceId) void loadMore();
});

function getMemberPermissions(member: MemberOnSidebar): string[] {
	const permissionsMap: Array<[number, string]> = [
		[Permission.Administrator, "Administrator"],
		[Permission.ViewChannels, "View Channels"],
		[Permission.SendMessages, "Send Messages"],
		[Permission.ManageMessages, "Manage Messages"],
		[Permission.ManageChannels, "Manage Channels"],
		[Permission.ChangeNickname, "Change Nickname"],
		[Permission.JoinVoice, "Join Voice"],
		[Permission.SpeakInVoice, "Speak in Voice"],
		[Permission.ManageRoles, "Manage Roles"],
	];

	const set = new Set<string>();
	if (member.is_owner) set.add("Administrator");

	let combined = 0;
	for (const role of member.roles) combined |= role.permissions;
	for (const [flag, name] of permissionsMap) {
		if ((combined & flag) === flag) set.add(name);
	}
	return Array.from(set).sort();
}

function currentUserCanManageRoles(): boolean {
	if (!$currentUser || !space) return false;
	if ($currentUser.id === space.owner_id) return true;
	const userRoleIds = space.member_roles[space.member?.user_id ?? ""] ?? [];
	let combined = 0;
	for (const role of space.roles) {
		if (userRoleIds.includes(role.id)) combined |= role.permissions;
	}
	return (combined & Permission.ManageRoles) === Permission.ManageRoles;
}

async function toggleMemberRole(member: MemberOnSidebar, roleId: string) {
	if (!spaceId) return;
	const key = `${member.id}-${roleId}`;
	const memberHasRole = member.roles.some((r) => r.id === roleId);
	togglingRoles[key] = true;
	try {
		if (memberHasRole) {
			await removeRoleFromMember(spaceId, roleId, member.member_id);
		} else {
			await assignRoleToMember(spaceId, roleId, member.member_id);
		}
	} catch (err) {
		console.error("Failed to toggle role:", err);
	} finally {
		togglingRoles[key] = false;
	}
}
</script>

<div
    class="w-64 bg-zinc-900 flex flex-col border-l border-zinc-800 overflow-hidden shrink-0"
>
    <div class="h-10 px-3 border-b border-zinc-800 flex items-center justify-between shrink-0">
        <p class="text-xs font-bold tracking-wide text-zinc-200 uppercase">Members</p>
        <span class="text-[11px] text-zinc-500">{pagedMembers.filter(x => x.status !== "offline").length} connected</span>
    </div>
    <div
        class="flex-1 overflow-y-auto"
        bind:this={listEl}
        onscroll={handleScroll}
    >
        {#each [...groupedMembers.roles.map((r) => ({ title: r.name, members: r.members })), ...(groupedMembers.unassigned.length ? [{ title: "Members", members: groupedMembers.unassigned }] : [])] as group}
            <div>
                <div
                    class="sticky top-0 z-10 flex h-10 items-center bg-zinc-900 px-3 select-none text-[11px] font-semibold tracking-wide text-zinc-500 uppercase"
                >
                    {group.title}
                </div>

                {#each group.members as member}
                    <Popover.Root
                        open={activePopoverMemberId === member.id}
                        onOpenChange={(open) => {
                            activePopoverMemberId = open ? member.id : null;
                            if (!open) showMemberPermissions = false;
                        }}
                    >
                        <Popover.Trigger
                            class="group mb-0.5 flex h-10 w-full items-center px-3 text-zinc-200 hover:bg-zinc-800 hover:text-white {member.status ===
                            'offline'
                                ? 'opacity-60'
                                : ''}"
                        >
                            <div class="flex min-w-0 items-center gap-2.5">
                                <div class="relative shrink-0">
                                    <UserAvatar
                                        src={member.avatar_url}
                                        name={member.username}
                                        size={30}
                                    />
                                    <span
                                        class="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-zinc-900
                                        {member.status === 'online'
                                            ? 'bg-stone-300'
                                            : member.status === 'idle'
                                              ? 'bg-amber-500'
                                              : member.status === 'dnd'
                                                ? 'bg-red-500'
                                                : 'bg-zinc-500'}"
                                    ></span>
                                </div>

                                <div class="min-w-0">
                                    <span
                                        class="inline-flex items-center gap-1 truncate font-medium"
                                        style={getMemberColorStyle(member)}
                                    >
                                        <span class="truncate">{member.username}</span>
                                        {#if member.is_bot}
                                            <span class="text-xxs text-zinc-400"
                                                >BOT</span
                                            >
                                        {/if}
                                        {#if member.is_owner}
                                            <CrownSimpleIcon
                                                class="size-3 text-amber-500"
                                            />
                                        {/if}
                                    </span>
                                </div>
                            </div>
                        </Popover.Trigger>
                        <Popover.Portal>
                            <Popover.Content
                                side="left"
                                align="start"
                                sideOffset={10}
                                class="z-301 w-80 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
                            >
                                {@const visibleRoles = member.roles.filter((role) => role.id !== spaceId)}
                                <div class="h-24 w-full" style={getMemberBannerStyle(member)}></div>

                                <div class="relative px-4 pb-4">
                                    <div class="absolute -top-12 left-4 rounded-full border-[6px] border-zinc-800 bg-zinc-950">
                                        <UserAvatar src={member.avatar_url} name={member.username} size={80} />
                                        <div
                                            class="absolute bottom-0 right-0 h-6 w-6 rounded-full border-4 border-zinc-800
                                            {member.status === 'online'
                                                ? 'bg-stone-400'
                                                : member.status === 'idle'
                                                  ? 'bg-amber-500'
                                                  : member.status === 'dnd'
                                                    ? 'bg-red-500'
                                                    : 'bg-zinc-500'}"
                                        ></div>
                                    </div>

                                    <div class="mt-2 flex h-10 w-full items-center justify-end gap-2">
                                        <button
                                            class="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20"
                                            onclick={() =>
                                                (showMemberPermissions = !showMemberPermissions)}
                                        >
                                            {showMemberPermissions ? "Hide" : "View"} Permissions
                                        </button>
                                    </div>

                                    <div class="mt-4 rounded-lg bg-zinc-950 p-3">
                                        <h2 class="text-lg leading-tight font-bold text-zinc-100">
                                            {member.username}
                                        </h2>
                                        <p class="text-sm font-medium text-zinc-400">
                                            @{member.username}
                                        </p>

                                        {#if visibleRoles.length > 0}
                                            <h3 class="mb-2 text-left text-[11px] font-bold tracking-wide text-zinc-400 uppercase">
                                                Roles
                                            </h3>
                                            <div class="flex flex-wrap gap-1">
                                                {#each visibleRoles as role}
                                                    <div class="flex w-min items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 shadow-sm">
                                                        <div class="h-3 w-3 rounded-full" style={roleBadgeStyle(role)}></div>
                                                        <span class="text-xs font-medium text-zinc-300">{role.name}</span>
                                                    </div>
                                                {/each}
                                            </div>
                                        {/if}

                                        {#if showMemberPermissions}
                                            <div class="my-3 h-px w-full bg-zinc-800"></div>
                                            <h3 class="mb-2 text-left text-[11px] font-bold tracking-wide text-zinc-400 uppercase">
                                                Permissions
                                            </h3>
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
                                            <h3 class="mb-2 text-left text-[11px] font-bold tracking-wide text-zinc-400 uppercase">
                                                Assign Roles
                                            </h3>
                                            <div class="max-h-32 space-y-1.5 overflow-y-auto">
                                                {#each assignableRoles as role}
                                                    {@const memberHasRole = member.roles.some((mr) => mr.id === role.id)}
                                                    {@const toggleKey = `${member.id}-${role.id}`}
                                                    <button
                                                        class="w-fit rounded-full px-2 py-0.5 text-xs transition-colors disabled:opacity-50 {memberHasRole
                                                            ? 'bg-stone-600 text-white hover:bg-stone-500'
                                                            : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}"
                                                        onclick={() => toggleMemberRole(member, role.id)}
                                                        disabled={togglingRoles[toggleKey]}
                                                    >
                                                        <div class="flex items-center gap-1">
                                                            <div class="h-2.5 w-2.5 rounded-full" style={roleBadgeStyle(role as any)}></div>
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
                                </div>
                            </Popover.Content>
                        </Popover.Portal>
                    </Popover.Root>
                {/each}
            </div>
        {/each}

        {#if loading}
            <div class="flex justify-center py-3">
                <div
                    class="size-4 rounded-full border-2 border-zinc-500 border-t-zinc-300 animate-spin"
                ></div>
            </div>
        {/if}
    </div>
</div>
