<script lang="ts">
	import { Eye } from "@lucide/svelte";
	import { LinkPreview } from "bits-ui";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
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
				class="text-fixed-white focus-visible:outline-duvet-accent flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-xs font-medium backdrop-blur-md focus-visible:outline-2"
			>
				<Eye class="size-3.5" />
				{viewers.length}
			</button>
		{/snippet}
	</LinkPreview.Trigger>
	<LinkPreview.Portal>
		<LinkPreview.Content
			side="top"
			align="start"
			sideOffset={6}
			class="rounded-card border-duvet-line bg-duvet-bg text-duvet-ink shadow-duvet-float z-50 w-56 overflow-hidden border p-2"
		>
			{#if viewers.length}
				<p class="text-duvet-ink2 px-1 pb-1 text-xs font-semibold">Watching ({viewers.length})</p>
				<ul class="flex max-h-60 flex-col gap-0.5 overflow-y-auto">
					{#each viewers as viewer (viewer.id)}
						<li class="flex items-center gap-2 rounded-md px-1 py-1 text-[13px]">
							<UserAvatar src={viewer.src} name={viewer.name} size={20} />
							<span class="truncate">{viewer.id === meId ? "You" : viewer.name}</span>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-duvet-ink2 px-1 py-0.5 text-xs">No one is watching yet</p>
			{/if}
		</LinkPreview.Content>
	</LinkPreview.Portal>
</LinkPreview.Root>
