<script lang="ts">
	import Button from "$lib/components/ui/Button.svelte";
	import { loadMoreMembers, membersFailed, membersLoading } from "$lib/stores/member-pages.svelte";

	// Under a list of a Space's members, how its pages are doing: a spinner while one is on its way, and one that failed
	// said, with Try again (#388). The spinner went with a failure before, and the list stayed short with nothing to say
	// why. Nothing asks for a failed page again by itself, but a new gateway session.
	let { spaceId }: { spaceId: string | null } = $props();
</script>

{#if membersLoading(spaceId)}
	<div class="flex justify-center py-3" role="status" aria-label="Loading more members">
		<div class="border-duvet-line border-t-duvet-ink2 size-4 animate-spin rounded-full border-2"></div>
	</div>
{:else if spaceId && membersFailed(spaceId)}
	<div class="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 px-4 py-3" role="status">
		<span class="text-duvet-ink2 text-[13px]">Couldn't load the members</span>
		<Button variant="secondary" size="sm" onclick={() => void loadMoreMembers(spaceId)}>Try again</Button>
	</div>
{/if}
