<script lang="ts">
	import { Tooltip } from "bits-ui";
	import Avatar from "$lib/components/ui/Avatar.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { FOCUS_RING } from "$lib/components/ui/recipes";
	import { formatNumber } from "$lib/i18n/format";
	import { t } from "$lib/i18n";
	import type { MemberOnSidebar } from "$lib/types";

	// The online friends whose faces the Now section shows: a stack that overlaps until the pointer or the keys reach
	// it, then opens its gaps. Each face keeps the dot the Avatar draws for its presence; hovering or focusing it shows
	// the same presence in a cloud above it, portalled out of the section's scroll so it can't be clipped. A "+N" sits
	// after them when more friends are online.
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
		}[];
		more?: number;
		size?: number;
		/** The colour of the gap between two overlapped faces: what the row sits on. */
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

<div class="flex shrink-0 items-center gap-1.5 {className}">
	{#if friends.length > 0}
		<Tooltip.Provider delayDuration={0} disableHoverableContent>
			<div
				class="group/faces flex items-center -space-x-2 transition-all duration-150 focus-within:space-x-1 hover:space-x-1 motion-reduce:transition-none"
			>
				{#each friends as friend (friend.id)}
					<span class="shrink-0 transition-all duration-150 motion-reduce:transition-none">
						<Tooltip.Root>
							<Tooltip.Trigger>
								{#snippet child({ props })}
									<button
										{...props}
										type="button"
										class="flex rounded-full ring-2 ring-[var(--face-ring)] transition-[box-shadow] duration-150 group-focus-within/faces:ring-0 group-hover/faces:ring-0 motion-reduce:transition-none {FOCUS_RING}"
										style="--face-ring: {ring};"
										aria-label={t("shell_now_message_friend", { name: friend.name })}
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
								<Tooltip.Content side="top" sideOffset={12} collisionPadding={8} class="animate-tip-in z-[3000]">
									<!-- The bubble's body and the tail that points it at the face: one silhouette under the drop shadow. -->
									<span
										class="relative block min-w-24 text-center"
										style="filter: drop-shadow(0 0 1px var(--duvet-sb-edge)) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.22));"
									>
										<span class="bg-duvet-card relative block rounded-2xl px-3 py-1.5">
											<span class="block max-w-40 truncate text-[12px] leading-tight font-semibold">{friend.name}</span>
											<span class="text-duvet-ink2 mt-0.5 block text-[11px] leading-tight"
												>{statusLabel(friend.status)}</span
											>
										</span>
										<!-- The tail that makes the cloud a speech bubble, pointing down at the face. -->
										<span class="bg-duvet-card absolute -bottom-1 left-1/2 size-3 -translate-x-1/2 rotate-45"></span>
									</span>
								</Tooltip.Content>
							</Tooltip.Portal>
						</Tooltip.Root>
					</span>
				{/each}
			</div>
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
