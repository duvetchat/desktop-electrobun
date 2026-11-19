<script lang="ts">
	import { Hash as HashIcon, Volume2 as SpeakerSimpleHighIcon } from "@lucide/svelte";
	import { getAvatarURL } from "$lib/common/common";
	import { isConversationTab, otherMember, tabTitle } from "$lib/pane";
	import { conversations, currentUser, typingNow } from "$lib/stores.svelte";
	import type { Tab } from "$lib/types";
	import GroupMark from "$lib/components/GroupMark.svelte";
	import TypingMark from "$lib/components/TypingMark.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import SpaceIcon from "$lib/components/ui/SpaceIcon.svelte";

	/** A tab's mark: # for a text room, the speaker for a voice one, the other member's avatar for a DM and the group
	 * icon for a group; while someone types there, the dots that say so, in the same place. With `space`, a room's
	 * mark is its Space's icon instead, as the title bar's tabs and a pane's header have it, where the # or the
	 * speaker is written with the room's name. */
	let {
		tab,
		size = 14,
		space = null,
		class: className = "",
	}: {
		tab: Tab;
		size?: number;
		space?: { name: string; icon: string | null } | null;
		class?: string;
	} = $props();

	const conv = $derived(isConversationTab(tab) ? $conversations.find((c) => c.id === tab.channelId) : undefined);
	const other = $derived(conv ? otherMember(conv, $currentUser?.id) : null);
	const typers = $derived($typingNow[tab.channelId]);
</script>

{#if typers}
	<TypingMark users={typers} size={isConversationTab(tab) ? size + 4 : size} class="text-duvet-ink2 {className}" />
{:else if isConversationTab(tab)}
	{#if conv?.type === 2 || !other}
		<GroupMark size={size + 4} class={className} />
	{:else}
		<span class="shrink-0 {className}" aria-hidden="true">
			<UserAvatar
				src={getAvatarURL(other.user_id, other.user?.avatar)}
				name={tabTitle(tab, $conversations, $currentUser?.id)}
				size={size + 4}
			/>
		</span>
	{/if}
{:else if space}
	<span class="shrink-0 {className}" aria-hidden="true">
		<SpaceIcon src={space.icon} name={space.name} size={size + 4} />
	</span>
{:else if tab.channelType === "voice"}
	<SpeakerSimpleHighIcon
		class="text-duvet-alive-text shrink-0 {className}"
		style="width: {size}px; height: {size}px;"
	/>
{:else}
	<HashIcon class="text-duvet-ink2 shrink-0 {className}" style="width: {size}px; height: {size}px;" />
{/if}
