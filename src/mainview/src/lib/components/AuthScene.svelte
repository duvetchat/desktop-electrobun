<script lang="ts" module>
	/**
	 * Awake: eyes open, looking toward `look` (-1 left … 1 right). Shy: eyes shut, while a password is typed.
	 * Peek: one eye open, while the password is shown.
	 */
	export type MascotMood = "awake" | "shy" | "peek";
</script>

<script lang="ts">
	import type { Snippet } from "svelte";
	import Sticker from "$lib/components/Sticker.svelte";
	import { chat, headphones, heart as heartIcon, mailbox as mailboxIcon } from "$lib/stickers/icons";

	let {
		mood = "awake",
		look = 0,
		mailCue = 0,
		sendCue = 0,
		children,
	}: {
		mood?: MascotMood;
		look?: number;
		/** Raised by one when an email reads right: the mailbox puts its flag up. */
		mailCue?: number;
		/** Raised by one when the form is sent: the heart hops, glad to see them. */
		sendCue?: number;
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

	const shift = $derived(Math.max(-1, Math.min(1, look)) * 7);

	// The folds of a duvet, as duvet.chat's card draws them: long vertical waves, each a little off the last.
	const folds = Array.from({ length: 16 }, (_, i) => {
		const x = 40 + i * 26;
		const a = 18 + (i % 4) * 6;
		return `M ${x} -20 C ${x + a} 160, ${x - a} 320, ${x + a * 0.6} 480 S ${x - a} 800, ${x + a * 0.4} 960`;
	});

	// The pillow is the mascot's own body, in both themes, and the form lives inside it. Its tokens are the night's, so
	// what's written on it reads on its slate.
	const night = [
		"[--duvet-ink:#f2f3f9]",
		"[--duvet-ink2:#b7bad0]",
		"[--duvet-sunk:rgba(10,11,22,0.42)]",
		"[--duvet-line:rgba(255,255,255,0.1)]",
		"[--duvet-accent:#7b83f5]",
		"[--duvet-on-accent:#14151d]",
		"[--duvet-accent-text:#c3c6ff]",
		"[--duvet-shadow-press:inset_0_2px_5px_rgba(0,0,0,0.45)]",
		"[--duvet-danger:#f08c84]",
		"[--duvet-alive:#a8dff0]",
	].join(" ");

	// An eye with its lash, open and looking toward --look; shut (a lid where it was) while shy.
	const eye =
		"relative h-[22px] w-[22px] translate-x-(--look) rounded-[999px] bg-[#fff] transition-[translate,height,border-radius,margin] duration-[160ms,140ms,140ms,140ms] ease-[ease] motion-reduce:transition-none in-data-[mood=shy]:mt-2.5 in-data-[mood=shy]:h-1 in-data-[mood=shy]:translate-none before:absolute before:-top-1.5 before:h-[7px] before:w-0.5 before:rounded-[2px] before:bg-[#fff]";
</script>

<section
	class="bg-duvet-bg text-duvet-ink relative isolate h-full overflow-y-auto bg-[radial-gradient(40%_50%_at_72%_45%,color-mix(in_oklab,var(--duvet-accent)_20%,transparent),transparent_70%)]"
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
		class="mx-auto grid min-h-full max-w-[1120px] items-center gap-8 px-5 pt-22 pb-10 min-[900px]:grid-cols-[1fr_minmax(0,440px)] min-[900px]:gap-16 min-[900px]:px-12 min-[900px]:py-16"
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
			<p class="text-duvet-ink text-[clamp(5rem,9vw,8.5rem)] leading-[0.9] font-bold tracking-[-0.04em]">Duvet</p>
			<p
				class="text-duvet-accent mt-1 pl-[0.4em] text-[clamp(2.5rem,4.5vw,4.25rem)] leading-none font-bold tracking-[-0.03em]"
			>
				.chat
			</p>
			<p class="text-duvet-ink2 mt-6 text-[1.25rem]">a cozy place to talk</p>
		</div>

		<div class="flex justify-center">
			<div
				class="text-duvet-ink relative w-full max-w-[440px] rounded-[44px_44px_36px_36px/52px_52px_40px_40px] bg-[#3a3d52] px-8 pt-19 pb-8 shadow-[inset_0_2px_0_rgba(255,255,255,0.08),inset_0_-14px_28px_rgba(0,0,0,0.22),0_30px_70px_rgba(10,11,30,0.45)] {night}"
				data-mood={mood}
			>
				<span
					class="absolute -top-16 left-[18px] h-[92px] w-[104px] bg-[#3a3d52] [clip-path:polygon(8%_0%,100%_88%,30%_100%)]"
					aria-hidden="true"
					><span class="absolute inset-0 bg-[rgba(168,223,240,0.35)] [clip-path:polygon(20%_18%,86%_86%,36%_92%)]"
					></span></span
				>
				<span
					class="absolute -top-16 right-[18px] h-[92px] w-[104px] -scale-x-100 bg-[#3a3d52] [clip-path:polygon(8%_0%,100%_88%,30%_100%)]"
					aria-hidden="true"
					><span class="absolute inset-0 bg-[rgba(168,223,240,0.35)] [clip-path:polygon(20%_18%,86%_86%,36%_92%)]"
					></span></span
				>
				<div
					class="absolute top-[1.4rem] left-1/2 flex -translate-x-1/2 gap-[2.6rem]"
					aria-hidden="true"
					style="--look: {shift}px"
				>
					<!-- The left eye shuts while peeking, too. -->
					<span
						class="{eye} before:left-px before:-rotate-35 in-data-[mood=peek]:mt-2.5 in-data-[mood=peek]:h-1 in-data-[mood=peek]:translate-none"
					></span>
					<span class="{eye} before:right-px before:rotate-35"></span>
					<span
						class="absolute top-[26px] left-1/2 h-[9px] w-[22px] -translate-x-1/2 rounded-b-[22px] border-[2.5px] border-t-0 border-[rgba(255,255,255,0.55)]"
					></span>
				</div>
				{@render children()}
			</div>
		</div>
	</div>
</section>
