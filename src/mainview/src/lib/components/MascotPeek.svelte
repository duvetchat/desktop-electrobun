<script lang="ts">
	import type { MascotMood } from "$lib/components/AuthScene.svelte";

	let {
		mood = "awake",
		look = 0,
		class: className = "",
	}: {
		mood?: MascotMood;
		/** -1 left … 1 right. */
		look?: number;
		class?: string;
	} = $props();

	const shift = $derived(Math.max(-1, Math.min(1, look)) * 14);
</script>

<!-- The mascot as the desktop's icon draws it, its eyes free to move: open and looking, shut, or one open. Shut, they
     look straight ahead, whatever `look` says. -->
<svg class={className} viewBox="40 70 432 400" aria-hidden="true" data-mood={mood}>
	<path
		d="M100 240Q82 250 78 290Q72 340 82 390Q90 430 120 440Q180 455 256 455Q332 455 392 440Q422 430 430 390Q440 340 434 290Q430 250 412 240Q370 222 256 222Q142 222 100 240Z"
		fill="#3a3d52"
	/>
	<path d="M105 240L60 90L220 224Z" fill="#3a3d52" />
	<path d="M125 234L80 115L200 224Z" fill="#a8dff0" opacity=".35" />
	<path d="M407 240L452 90L292 224Z" fill="#3a3d52" />
	<path d="M387 234L432 115L312 224Z" fill="#a8dff0" opacity=".35" />
	<g
		class="transition-[transform] duration-160 ease-[ease] in-data-[mood=peek]:transform-none! in-data-[mood=shy]:transform-none! motion-reduce:transition-none"
		style="transform: translateX({shift}px)"
	>
		<!-- The left eye shuts while peeking, too. -->
		<g>
			<circle class="in-data-[mood=peek]:hidden in-data-[mood=shy]:hidden" cx="200" cy="330" r="25" fill="#fff" />
			<path
				class="hidden in-data-[mood=peek]:inline in-data-[mood=shy]:inline"
				d="M178 328Q200 346 222 328"
				fill="none"
				stroke="#fff"
				stroke-width="9"
				stroke-linecap="round"
			/>
		</g>
		<g>
			<circle class="in-data-[mood=shy]:hidden" cx="312" cy="330" r="25" fill="#fff" />
			<path
				class="hidden in-data-[mood=shy]:inline"
				d="M290 328Q312 346 334 328"
				fill="none"
				stroke="#fff"
				stroke-width="9"
				stroke-linecap="round"
			/>
		</g>
	</g>
	<path d="M230 390Q256 406 282 390" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".6" />
</svg>
