<script lang="ts">
	import { SvelteMap, SvelteSet } from "svelte/reactivity";
	import {
		AtSign,
		BadgeCheck,
		Ban,
		Copy,
		MessageCircle,
		Pencil,
		Phone,
		Shield,
		User,
		UserCheck,
		UserMinus,
		UserPlus,
		UserRoundMinus,
		UserX,
	} from "@lucide/svelte";
	import { getApiError } from "$lib/api/api";
	import { assignRoleToMember, removeRoleFromMember } from "$lib/api/roles";
	import { isStaff } from "$lib/badges";
	import { t } from "$lib/i18n";
	import { memberMenuItems, tiesOf, type MenuPerson } from "$lib/member-menu";
	import {
		acceptFriend,
		addFriend,
		changeDisplayName,
		chatWith,
		removeFriend,
		removeFromGroup,
	} from "$lib/member-actions";
	import { banRequest, kickFromSpace } from "$lib/moderation";
	import {
		activeCall,
		conversations,
		currentUser,
		friends,
		pendingFriendRequests,
		sentFriendRequests,
	} from "$lib/stores.svelte";
	import { toast } from "$lib/stores/toast.svelte";
	import type { GatewayRole, GatewaySpace } from "$lib/types";
	import MenuItem from "$lib/components/ui/MenuItem.svelte";
	import MenuSeparator from "$lib/components/ui/MenuSeparator.svelte";
	import MenuSub from "$lib/components/ui/MenuSub.svelte";
	import { userFlagsRequest } from "$lib/components/UserFlagsSheet.svelte";

	// A member's menu (#423): the items of a person in any list of them, inside that list's menu (a ContextMenu on a
	// right-click, or a message menu's author submenu). What it offers is lib/member-menu.ts's call; what the list does
	// itself (a profile beside the row, a mention in its chat's box, Remove from group for a group's owner) comes as
	// callbacks, and without one the item isn't there.
	let {
		person,
		space = null,
		onProfile = undefined,
		onMention = undefined,
		onRemoveFromGroup = undefined,
	}: {
		person: MenuPerson;
		/** The Space the list is of: its roles, Kick and Ban. A conversation's list has none. */
		space?: GatewaySpace | null;
		/** Opens their profile beside them. */
		onProfile?: () => void;
		/** Mentions them in the list's chat's message box. */
		onMention?: (userId: string) => void;
		/** Takes them out of the list's group: for its owner. */
		onRemoveFromGroup?: (userId: string) => Promise<void>;
	} = $props();

	const STRANGER = { friend: false, askedMe: false, askedThem: false, dm: false };

	const items = $derived(
		memberMenuItems({
			me: $currentUser ? { id: $currentUser.id, staff: isStaff($currentUser.flags ?? 0) } : null,
			person,
			space,
			ties: $currentUser
				? tiesOf(person.id, $currentUser.id, {
						friends: $friends,
						received: $pendingFriendRequests,
						sent: $sentFriendRequests,
						conversations: $conversations,
					})
				: STRANGER,
			busy: $activeCall !== null,
			can: { profile: !!onProfile, mention: !!onMention, removeFromGroup: !!onRemoveFromGroup },
		}),
	);

	// Its groups, in order, and whether each has an item: who they are to the user (a profile, a mention, a chat, a
	// call), the friendship, what's theirs in the Space or the user's own (roles, the display name), what removes them,
	// their ID, and staff's editor. A line comes before each group shown after another.
	const groups = $derived([
		items.profile || items.mention || items.message || items.call,
		items.friend !== null,
		items.roles.length > 0 || items.displayName,
		!!items.moderation || items.removeFromGroup,
		true,
		items.staff,
	]);
	const lineBefore = (group: number) => groups[group] && groups.slice(0, group).some(Boolean);

	// What a role's tick was turned to, which it shows until the gateway's event brings it to the Space, or the API
	// refuses it: the menu stays open for the next one.
	const wanted = new SvelteMap<string, boolean>();
	const changing = new SvelteSet<string>();
	$effect(() => {
		for (const [roleId, on] of wanted) {
			if (!changing.has(roleId) && items.roles.find((r) => r.role.id === roleId)?.held === on) wanted.delete(roleId);
		}
	});

	async function setRole(role: GatewayRole, on: boolean) {
		const spaceId = space?.id;
		if (!spaceId || !person.memberId || changing.has(role.id)) return;
		wanted.set(role.id, on);
		changing.add(role.id);
		try {
			if (on) await assignRoleToMember(spaceId, role.id, person.memberId);
			else await removeRoleFromMember(spaceId, role.id, person.memberId);
		} catch (err) {
			wanted.delete(role.id);
			const fallback = on
				? t("people_role_give_failed", { name: person.name, role: role.name })
				: t("people_role_take_failed", { name: person.name, role: role.name });
			toast(getApiError(err, fallback), "error");
		} finally {
			changing.delete(role.id);
		}
	}

	// Once the menu has closed and handed the focus back: what this opens takes it then (a profile's popover).
	const afterClose = (run: () => void) => setTimeout(run, 0);
