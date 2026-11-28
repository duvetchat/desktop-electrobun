<script lang="ts" module>
	export type { MascotMood } from "$lib/auth-form";
</script>

<script lang="ts">
	import type { Snippet } from "svelte";
	import type { MascotMood } from "$lib/auth-form";
	import AuthMascot from "$lib/components/auth/AuthMascot.svelte";
	import Sticker from "$lib/components/Sticker.svelte";
	import { chat, headphones, heart as heartIcon, mailbox as mailboxIcon } from "$lib/stickers/icons";
	import { t } from "$lib/i18n";

	// The frame of the sign-in pages and the invite page (#357), after mobile's sign-in: a centred column, at most 400
	// wide, with the ghost over its title. On a window 900 wide or more, Duvet's name and what it is for stand beside
	// it, as stickers.
	let {
		mood = "awake",
		look = 0,
		mailCue = 0,
		sendCue = 0,
		title = undefined,
		lead = undefined,
		wide = false,
		children,
	}: {
		mood?: MascotMood;
		/** Where the ghost looks, -1 left … 1 right. */
		look?: number;
		/** Raised by one when an email reads right: the mailbox puts its flag up. */
		mailCue?: number;
		/** Raised by one when the form is sent: the heart hops, glad to see them. */
		sendCue?: number;
		/** The page's heading, under the ghost. A page that shows how a link turned out has its own instead. */
		title?: string;
		lead?: string;
		/** A form with fields side by side (sign-up): the column is 480 wide at most. */
		wide?: boolean;
		children: Snippet;
	} = $props();

	let mailbox = $state<Sticker>();
	let heart = $state<Sticker>();
	$effect(() => {
		if (mailCue) mailbox?.replay();
	});
	$effect(() => {
		if (sendCue) heart?.replay();
	});

	// The folds of a duvet, as duvet.chat's card draws them: long vertical waves, each a little off the last.
	const folds = Array.from({ length: 16 }, (_, i) => {
		const x = 40 + i * 26;
		const a = 18 + (i % 4) * 6;
		return `M ${x} -20 C ${x + a} 160, ${x - a} 320, ${x + a * 0.6} 480 S ${x - a} 800, ${x + a * 0.4} 960`;
	});
</script>

<section
	class="bg-duvet-bg text-duvet-ink relative isolate h-full overflow-y-auto bg-[radial-gradient(40%_50%_at_72%_45%,var(--duvet-accent-tint),transparent_70%)]"
>
	<svg
		class="stroke-duvet-ink animate-auth-drift absolute inset-y-0 right-0 left-auto -z-1 h-full w-[min(560px,60%)] fill-none stroke-1 opacity-7 motion-reduce:animate-none"
		viewBox="0 0 480 940"
		preserveAspectRatio="xMaxYMid slice"
		aria-hidden="true"
	>
		{#each folds as d (d)}
			<path {d} />
		{/each}
	</svg>

	<div
		class="mx-auto grid min-h-full max-w-[1120px] items-center gap-8 px-6 py-8 min-[900px]:gap-16 min-[900px]:px-12 min-[900px]:py-12 {wide
			? 'min-[900px]:grid-cols-[1fr_minmax(0,480px)]'
			: 'min-[900px]:grid-cols-[1fr_minmax(0,400px)]'}"
	>
		<div class="relative hidden min-[900px]:block" aria-hidden="true">
			<!-- What Duvet is for, as stickers around its name: talking and voice move on their own; the mailbox and
			     the heart answer what's typed in the form. -->
			<div class="pointer-events-none absolute -top-46 left-[44%] w-[210px]">
				<Sticker icon={chat} enter={0.15} />
			</div>
			<div class="pointer-events-none absolute -bottom-52 -left-8 w-[190px]">
				<Sticker icon={headphones} enter={0.35} offset={60} />
			</div>
			<div class="pointer-events-none absolute -bottom-50 left-[32%] w-[180px]">
				<Sticker bind:this={mailbox} icon={mailboxIcon} loop={false} enter={0.55} />
			</div>
			<div class="pointer-events-none absolute top-[18%] -right-10 w-[150px]">
				<Sticker bind:this={heart} icon={heartIcon} loop={false} enter={0.75} />
			</div>
			<!-- The wordmark as the brand sets it (theme.dart's wordmark): Fraunces Regular at its largest optical size. -->
			<p
				class="text-duvet-ink font-serif-lg text-[clamp(5rem,9vw,8.5rem)] leading-[0.9] font-normal tracking-[-0.03em] [font-variation-settings:'opsz'_144,'SOFT'_50,'WONK'_0]"
			>
				Duvet
			</p>
			<p
				class="text-duvet-accent-text font-serif-lg mt-1 pl-[0.4em] text-[clamp(2.5rem,4.5vw,4.25rem)] leading-none font-normal tracking-[-0.03em] [font-variation-settings:'opsz'_144,'SOFT'_50,'WONK'_0]"
			>
				.chat
			</p>
			<p class="text-duvet-ink2 mt-6 text-[1.25rem]">{t("auth_tagline")}</p>
		</div>

		<div class="mx-auto flex w-full flex-col {wide ? 'max-w-[480px]' : 'max-w-[400px]'}" data-auth-column>
			<AuthMascot {mood} {look} class="mx-auto block" />
			{#if title}
				<header class="mt-4 mb-8 text-center">
					<h1 class="text-duvet-ink text-[36px] leading-[1.1] font-bold tracking-[-0.02em]">{title}</h1>
					{#if lead}
						<p class="text-duvet-ink2 font-content mt-2 text-[15px] leading-[1.4]">{lead}</p>
					{/if}
				</header>
			{:else}
				<div class="h-6"></div>
			{/if}
			{@render children()}
			<!-- The notices of what the app ships (#628), for anyone before they sign in: routes/licenses. -->
			<a href="/licenses" class="auth-link mt-10 self-center text-[12.5px]">{t("auth_licenses")}</a>
		</div>
	</div>
</section>
