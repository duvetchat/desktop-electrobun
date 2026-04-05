<script lang="ts">
	import { Avatar, AvatarFallback, Facehash } from "facehash-sv";

	let {
		src = undefined,
		name,
		size = 40,
		mouthOpen = 0,
		class: className = "",
		oncontextmenu = undefined,
	}: {
		src?: string | null | undefined;
		name: string;
		size?: string | number;
		mouthOpen?: number;
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

<div
	style="width: {typeof size === 'number' ? size + 'px' : size}; height: {typeof size === 'number'
		? size + 'px'
		: size}; border-radius: 50%; overflow: hidden; position: relative;"
	class={className}
	{oncontextmenu}
>
	{#if showImg}
		<img
			src={src}
			alt={name}
			style="width: 100%; height: 100%; object-fit: cover; opacity: {imgLoaded ? 1 : 0}; position: absolute; inset: 0;"
			onload={() => (imgLoaded = true)}
			onerror={handleError}
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
