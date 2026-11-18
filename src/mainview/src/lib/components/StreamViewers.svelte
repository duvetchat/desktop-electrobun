<script lang="ts">
	import { Eye } from "@lucide/svelte";
	import { LinkPreview } from "bits-ui";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { GLASS } from "$lib/components/ui/recipes";
	import type { VoicePerson } from "$lib/voice-place";

	// The eye on a screen share: how many watch it, and who, on hover or focus (desktop#299). A click on it does nothing
	// more, and doesn't reach the tile under it.
	let { viewers, meId }: { viewers: VoicePerson[]; meId?: string } = $props();
</script>

<LinkPreview.Root openDelay={150} closeDelay={150}>
	<LinkPreview.Trigger onclick={(e: MouseEvent) => e.stopPropagation()}>
		{#snippet child({ props })}
			<button
				{...props}
				type="button"
				aria-label={`Watching: ${viewers.length}`}
				class="bg-duvet-media-scrim text-duvet-media-ink flex shrink-0 items-center gap-1 rounded-[10px] px-2.5 py-[5px] text-xs leading-[1.2] font-semibold tabular-nums backdrop-blur-[14px]"
			>
				<Eye size={13} />
				{viewers.length}
			</button>
		{/snippet}
	</LinkPreview.Trigger>
	<LinkPreview.Portal>
		<LinkPreview.Content
			side="bottom"
			align="start"
			sideOffset={6}
			collisionPadding={10}
			class="{GLASS} text-duvet-ink animate-float-in z-[1000] w-56 overflow-hidden rounded-[14px] p-1.5"
		>
			{#if viewers.length}
				<p class="text-duvet-ink2 px-2 pt-1 pb-1.5 text-[11.5px] leading-none font-semibold">
					Watching ({viewers.length})
				</p>
				<ul class="flex max-h-60 flex-col overflow-y-auto">
					{#each viewers as viewer (viewer.id)}
						<li class="flex min-h-8 items-center gap-2.5 rounded-[9px] px-2 text-[13px] font-medium">
							<UserAvatar src={viewer.src} name={viewer.name} size={20} />
							<span class="truncate">{viewer.id === meId ? "You" : viewer.name}</span>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-duvet-ink2 px-2 py-1.5 text-[13px]">No one is watching yet</p>
			{/if}
		</LinkPreview.Content>
	</LinkPreview.Portal>
</LinkPreview.Root>
