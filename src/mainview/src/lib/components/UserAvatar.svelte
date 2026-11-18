<script lang="ts">
	import { Avatar, AvatarFallback, Facehash } from "facehash-sv";

	let {
		src = undefined,
		name,
		size = 40,
		mouthOpen = 0,
		eyeOffset = { x: 0, y: 0 },
		class: className = "",
		oncontextmenu = undefined,
	}: {
		src?: string | null | undefined;
		name: string;
		size?: string | number;
		mouthOpen?: number;
		eyeOffset?: { x: number; y: number };
		class?: string;
		oncontextmenu?: (e: MouseEvent) => void;
	} = $props();

	const MAX_RETRIES = 3;
	const RETRY_DELAY = 2000;

	let imgLoaded = $state(false);
	let imgError = $state(false);
	let retryCount = $state(0);

	let lastSrc: string | null | undefined;
	$effect(() => {
		if (src !== lastSrc) {
			lastSrc = src;
			imgLoaded = false;
			imgError = !src;
			retryCount = 0;
		}
	});

	function handleError() {
		if (retryCount < MAX_RETRIES) {
			retryCount++;
			setTimeout(() => {
				imgError = false;
			}, RETRY_DELAY * retryCount);
		} else {
			imgError = true;
		}
	}

	const showImg = $derived(!!src && !imgError);
</script>

<!-- The face drawn for who has no picture blinks on a timer of its own (facehash-sv), and leans back under the pointer:
     with reduced motion its eyes stay open and it turns at once. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	style="width: {typeof size === 'number' ? size + 'px' : size}; height: {typeof size === 'number'
		? size + 'px'
		: size}; border-radius: 50%; overflow: hidden; position: relative;"
	class="motion-reduce:[&_[data-facehash-face]]:transition-none! motion-reduce:[&_[data-facehash-face]>div]:transform-none! motion-reduce:[&_[data-facehash-face]>div]:transition-none! {className}"
	{oncontextmenu}
>
	{#if showImg}
		<img
			{src}
			alt={name}
			style="width: 100%; height: 100%; object-fit: cover; opacity: {imgLoaded ? 1 : 0}; position: absolute; inset: 0;"
			onload={() => (imgLoaded = true)}
			onerror={handleError}
			draggable="false"
			loading="lazy"
		/>
	{/if}
	{#if !showImg || !imgLoaded}
		<Avatar style="width: 100%; height: 100%;">
			<AvatarFallback {name} facehash={false}>
				<Facehash {name} size="100%" {mouthOpen} {eyeOffset} />
			</AvatarFallback>
		</Avatar>
	{/if}
</div>
