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
</script>

<section class="auth-scene h-full overflow-y-auto">
	<svg class="auth-folds" viewBox="0 0 480 940" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
		{#each folds as d (d)}
			<path {d} />
		{/each}
	</svg>

	<div class="auth-layout">
		<div class="auth-brand" aria-hidden="true">
			<!-- What Duvet is for, as stickers around its name: talking and voice move on their own; the mailbox and
			     the heart answer what's typed in the form. -->
			<div class="auth-sticker auth-sticker-chat"><Sticker icon={chat} enter={0.15} /></div>
			<div class="auth-sticker auth-sticker-voice"><Sticker icon={headphones} enter={0.35} offset={60} /></div>
			<div class="auth-sticker auth-sticker-mail">
				<Sticker bind:this={mailbox} icon={mailboxIcon} loop={false} enter={0.55} />
			</div>
			<div class="auth-sticker auth-sticker-heart">
				<Sticker bind:this={heart} icon={heartIcon} loop={false} enter={0.75} />
			</div>
			<p class="auth-wordmark">Duvet</p>
			<p class="auth-dot">.chat</p>
			<p class="auth-tagline">a cozy place to talk</p>
		</div>

		<div class="auth-pillow-wrap">
			<div class="auth-pillow" data-mood={mood}>
				<span class="auth-ear auth-ear-left" aria-hidden="true"><span></span></span>
				<span class="auth-ear auth-ear-right" aria-hidden="true"><span></span></span>
				<div class="auth-face" aria-hidden="true" style="--look: {shift}px">
					<span class="auth-eye auth-eye-left"></span>
					<span class="auth-eye auth-eye-right"></span>
					<span class="auth-smile"></span>
				</div>
				{@render children()}
			</div>
		</div>
	</div>
</section>

<style>
	.auth-scene {
		position: relative;
		background:
			radial-gradient(40% 50% at 72% 45%, color-mix(in oklab, var(--duvet-accent) 20%, transparent), transparent 70%),
			var(--duvet-bg);
		color: var(--duvet-ink);
		isolation: isolate;
	}

	.auth-folds {
		position: absolute;
		inset: 0 0 0 auto;
		width: min(560px, 60%);
		height: 100%;
		z-index: -1;
		fill: none;
		stroke: var(--duvet-ink);
		stroke-width: 1;
		opacity: 0.07;
		animation: auth-drift 18s ease-in-out infinite alternate;
	}

	@keyframes auth-drift {
		to {
			transform: translateY(-24px);
		}
	}

	.auth-layout {
		margin: 0 auto;
		display: grid;
		min-height: 100%;
		max-width: 1120px;
		align-items: center;
		gap: 2rem;
		padding: 5.5rem 1.25rem 2.5rem;
	}

	@media (min-width: 900px) {
		.auth-layout {
			grid-template-columns: 1fr minmax(0, 440px);
			gap: 4rem;
			padding: 4rem 3rem;
		}
	}

	.auth-brand {
		position: relative;
		display: none;
	}

	@media (min-width: 900px) {
		.auth-brand {
			display: block;
		}
	}

	.auth-sticker {
		position: absolute;
		pointer-events: none;
	}

	.auth-sticker-chat {
		top: -11.5rem;
		left: 44%;
		width: 210px;
	}

	.auth-sticker-voice {
		bottom: -13rem;
		left: -2rem;
		width: 190px;
	}

	.auth-sticker-mail {
		bottom: -12.5rem;
		left: 32%;
		width: 180px;
	}

	.auth-sticker-heart {
		top: 18%;
		right: -2.5rem;
		width: 150px;
	}

	.auth-wordmark {
		font-size: clamp(5rem, 9vw, 8.5rem);
		font-weight: 700;
		line-height: 0.9;
		letter-spacing: -0.04em;
		color: var(--duvet-ink);
	}

	.auth-dot {
		margin-top: 0.25rem;
		padding-left: 0.4em;
		font-size: clamp(2.5rem, 4.5vw, 4.25rem);
		font-weight: 700;
		line-height: 1;
		letter-spacing: -0.03em;
		color: var(--duvet-accent);
	}

	.auth-tagline {
		margin-top: 1.5rem;
		font-size: 1.25rem;
		color: var(--duvet-ink2);
	}

	.auth-pillow-wrap {
		display: flex;
		justify-content: center;
	}

	/* The mascot's own body, in both themes: the form lives inside it. Its tokens are the night's, so what's
	   written on it reads on its slate. */
	.auth-pillow {
		--duvet-ink: #f2f3f9;
		--duvet-ink2: #b7bad0;
		--duvet-sunk: rgba(10, 11, 22, 0.42);
		--duvet-line: rgba(255, 255, 255, 0.1);
		--duvet-accent: #7b83f5;
		--duvet-on-accent: #14151d;
		--duvet-accent-text: #c3c6ff;
		--duvet-shadow-press: inset 0 2px 5px rgba(0, 0, 0, 0.45);
		--duvet-danger: #f08c84;
		/* The night's values of the palettes the forms use, which light mode turns over. */
		--color-stone-200: oklch(0.923 0.008 278);
		--color-stone-500: oklch(0.553 0.02 278);
		--color-stone-600: oklch(0.444 0.02 278);
		--color-stone-700: oklch(0.374 0.02 278);
		--color-stone-900: oklch(0.216 0.016 278);
		--color-zinc-400: oklch(70.5% 0.015 286.067);
		--color-zinc-600: oklch(44.2% 0.017 285.786);
		--color-rose-300: oklch(81% 0.117 11.638);
		--color-rose-400: oklch(71.2% 0.194 13.428);
		--color-rose-500: oklch(64.5% 0.246 16.439);
		--color-red-400: oklch(70.4% 0.191 22.216);
		--color-red-600: oklch(57.7% 0.245 27.325);
		--color-emerald-400: oklch(76.5% 0.177 163.223);
		--color-emerald-600: oklch(59.6% 0.145 163.225);
		--color-white: #fff;
		position: relative;
		width: 100%;
		max-width: 440px;
		padding: 4.75rem 2rem 2rem;
		border-radius: 44px 44px 36px 36px / 52px 52px 40px 40px;
		background: #3a3d52;
		color: var(--duvet-ink);
		box-shadow:
			inset 0 2px 0 rgba(255, 255, 255, 0.08),
			inset 0 -14px 28px rgba(0, 0, 0, 0.22),
			0 30px 70px rgba(10, 11, 30, 0.45);
	}

	.auth-ear {
		position: absolute;
		top: -64px;
		width: 104px;
		height: 92px;
		background: #3a3d52;
		clip-path: polygon(8% 0%, 100% 88%, 30% 100%);
	}

	.auth-ear span {
		position: absolute;
		inset: 0;
		background: rgba(168, 223, 240, 0.35);
		clip-path: polygon(20% 18%, 86% 86%, 36% 92%);
	}

	.auth-ear-left {
		left: 18px;
	}

	.auth-ear-right {
		right: 18px;
		transform: scaleX(-1);
	}

	.auth-face {
		position: absolute;
		top: 1.4rem;
		left: 50%;
		display: flex;
		gap: 2.6rem;
		transform: translateX(-50%);
	}

	.auth-eye {
		position: relative;
		width: 22px;
		height: 22px;
		border-radius: 999px;
		background: #fff;
		transform: translateX(var(--look));
		transition:
			transform 160ms ease,
			height 140ms ease,
			border-radius 140ms ease,
			margin 140ms ease;
	}

	/* The lashes. */
	.auth-eye::before {
		content: "";
		position: absolute;
		top: -6px;
		width: 2px;
		height: 7px;
		border-radius: 2px;
		background: #fff;
	}

	.auth-eye-left::before {
		left: 1px;
		transform: rotate(-35deg);
	}

	.auth-eye-right::before {
		right: 1px;
		transform: rotate(35deg);
	}

	.auth-smile {
		position: absolute;
		left: 50%;
		top: 26px;
		width: 22px;
		height: 9px;
		border: 2.5px solid rgba(255, 255, 255, 0.55);
		border-top: 0;
		border-radius: 0 0 22px 22px;
		transform: translateX(-50%);
	}

	/* Shut: a lid where each eye was. */
	[data-mood="shy"] .auth-eye,
	[data-mood="peek"] .auth-eye-left {
		height: 4px;
		margin-top: 10px;
		transform: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.auth-folds {
			animation: none;
		}

		.auth-eye {
			transition: none;
		}
	}
</style>