</script>

{#if items.profile}
	<MenuItem icon={User} onSelect={() => afterClose(() => onProfile?.())}>{t("people_menu_profile")}</MenuItem>
{/if}
{#if items.mention}
	<MenuItem icon={AtSign} onSelect={() => onMention?.(person.id)}>{t("people_menu_mention")}</MenuItem>
{/if}
{#if items.message}
	<MenuItem icon={MessageCircle} onSelect={() => chatWith(person.id)}>{t("people_menu_message")}</MenuItem>
{/if}
{#if items.call}
	<MenuItem icon={Phone} onSelect={() => chatWith(person.id, true)}>{t("people_menu_call")}</MenuItem>
{/if}

{#if lineBefore(1)}<MenuSeparator />{/if}
{#if items.friend === "add"}
	<MenuItem icon={UserPlus} onSelect={() => void addFriend(person.id)}>{t("people_menu_add_friend")}</MenuItem>
{:else if items.friend === "accept"}
	<MenuItem icon={UserCheck} onSelect={() => void acceptFriend(person.id)}>{t("people_menu_accept_friend")}</MenuItem>
{:else if items.friend === "remove"}
	<MenuItem icon={UserX} onSelect={() => void removeFriend(person.id, person.name)}
		>{t("people_menu_remove_friend")}</MenuItem
	>
{/if}

{#if lineBefore(2)}<MenuSeparator />{/if}
{#if items.roles.length > 0}
	<MenuSub label={t("people_menu_roles")} icon={Shield}>
		{#each items.roles as { role, held } (role.id)}
			{@const on = wanted.get(role.id) ?? held}
			<MenuItem checked={on} closeOnSelect={false} onSelect={() => void setRole(role, !on)}>{role.name}</MenuItem>
		{/each}
	</MenuSub>
{/if}
{#if items.displayName}
	<MenuItem icon={Pencil} onSelect={() => void changeDisplayName()}>{t("people_menu_display_name")}</MenuItem>
{/if}

{#if lineBefore(3)}<MenuSeparator />{/if}
{#if items.moderation?.kick}
	{@const { target } = items.moderation}
	<MenuItem icon={UserMinus} danger onSelect={() => void kickFromSpace(target)}
		>{t("people_kick_member", { name: person.name })}</MenuItem
	>
{/if}
{#if items.moderation?.ban}
	{@const { target } = items.moderation}
	<MenuItem icon={Ban} danger onSelect={() => banRequest.set(target)}
		>{t("people_ban_member", { name: person.name })}</MenuItem
	>
{/if}
{#if items.removeFromGroup}
	<MenuItem
		icon={UserRoundMinus}
		danger
		onSelect={() => void removeFromGroup(person.name, () => onRemoveFromGroup?.(person.id) ?? Promise.resolve())}
	>
		{t("people_remove_from_group")}
	</MenuItem>
{/if}

{#if lineBefore(4)}<MenuSeparator />{/if}
<MenuItem icon={Copy} onSelect={() => void navigator.clipboard.writeText(person.id).catch(console.error)}>
	{t("people_menu_copy_id")}
</MenuItem>

{#if lineBefore(5) && person.flags}
	{@const { flags, badges } = person.flags}
	<MenuSeparator />
	<MenuItem icon={BadgeCheck} onSelect={() => userFlagsRequest.set({ id: person.id, flags, badges })}>
		{t("people_menu_edit_flags")}
	</MenuItem>
{/if}
