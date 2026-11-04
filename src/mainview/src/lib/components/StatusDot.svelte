<script lang="ts">
	import { statusDotClass } from "$lib/status";
	import type { MemberOnSidebar } from "$lib/types";

	// A status on an avatar: a dot, or a phone for someone connected only from the mobile app (isMobileOnly in
	// lib/status.ts), drawn as the mobile app draws it. class places it and gives its width, and its text colour, which
	// is what's behind it (text-duvet-sunk): the colour of its ring, a border it may give too, and of the phone's screen.
	// The phone is as wide as the dot and half as tall again, in the status's colour, with a deeper edge below its screen
	// than above; do not disturb puts a bar across the screen, so shape still tells it from online.
	let {
		status,
		mobileOnly = false,
		class: className = "",
	}: { status: MemberOnSidebar["status"]; mobileOnly?: boolean; class?: string } = $props();
</script>

{#if mobileOnly}
	<span class="flex aspect-[2/3] rounded-[30%/20%] border-current bg-current {className}">
		<!-- The screen's edges go by the phone's width, as padding does -->
		<span class="flex flex-1 rounded-[25%/15%] px-[18%] pt-[20%] pb-[45%] {statusDotClass(status)}">
			<span class="flex flex-1 items-center justify-center rounded-[1px] bg-current">
				{#if status === "dnd"}<span class="h-0.5 w-[62.5%] {statusDotClass(status)}"></span>{/if}
			</span>
		</span>
	</span>
{:else}
	<span class="aspect-square rounded-full border-current {statusDotClass(status)} {className}"></span>
{/if}
