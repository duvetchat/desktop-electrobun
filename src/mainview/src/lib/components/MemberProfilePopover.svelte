<script lang="ts">
    import type { Snippet } from "svelte";
    import { UserPlus, UserCheck, Loader2, RotateCcw } from "@lucide/svelte";
    import { Popover } from "bits-ui";
    import type { MemberOnSidebar, GatewaySpace, Role } from "$lib/types";
    import { currentUser, friends, pendingFriendRequests } from "$lib/stores.svelte";
    import { assignRoleToMember, removeRoleFromMember } from "$lib/api/roles";
    import { sendFriendRequest } from "$lib/api/friends";
    import { Permission } from "$lib/permissions";
    import UserAvatar from "$lib/components/UserAvatar.svelte";

    let {
        member,
        spaceId = null,
        space = null,
        side = "left",
        open = false,
        onOpenChange = () => {},
        triggerClass = "",
        triggerStyle = "",
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
        children: Snippet;
    } = $props();

    let showPermissions = $state(false);
    let friendRequestState = $state<Record<string, "idle" | "loading" | "sent" | "error">>({});
    let togglingRoles = $state<Record<string, boolean>>({});

    const assignableRoles = $derived(
        space
            ? [...space.roles]
                    .filter((r) => r.id !== spaceId)
                    .sort((a, b) => b.position - a.position)
            : [],
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
        if (m.is_owner) set.add("Administrator");
        let combined = 0;
        for (const role of m.roles) combined |= role.permissions;
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

    function isFriend(userId: string): boolean {
        const me = $currentUser;
        if (!me) return false;
        return $friends.some(
            (f) =>
                (f.sender_id === me.id && f.recipient_id === userId) ||
                (f.sender_id === userId && f.recipient_id === me.id),
        );
    }

    function hasPendingRequest(userId: string): boolean {
        const me = $currentUser;
        if (!me) return false;
        return $pendingFriendRequests.some(
            (r) => r.sender_id === userId && r.recipient_id === me.id,
        );
    }

    async function handleSendFriendRequest(userId: string) {
        friendRequestState[userId] = "loading";
        try {
            await sendFriendRequest(userId);
            friendRequestState[userId] = "sent";
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
    <Popover.Trigger class={triggerClass} style={triggerStyle}>
        {@render children()}
    </Popover.Trigger>
    <Popover.Portal>
        <Popover.Content
            {side}
            align="start"
            sideOffset={10}
            class="z-301 w-80 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        >
            {@const visibleRoles = member.roles.filter((role) => role.id !== spaceId)}
            <div
                class="h-24 w-full"
                style={member.banner_url
                    ? `background-image: url('${member.banner_url}'); background-size: cover; background-position: center;`
                    : getMemberBannerStyle(member)}
            ></div>

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

                <div class="relative z-10 mt-2 flex h-10 w-full items-center justify-end gap-2">
                    {#if $currentUser && member.id !== $currentUser.id}
                        {@const reqState = friendRequestState[member.id] ?? "idle"}
                        {#if isFriend(member.id)}
                            <button
                                class="flex items-center justify-center rounded-lg bg-green-600/20 px-2.5 py-1.5 text-green-400 cursor-default"
                                title="Amigos"
                                disabled
                            >
                                <UserCheck class="size-4" />
                            </button>
                        {:else if hasPendingRequest(member.id)}
                            <button
                                class="flex items-center justify-center rounded-lg bg-white/10 px-2.5 py-1.5 transition-colors hover:bg-white/20 disabled:opacity-50"
                                title="Aceptar solicitud"
                                onclick={() => handleSendFriendRequest(member.id)}
                                disabled={reqState === "loading" || reqState === "sent"}
                            >
                                <UserPlus class="size-4" />
                            </button>
                        {:else if reqState === "sent"}
                            <button
                                class="flex items-center justify-center rounded-lg bg-green-600/20 px-2.5 py-1.5 text-green-400 cursor-default"
                                title="Solicitud enviada"
                                disabled
                            >
                                <UserCheck class="size-4" />
                            </button>
                        {:else}
                            <button
                                class="flex items-center justify-center rounded-lg bg-white/10 px-2.5 py-1.5 transition-colors hover:bg-white/20 disabled:opacity-50"
                                title={reqState === "error" ? "Reintentar" : "Agregar amigo"}
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
                    <button
                        class="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20"
                        onclick={() => (showPermissions = !showPermissions)}
                    >
                        {showPermissions ? "Hide" : "View"} Permissions
                    </button>
                </div>

                <div class="mt-4 rounded-lg bg-zinc-950 p-3">
                    <h2 class="text-lg leading-tight font-bold text-zinc-100">
                        {member.username}
                    </h2>
                    <p class="text-sm font-medium text-zinc-400">
                        @{member.raw_username}
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

                    {#if showPermissions}
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
            </div>
        </Popover.Content>
    </Popover.Portal>
</Popover.Root>
