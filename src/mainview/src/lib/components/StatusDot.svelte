<script lang="ts">
	import { statusDotClass } from "$lib/status";
	import type { MemberOnSidebar } from "$lib/types";

	// The dot that shows a status on an avatar: class places and sizes it.
	let { status, class: className = "" }: { status: MemberOnSidebar["status"]; class?: string } = $props();
</script>

<span class="rounded-full {statusDotClass(status)} {className}"></span>
