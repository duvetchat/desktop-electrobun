<script lang="ts">
	import type { Face } from "$lib/now";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { formatNumber } from "$lib/i18n/format";

	// A few people's faces, overlapping, and how many more there are: a room's members in a pane's bar, who's in a
	// voice room. Each face is ringed in the color it sits on, so it reads apart from the one under it.
	let {
		faces,
		more = 0,
		size = 20,
		ring = "ring-duvet-bg",
		label,
	}: {
		faces: Face[];
		more?: number;
		size?: number;
		/** The ring's color class: the background the stack sits on. */
		ring?: string;
		/** What the stack says to a screen reader; without one, it's left to its control's name. */
		label?: string;
	} = $props();
</script>

<span
	class="flex shrink-0 items-center gap-1.5"
	role={label ? "img" : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : "true"}
>
	{#if faces.length > 0}
		<span class="flex items-center -space-x-1.5">
			{#each faces as face (face.id)}
				<span
					class="rounded-full ring-2 transition-shadow duration-200 motion-reduce:transition-none {face.speaking
						? 'ring-duvet-alive'
						: ring} {face.dim ? 'opacity-60' : ''}"
				>
					<UserAvatar src={face.src} name={face.name} {size} />
				</span>
			{/each}
		</span>
	{/if}
	{#if more > 0}
		<span class="text-duvet-ink2 text-xs font-semibold tabular-nums">+{formatNumber(more)}</span>
	{/if}
</span>
