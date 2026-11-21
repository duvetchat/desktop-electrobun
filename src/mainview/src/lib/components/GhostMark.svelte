<script lang="ts">
	import { GHOST_BODY } from "$lib/ghost";

	// The logo's ghost without its square, in each theme's art colours: mobile's GhostMark (widgets/ghost_art.dart), for
	// where the mascot would be too small. The same outline as the mascot's (AuthMascot), flat, with its eyes open. It
	// is decoration: whoever draws it says in words what it stands for.
	let {
		size = 24,
		class: className = "",
	}: {
		/** Its height; the mark is 64 wide for 72 tall. */
		size?: number;
		class?: string;
	} = $props();

	// A clip path of its own: two chats side by side each draw a mark.
	const uid = $props.id();
</script>

<svg class={className} width={(size * 64) / 72} height={size} viewBox="20 20 64 72" aria-hidden="true" data-ghost-mark>
	<defs><clipPath id="{uid}-ghost"><path d={GHOST_BODY} /></clipPath></defs>
	<path d={GHOST_BODY} class="fill-[#1c1d28] in-[.duvet-light]:fill-[#d3dfff]" transform="translate(3.5 4)" />
	<path d={GHOST_BODY} class="fill-[#c9cbe0] in-[.duvet-light]:fill-[#dcd6ff]" />
	<g clip-path="url(#{uid}-ghost)">
		<path d={GHOST_BODY} class="fill-[#f7f6f3] in-[.duvet-light]:fill-[#ffffff]" transform="translate(-3.2 -2.6)" />
	</g>
	<ellipse cx="42" cy="50" rx="4.4" ry="6" class="fill-[#7a6ad8]" />
	<ellipse cx="59" cy="50" rx="4.4" ry="6" class="fill-[#7a6ad8]" />
</svg>
