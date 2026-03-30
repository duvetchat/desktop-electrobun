<script lang="ts">
	import { Avatar, AvatarFallback, Facehash } from "facehash-sv";

	let {
		src = undefined,
		name,
		size = 40,
		mouthOpen = 0,
		class: className = "",
	}: {
		src?: string | null | undefined;
		name: string;
		size?: string | number;
		mouthOpen?: number;
		class?: string;
	} = $props();

	let imgLoaded = $state(false);
	let imgError = $state(false);

	let lastSrc: string | null | undefined;
	$effect(() => {
		if (src !== lastSrc) {
			lastSrc = src;
			imgLoaded = false;
			imgError = !src;
		}
	});

	const showImg = $derived(!!src && !imgError);
</script>

<div
	style="width: {typeof size === 'number' ? size + 'px' : size}; height: {typeof size === 'number'
		? size + 'px'
		: size}; border-radius: 50%; overflow: hidden; position: relative;"
	class={className}
>
	{#if showImg}
		<img
			src={src}
			alt={name}
			style="width: 100%; height: 100%; object-fit: cover; opacity: {imgLoaded ? 1 : 0}; position: absolute; inset: 0;"
			onload={() => (imgLoaded = true)}
			onerror={() => (imgError = true)}
			draggable="false"
		/>
	{/if}
	{#if !showImg || !imgLoaded}
		<Avatar style="width: 100%; height: 100%;">
			<AvatarFallback {name} facehash={false}>
				<Facehash {name} size="100%" {mouthOpen} />
			</AvatarFallback>
		</Avatar>
	{/if}
</div>
