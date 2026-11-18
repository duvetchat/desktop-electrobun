<script lang="ts">
	import { untrack } from "svelte";
	import { Copy as CopySimpleIcon, Check as CheckIcon } from "@lucide/svelte";
	import { getApiError } from "$lib/api/api";
	import Sheet from "$lib/components/ui/Sheet.svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import { pillClass } from "$lib/components/ui/recipes";
	import { spinnerClass } from "$lib/overlay-forms";
	import { createRoomInvite } from "$lib/api/rooms";
	import type { Channel } from "$lib/types";
	import { route, DUVET_DOMAIN } from "$lib/common/common";

	let {
		open = $bindable(false),
		channel = null,
		spaceId = "",
	}: {
		open?: boolean;
		channel?: Pick<Channel, "id" | "name"> | null;
		spaceId?: string;
	} = $props();

	let inviteLink = $state("");
	let isLoading = $state(false);
	let copied = $state(false);
	let genError = $state("");
	let linkInput = $state<HTMLInputElement | undefined>(undefined);

	// How long a new link works. Like Discord, 7 days unless you pick otherwise.
	const EXPIRY_OPTIONS = [
		{ label: "30 minutes", seconds: 30 * 60 },
		{ label: "1 hour", seconds: 60 * 60 },
		{ label: "6 hours", seconds: 6 * 60 * 60 },
		{ label: "12 hours", seconds: 12 * 60 * 60 },
		{ label: "1 day", seconds: 24 * 60 * 60 },
		{ label: "7 days", seconds: 7 * 24 * 60 * 60 },
		{ label: "Never", seconds: 0 },
	];
	let maxAge = $state(7 * 24 * 60 * 60);
	// The age the shown link was made with: the select can already say another while it is made.
	let linkAge = $state(0);
	const expiryLabel = $derived(EXPIRY_OPTIONS.find((o) => o.seconds === linkAge)?.label ?? "");
	// Only the latest request shows: a slower earlier one mustn't replace the link the last pick asked for.
	let request = 0;

	// A new link when the modal opens, its channel changes or another expiry is picked, and only
	// then: every update of the space (someone joining, a role change) hands the props down again,
	// and each run of generate() makes another invite.
	let generatedFor: string | null = null;
	$effect(() => {
		const key = open && channel ? `${channel.id}:${maxAge}` : null;
		if (key === generatedFor) {
			return;
		}
		generatedFor = key;
		if (key !== null) {
			untrack(() => generate());
		}
	});

	async function generate() {
		if (!channel || !spaceId) return;
		const mine = ++request;
		const age = maxAge;
		inviteLink = "";
		genError = "";
		copied = false;
		isLoading = true;
		try {
			const code = await createRoomInvite(spaceId, channel.id, age);
			if (mine !== request) return;
			inviteLink = `${DUVET_DOMAIN}/invite?code=${encodeURIComponent(code)}`;
			linkAge = age;
		} catch (err) {
			if (mine !== request) return;
			genError = getApiError(err, "Failed to generate link.");
		} finally {
			if (mine === request) isLoading = false;
		}
	}

	function copyLink() {
		if (!inviteLink) return;
		navigator.clipboard.writeText(inviteLink);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<Sheet bind:open title="Invite People" description={channel ? `#${channel.name}` : undefined} class="max-w-[460px]">
	<p class="text-duvet-ink text-[13px]">Share this invite link. Anyone with this link can join the Space.</p>

	{#if isLoading}
		<div class="text-duvet-ink2 flex items-center justify-center py-6">
			<div class={spinnerClass("lg")} role="status" aria-label="Making the link"></div>
		</div>
	{:else if genError}
		<p class="text-duvet-danger py-2 text-center text-[13px]">
			{genError}
		</p>
		<Button variant="secondary" class="w-full" onclick={generate}>Try again</Button>
	{:else if inviteLink}
		<div
			class="bg-duvet-card shadow-duvet-well flex items-center gap-2 rounded-xl py-[5px] pr-[5px] pl-3 focus-within:shadow-[0_0_0_4px_var(--duvet-accent-tint),0_0_0_1px_var(--duvet-accent)]"
		>
			<input
				bind:this={linkInput}
				type="text"
				readonly
				value={inviteLink}
				aria-label="Invite link"
				class="text-duvet-ink focus-override min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none"
				onclick={() => linkInput?.select()}
			/>
			<Button size="sm" onclick={copyLink} aria-label="Copy link">
				{#if copied}
					<CheckIcon size={14} />
					Copied!
				{:else}
					<CopySimpleIcon size={14} />
					Copy
				{/if}
			</Button>
		</div>
		<p class="text-duvet-ink2 text-xs">
			{linkAge === 0 ? "This link never expires." : `This link expires in ${expiryLabel}.`}
		</p>
	{/if}
	<div class="flex flex-col gap-2" role="radiogroup" aria-label="Expire after">
		<span class="text-duvet-ink2 text-xs font-medium" aria-hidden="true">Expire after</span>
		<div class="flex flex-wrap gap-1.5">
			{#each EXPIRY_OPTIONS as option (option.seconds)}
				<button
					type="button"
					role="radio"
					aria-checked={maxAge === option.seconds}
					class={pillClass(maxAge === option.seconds)}
					onclick={() => (maxAge = option.seconds)}
				>
					{option.label}
				</button>
			{/each}
		</div>
	</div>
</Sheet>
