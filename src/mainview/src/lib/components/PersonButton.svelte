<script lang="ts">
	import type { Snippet } from "svelte";
	import { Crown as CrownSimpleIcon, Mic as MicIcon } from "@lucide/svelte";
	import MemberBanner from "$lib/components/MemberBanner.svelte";
	import MemberProfilePopover from "$lib/components/MemberProfilePopover.svelte";
	import StatusDot from "$lib/components/StatusDot.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import type { GatewaySpace, MemberOnSidebar } from "$lib/types";

	// A person's row, as the button that opens their profile (#357, S-34 members and S-38 friends): their avatar with
	// their presence (or their typing), their name with a Space's badges, and the line the caller gives under it. The
	// members column and the friends page share it; each says its size, its ground and what the line says.
	let {
		member,
		spaceId = null,
		space = null,
		side = "left",
		open = false,
		onOpenChange = () => {},
		onRemoveMember = undefined,
		triggerClass = "",
		size = "sm",
		banner = false,
		badges = false,
		typing = false,
		recording = false,
		dimOffline = false,
		statusClass = "",
		typingBorderClass = "",
		nameStyle = "",
		subtitle = undefined,
	}: {
		member: MemberOnSidebar;
		spaceId?: string | null;
		space?: GatewaySpace | null;
		side?: "left" | "right" | "top" | "bottom";
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		onRemoveMember?: (userId: string) => void;
		triggerClass?: string;
		/** The row's size: the members column's 30 px avatar (`sm`), or the friends page's 40 px one (`lg`). */
		size?: "sm" | "lg";
		/** The member's banner behind the row. */
		banner?: boolean;
		/** The BOT tag and the owner's crown, as a Space's members column shows them. */
		badges?: boolean;
		/** The member is typing (or recording): the avatar says it in place of their presence. */
		typing?: boolean;
		recording?: boolean;
		/** An offline member's avatar and name dim, as the members column shows them. */
		dimOffline?: boolean;
		/** The presence's colour: the list's ground, which its ring is cut out of. */
		statusClass?: string;
		/** The typing bubble's border colour, the same ground. */
		typingBorderClass?: string;
		/** The name's colour, from the member's highest role. */
		nameStyle?: string;
		/** The line under the name: an activity, a handle. */
		subtitle?: Snippet;
	} = $props();

	const avatarSize = $derived(size === "lg" ? 40 : 30);
	const offline = $derived(member.status === "offline");
</script>

<MemberProfilePopover {member} {spaceId} {space} {side} {open} {onOpenChange} {onRemoveMember} {triggerClass}>
	{#if banner}<MemberBanner src={member.banner_url} {offline} />{/if}

	<div class="relative flex min-w-0 flex-1 items-center gap-4">
		<div class="relative shrink-0 {dimOffline && offline ? 'opacity-60' : ''}">
			<UserAvatar src={member.avatar_url} name={member.username} size={avatarSize} />
			{#if typing}
				<span
					class="{typingBorderClass} bg-duvet-secondary-fill absolute -right-0.5 -bottom-0.5 flex h-3 w-4 items-center justify-center gap-0.5 rounded-full border-2"
				>
					{#if recording}
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
					class="{statusClass} absolute -right-0.5 -bottom-0.5 {size === 'lg'
						? 'w-3.5 border-[3px]'
						: 'w-2.5 border-2'}"
				/>
			{/if}
		</div>

		<div class="flex min-w-0 flex-1 flex-col {size === 'lg' ? 'leading-tight' : 'text-left'}">
			<span
				class="flex items-center gap-1 truncate {size === 'lg'
					? 'text-duvet-ink text-sm font-bold'
					: 'text-[13.5px] leading-5 font-semibold'}"
				style={nameStyle}
			>
				<span class="truncate">{member.username}</span>
				{#if badges && member.is_bot}
					<span
						class="bg-duvet-secondary-fill text-duvet-ink2 rounded-[5px] px-1 text-[9.5px] leading-[14px] font-bold tracking-[0.04em] [-webkit-text-fill-color:currentColor] {offline
							? 'opacity-60'
							: ''}">BOT</span
					>
				{/if}
				{#if badges && member.is_owner}
					<CrownSimpleIcon class="text-duvet-crown size-[13px] shrink-0 {offline ? 'opacity-60' : ''}" />
				{/if}
			</span>
			{#if subtitle}{@render subtitle()}{/if}
		</div>
	</div>
</MemberProfilePopover>
