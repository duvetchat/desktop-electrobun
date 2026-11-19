<script lang="ts">
	import { UsersRound } from "@lucide/svelte";

	// A group's mark, where a group shows in a person's place: its row, its tab, its call (#376). A group has no picture,
	// and a face made from its name, as a person without one gets, would read as someone's. Its name is written beside
	// it wherever it shows, so the mark says nothing to a screen reader.
	let { size = 32, class: className = "" }: { size?: number; class?: string } = $props();
</script>

<span
	class="bg-duvet-chosen text-duvet-chosen-ink flex shrink-0 items-center justify-center rounded-full {className}"
	style="width: {size}px; height: {size}px;"
	aria-hidden="true"
>
	<UsersRound style="width: {size * 0.6}px; height: {size * 0.6}px;" />
</span>
