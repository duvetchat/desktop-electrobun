<script lang="ts">
	import { Tooltip } from "bits-ui";
	import { Gamepad2 as GameIcon, Music as MusicIcon } from "@lucide/svelte";
	import Avatar from "$lib/components/ui/Avatar.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { FOCUS_RING } from "$lib/components/ui/recipes";
	import { formatNumber } from "$lib/i18n/format";
	import { t } from "$lib/i18n";
	import type { MemberOnSidebar } from "$lib/types";

	// The online friends whose faces the Now section shows: a row that wraps onto the next when the column is full,
	// instead of overlapping or taking a full row each. Each face keeps the dot the Avatar draws for its presence;
	// hovering or focusing it shows the name, the presence and what the friend is doing in a cloud above it, portalled
	// out of the section's scroll so it can't be clipped. A "+N" sits after them when more friends are online.
	let {
		friends,
		more = 0,
		size = 26,
		ring = "var(--duvet-sb-ring)",
		class: className = "",
		onFriend,
		onMore,
	}: {
		friends: readonly {
			id: string;
			src: string | null;
			name: string;
			status: MemberOnSidebar["status"];
			mobileOnly?: boolean;
			/** What they're playing or listening to, shown under their presence in the bubble. */
			activity?: { kind: "listening" | "playing"; text: string } | null;
		}[];
		more?: number;
		size?: number;
		/** The colour of the halo around a face: what the row sits on. */
		ring?: string;
		class?: string;
		onFriend: (id: string) => void;
		onMore?: () => void;
	} = $props();

	function statusLabel(status: MemberOnSidebar["status"]): string {
		return status === "dnd"
			? t("people_presence_dnd")
			: status === "offline"
				? t("people_presence_offline")
				: t("people_presence_online");
	}
</script>

<div
	class="group/faces flex min-w-0 flex-wrap items-center -space-x-2 gap-y-1 transition-[margin] duration-150 focus-within:space-x-1 hover:space-x-1 motion-reduce:transition-none {className}"
>
	{#if friends.length > 0}
		<Tooltip.Provider delayDuration={0} disableHoverableContent>
			{#each friends as friend (friend.id)}
				<span class="shrink-0 transition-[margin] duration-150 motion-reduce:transition-none">
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<button
									{...props}
									type="button"
									class="flex rounded-full ring-2 ring-[var(--face-ring)] transition-[box-shadow] duration-150 group-focus-within/faces:ring-0 group-hover/faces:ring-0 motion-reduce:transition-none {FOCUS_RING}"
									style="--face-ring: {ring};"
									aria-label={friend.activity
										? t("shell_now_message_friend_doing", {
												kind: friend.activity.kind,
												name: friend.name,
												activity: friend.activity.text,
											})
										: t("shell_now_message_friend", { name: friend.name })}
									data-jump
									onclick={() => onFriend(friend.id)}
								>
									<Avatar {size} status={friend.status} mobileOnly={friend.mobileOnly} {ring}>
										<UserAvatar src={friend.src} name={friend.name} {size} />
									</Avatar>
								</button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Portal>
							<Tooltip.Content
								side="top"
								sideOffset={10}
								collisionPadding={8}
								class="animate-tip-in bg-duvet-pill text-duvet-ink shadow-duvet-float ring-duvet-line z-[3000] max-w-48 rounded-2xl px-3 py-1.5 text-center ring-1"
							>
								<span class="block max-w-44 truncate text-[12px] leading-tight font-semibold">{friend.name}</span>
								<span class="text-duvet-ink2 mt-0.5 block text-[11px] leading-tight">{statusLabel(friend.status)}</span>
								{#if friend.activity}
									<span
										class="text-duvet-ink2 mt-1 flex max-w-44 items-center justify-center gap-1 text-[11px] leading-tight"
									>
										{#if friend.activity.kind === "playing"}<GameIcon
												class="size-3 shrink-0"
												aria-hidden="true"
											/>{:else}<MusicIcon class="size-3 shrink-0" aria-hidden="true" />{/if}
										<span class="truncate" title={friend.activity.text}>{friend.activity.text}</span>
									</span>
								{/if}
								<Tooltip.Arrow class="text-duvet-pill" width={12} height={6} />
							</Tooltip.Content>
						</Tooltip.Portal>
					</Tooltip.Root>
				</span>
			{/each}
		</Tooltip.Provider>
	{/if}
	{#if more > 0}
		<button
			type="button"
			class="bg-duvet-secondary-fill text-duvet-ink2 hover:text-duvet-ink flex size-[26px] shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold tabular-nums transition-colors duration-[120ms] motion-reduce:transition-none {FOCUS_RING}"
			aria-label={t("shell_now_more_friends", { count: more })}
			title={t("shell_now_more_online", { count: more })}
			data-jump
			onclick={onMore}
		>
			+{formatNumber(more)}
		</button>
	{/if}
</div>
