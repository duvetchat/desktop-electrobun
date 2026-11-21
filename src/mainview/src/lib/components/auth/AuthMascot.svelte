<script lang="ts">
	import type { MascotMood } from "$lib/auth-form";
	import { GHOST_BODY } from "$lib/ghost";

	// The Duvet ghost saying hello: mobile's art (mobile/assets/mascot/{light,dark}/hello.svg, the same drawing with
	// each theme's fills), drawn here so that its eyes can move. They look along the field being typed in, shut on a
	// password, and one opens while the password shows. Shut, they look straight ahead, whatever `look` says.
	let {
		mood = "awake",
		look = 0,
		size = 120,
		class: className = "",
	}: {
		mood?: MascotMood;
		/** -1 left … 1 right. */
		look?: number;
		size?: number;
		class?: string;
	} = $props();

	// In the drawing's own units (120 across): an eye is 8.8 wide, and moves a little under a third of that.
	const shift = $derived(Math.max(-1, Math.min(1, look)) * 2.6);

	const body = GHOST_BODY;
	const sparkle = "M0 -5 L1.4 -1.4 L5 0 L1.4 1.4 L0 5 L-1.4 1.4 L-5 0 L-1.4 -1.4 Z";
	const shade = "fill-[#262633] in-[.duvet-light]:fill-[#c9d4ff]";
	const light = "fill-[#f7f6f3] in-[.duvet-light]:fill-[#ffffff]";
	// An eye, which shuts to a lid where it was.
	const eye =
		"origin-center fill-[#7a6ad8] transition-[scale] duration-140 ease-[ease] [transform-box:fill-box] motion-reduce:transition-none in-data-[mood=shy]:scale-y-[0.14]";
</script>

<svg
	class={className}
	width={size}
	height={size}
	viewBox="0 0 120 120"
	aria-hidden="true"
	data-mascot
	data-mood={mood}
	style="--look: {shift}px"
>
	<defs><clipPath id="auth-mascot-body"><path d={body} /></clipPath></defs>
	<path d={sparkle} class="fill-[#2a3050] in-[.duvet-light]:fill-[#b9c6ff]" transform="translate(22 24)" />
	<path d={sparkle} class="fill-[#3d3266] in-[.duvet-light]:fill-[#c9b8f5]" transform="translate(100 88) scale(0.7)" />
	<ellipse cx="62" cy="104" rx="20" ry="3" class="fill-[#1a1a22] in-[.duvet-light]:fill-[#d5deff]" />
	<g transform="translate(15 8) scale(0.9)">
		<path
			d="M77.5 60 C83.5 58 88.5 51 90.5 45 C91.5 41 87.5 39.5 86.0 42.5 C84.0 47 80.5 51 75.5 53 Z"
			class={shade}
			transform="translate(0 4)"
		/>
		<path d={body} class={shade} transform="translate(3.5 4)" />
		<path d={body} class="fill-[#c9cbe0] in-[.duvet-light]:fill-[#dcd6ff]" />
		<g clip-path="url(#auth-mascot-body)"><path d={body} class={light} transform="translate(-3.2 -2.6)" /></g>
		<path d="M74 60 C80 58 85 51 87 45 C88 41 84 39.5 82.5 42.5 C80.5 47 77 51 72 53 Z" class={light} />
		<g
			class="translate-x-(--look) transition-[translate] duration-160 ease-[ease] in-data-[mood=peek]:translate-x-0 in-data-[mood=shy]:translate-x-0 motion-reduce:transition-none"
		>
			<!-- The left eye stays shut while peeking, too. -->
			<ellipse cx="42" cy="50" rx="4.4" ry="6" class="{eye} in-data-[mood=peek]:scale-y-[0.14]" />
			<ellipse cx="59" cy="50" rx="4.4" ry="6" class={eye} />
		</g>
	</g>
</svg>
