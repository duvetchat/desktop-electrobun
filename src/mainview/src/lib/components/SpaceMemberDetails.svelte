<script lang="ts">
	import { onMount } from "svelte";
	import { SvelteMap, SvelteSet } from "svelte/reactivity";
	import {
		Ban as BanIcon,
		ChevronLeft as ChevronLeftIcon,
		Crown as CrownIcon,
		UserMinus as UserMinusIcon,
	} from "@lucide/svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import Toggle from "$lib/components/ui/Toggle.svelte";
	import SettingsGroup from "$lib/components/settings/SettingsGroup.svelte";
	import SettingsRow from "$lib/components/settings/SettingsRow.svelte";
	import { roleBackground } from "$lib/components/settings/recipes";
	import { getApiError } from "$lib/api/api";
	import { assignRoleToMember, removeRoleFromMember } from "$lib/api/roles";
	import { getAvatarURL } from "$lib/common/common";
	import type { ManagedMember } from "$lib/members";
	import { banRequest, kickFromSpace, moderationOf } from "$lib/moderation";
	import { canManageRoleAt, hasSpacePermission, Permission } from "$lib/permissions";
	import { toast } from "$lib/stores/toast.svelte";
	import type { GatewayRole, GatewaySpace } from "$lib/types";

	// A member, in the Members section of a Space's settings (#380): who they are and when they joined, their roles as
	// switches, and Kick and Ban for those who may. A role is given or taken as the API's checkRoleHierarchy allows it:
	// with Manage Roles, only a role below the user's own highest one (an Administrator's too), any for the Space's owner
	// (canManageRoleAt).
	let { space, member, onBack }: { space: GatewaySpace; member: ManagedMember; onBack: () => void } = $props();

	const managesRoles = $derived(hasSpacePermission(space, Permission.ManageRoles));
	const ownsSpace = $derived(space.member?.user_id === space.owner_id);
	// The Space's roles but @everyone, which nobody gives or takes, the highest first.
	const roles = $derived(space.roles.filter((r) => r.id !== space.id).sort((a, b) => b.position - a.position));
	const holds = $derived(new Set(member.roles.map((r) => r.id)));
	// The gateway's own row for the user has no member ID, which a role's change goes by, until their page comes.
	const mayChange = (role: GatewayRole) => managesRoles && !!member.memberId && canManageRoleAt(space, role.position);

	// What a switch was turned to, which it shows until the gateway's event brings it to the Space, or the API refuses it.
	const wanted = new SvelteMap<string, boolean>();
	const changing = new SvelteSet<string>();
	$effect(() => {
		for (const [roleId, on] of wanted) if (!changing.has(roleId) && holds.has(roleId) === on) wanted.delete(roleId);
	});

	async function setRole(role: GatewayRole, on: boolean) {
		const memberId = member.memberId;
		if (!memberId || changing.has(role.id)) return;
		wanted.set(role.id, on);
		changing.add(role.id);
		try {
			if (on) await assignRoleToMember(space.id, role.id, memberId);
			else await removeRoleFromMember(space.id, role.id, memberId);
		} catch (err) {
			wanted.delete(role.id);
			const fallback = on
				? `Couldn't give ${member.name} ${role.name}`
				: `Couldn't take ${role.name} from ${member.name}`;
			toast(getApiError(err, fallback), "error");
		} finally {
			changing.delete(role.id);
		}
	}

	const rolesNote = $derived(
		!member.memberId
			? "Their roles can be changed once the Space's members have loaded."
			: managesRoles && !ownsSpace && roles.some((role) => !canManageRoleAt(space, role.position))
				? "Only roles below your highest role can be given or taken."
				: undefined,
	);

	// Kick and Ban, when the API would let the user act on them (a kick goes by their member ID).
	const moderation = $derived(
		moderationOf(space, { id: member.id, member_id: member.memberId ?? "", username: member.name }),
	);

	const joined = $derived(
		member.joinedAt
			? new Date(member.joinedAt).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })
			: null,
	);

	// The keyboard goes where the details start, as they take the list's place.
	let backButton = $state<HTMLButtonElement>();
	onMount(() => backButton?.focus());
</script>

<div class="flex flex-col gap-5">
	<div>
		<button
			bind:this={backButton}
			type="button"
			class="text-duvet-accent-text flex items-center gap-1 text-[13px] font-medium hover:underline"
			onclick={onBack}
		>
			<ChevronLeftIcon size={15} />
			Back to members
		</button>
	</div>

	<div class="flex items-center gap-3 px-1.5">
		<UserAvatar src={getAvatarURL(member.id, member.avatar)} name={member.username} size={48} />
		<div class="min-w-0">
			<p class="flex min-w-0 items-center gap-1.5 text-[15px] font-semibold">
				<span class="truncate">{member.name}</span>
				{#if member.isBot}
					<span
						class="bg-duvet-secondary-fill text-duvet-ink2 rounded-[5px] px-1 text-[9.5px] leading-[14px] font-bold tracking-[0.04em]"
						>BOT</span
					>
				{/if}
				{#if member.isOwner}
					<CrownIcon class="text-duvet-crown size-[14px] shrink-0" />
				{/if}
			</p>
			<p class="text-duvet-ink2 truncate text-xs">@{member.username}</p>
		</div>
	</div>

	<SettingsGroup>
		<SettingsRow label="Joined">
			<span class="text-duvet-ink2 text-[13px]">{joined ?? "Not known yet"}</span>
		</SettingsRow>
		<SettingsRow label="User ID">
			<span class="text-duvet-ink2 font-mono text-xs select-text">{member.id}</span>
		</SettingsRow>
	</SettingsGroup>

	<SettingsGroup title="Roles" note={rolesNote}>
		{#each roles as role (role.id)}
			<div class="flex min-h-[50px] items-center gap-3 px-3.5 py-2">
				<span class="size-2.5 shrink-0 rounded-full" style="background: {roleBackground(role)}" aria-hidden="true"
				></span>
				<span class="min-w-0 flex-1 truncate text-[13.5px] font-medium">{role.name}</span>
				<Toggle
					label={role.name}
					checked={wanted.get(role.id) ?? holds.has(role.id)}
					disabled={!mayChange(role) || changing.has(role.id)}
					onCheckedChange={(on) => void setRole(role, on)}
				/>
			</div>
		{:else}
			<p class="text-duvet-ink2 px-3.5 py-3 text-[13px]">This Space has no roles yet</p>
		{/each}
	</SettingsGroup>

	{#if moderation}
		<div class="flex gap-2">
			{#if moderation.kick}
				<Button
					variant="quiet"
					size="sm"
					class="text-duvet-danger! bg-duvet-danger/10 hover:bg-duvet-danger/20!"
					onclick={() => void kickFromSpace(moderation.target)}
				>
					<UserMinusIcon size={14} />
					Kick
				</Button>
			{/if}
			{#if moderation.ban}
				<Button
					variant="quiet"
					size="sm"
					class="text-duvet-danger! bg-duvet-danger/10 hover:bg-duvet-danger/20!"
					onclick={() => banRequest.set(moderation.target)}
				>
					<BanIcon size={14} />
					Ban
				</Button>
			{/if}
		</div>
	{/if}
</div>
