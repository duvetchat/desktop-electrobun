<script lang="ts">
	import { claimLayer, layerStyle, releaseLayer } from "$lib/overlay-layers";
	import { listStep } from "$lib/focus-wrap";
	import { GLASS } from "$lib/components/ui/recipes";
	import type { Snippet } from "svelte";
	import { Popover } from "bits-ui";
	import {
		Check as CheckIcon,
		ChevronDown as ChevronDownIcon,
		Folder as CategoryIcon,
		Hash as HashIcon,
		Volume2 as VoiceIcon,
	} from "@lucide/svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { t } from "$lib/i18n";
	import { canViewRoom } from "$lib/permissions";
	import {
		ComponentType,
		type Component,
		type ComponentEmoji,
		type GatewaySpace,
		type MemberOnSidebar,
	} from "$lib/types";

	// A message's select menu: its own options, or the space's members, roles or rooms, with its defaults
	// chosen. With onSubmit, a choice goes to the bot as soon as it's made (a single choice) or when the
	// menu closes (several); then the menu shows its defaults again, as the bot's answer is what counts.
	// Without it (the previews), choosing only changes what it shows.
	let {
		component: c,
		space = null,
		members = [],
		emoji,
		waiting = false,
		onSubmit,
	}: {
		component: Component;
		space?: GatewaySpace | null;
		members?: MemberOnSidebar[];
		emoji: Snippet<[ComponentEmoji | undefined]>;
		/** While its interaction waits on the bot. */
		waiting?: boolean;
		onSubmit?: (values: string[]) => Promise<void>;
	} = $props();

	type Choice = {
		key: string;
		label: string;
		description?: string;
		emoji?: ComponentEmoji;
		avatar?: string | null;
		color?: string;
		roomType?: number;
	};

	const hex = (color: number) => "#" + color.toString(16).padStart(6, "0");

	const choices = $derived.by((): Choice[] => {
		if (c.type === ComponentType.StringSelect) {
			return (c.options ?? []).map((o) => ({
				key: `option:${o.value}`,
				label: o.label,
				description: o.description,
				emoji: o.emoji,
			}));
		}
		const users: Choice[] = members.map((m) => ({ key: `user:${m.id}`, label: m.username, avatar: m.avatar_url }));
		// The everyone role's ID is the space's.
		const roles: Choice[] = [...(space?.roles ?? [])]
			.filter((r) => r.id !== space?.id)
			.sort((a, b) => b.position - a.position)
			.map((r) => ({
				key: `role:${r.id}`,
				label: r.name,
				color: r.color_from !== null ? hex(r.color_from) : undefined,
			}));
		if (c.type === ComponentType.UserSelect) return users;
		if (c.type === ComponentType.RoleSelect) return roles;
		if (c.type === ComponentType.MentionableSelect) return [...users, ...roles];
		// The rooms the user can see, as the sidebar shows them: the API takes no others.
		const s = space;
		if (!s) return [];
		return [...s.rooms]
			.filter((r) => !r.deleted_at && canViewRoom(s, r) && (!c.room_types?.length || c.room_types.includes(r.type)))
			.sort((a, b) => a.position - b.position)
			.map((r) => ({ key: `room:${r.id}`, label: r.name, roomType: r.type }));
	});

	const max = $derived(c.max_values ?? 1);
	const min = $derived(c.min_values ?? 1);
	const searchable = $derived(c.type !== ComponentType.StringSelect);

	// What's chosen, by choice key: the defaults until something is picked.
	function defaults(): string[] {
		if (c.type === ComponentType.StringSelect) {
			return (c.options ?? []).filter((o) => o.default).map((o) => `option:${o.value}`);
		}
		return (c.default_values ?? []).map((d) => `${d.type}:${d.id}`);
	}
	let chosen = $state<string[]>(defaults());
	// What was chosen when the menu opened, to tell whether closing it changed anything.
	let openedWith: string[] = [];
	let open = $state(false);
	let query = $state("");

	const shown = $derived(
		query ? choices.filter((ch) => ch.label.toLowerCase().includes(query.toLowerCase())) : choices,
	);
	const chosenChoices = $derived(
		chosen.map((key) => choices.find((ch) => ch.key === key)).filter((ch): ch is Choice => !!ch),
	);

	function pick(key: string) {
		if (max <= 1) {
			chosen = [key];
			open = false;
			submit();
		} else if (chosen.includes(key)) {
			chosen = chosen.filter((k) => k !== key);
		} else if (chosen.length < max) {
			chosen = [...chosen, key];
		}
	}

	// Sends the choice: an option's value, or the member's, role's or room's ID (the part after the key's
	// kind).
	async function submit() {
		if (!onSubmit) return;
		await onSubmit(chosen.map((key) => key.slice(key.indexOf(":") + 1)));
		chosen = defaults();
	}

	const sameChoice = (a: string[], b: string[]) => a.length === b.length && a.every((key) => b.includes(key));

	// The arrows, Home and End move the focus through the options, as in any list of them.
	let optionsEl = $state<HTMLElement>();
	function optionKeys(e: KeyboardEvent) {
		const options = [...(optionsEl?.querySelectorAll<HTMLElement>('[role="option"]:not(:disabled)') ?? [])];
		const to = listStep(options.length, options.indexOf(document.activeElement as HTMLElement), e.key);
		if (to === null) return;
		e.preventDefault();
		options[to]?.focus();
	}

	// What opens last is in front, whatever opened it (lib/overlay-layers.ts).
	const layer = $derived(open ? claimLayer() : 0);
	$effect(() => {
		const mine = layer;
		if (mine) return () => releaseLayer(mine);
	});
</script>

<Popover.Root
	bind:open
	onOpenChange={(o) => {
		if (o) {
			openedWith = [...chosen];
			return;
		}
		query = "";
		if (max > 1 && !sameChoice(chosen, openedWith) && chosen.length >= min) submit();
	}}
>
	<Popover.Trigger
		disabled={c.disabled || waiting}
		class="bg-duvet-card shadow-duvet-well rounded-control flex min-h-[38px] w-full max-w-100 items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-shadow duration-[120ms] outline-none focus-visible:shadow-[0_0_0_4px_var(--duvet-accent-tint),0_0_0_1px_var(--duvet-accent)] disabled:pointer-events-none disabled:opacity-45 data-[state=open]:shadow-[0_0_0_4px_var(--duvet-accent-tint),0_0_0_1px_var(--duvet-accent)] motion-reduce:transition-none"
	>
		<span class="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
			{#if chosenChoices.length === 0}
				<span class="text-duvet-ink2 truncate">{c.placeholder || t("chat_select_placeholder")}</span>
			{:else}
				{#each chosenChoices as ch, i}
					{@render choiceIcon(ch, 16)}
					<span class="text-duvet-ink truncate">{ch.label}{i < chosenChoices.length - 1 ? "," : ""}</span>
				{/each}
			{/if}
		</span>
		{#if waiting}
			<!-- Waiting on the bot, as the typing indicator's dots -->
			<span class="text-duvet-ink2 flex shrink-0 items-center gap-1" aria-hidden="true">
				<span class="animate-typing-bounce block size-1.5 rounded-full bg-current"></span>
				<span class="animate-typing-bounce block size-1.5 rounded-full bg-current [animation-delay:0.2s]"></span>
				<span class="animate-typing-bounce block size-1.5 rounded-full bg-current [animation-delay:0.4s]"></span>
			</span>
		{:else}
			<ChevronDownIcon
				class="text-duvet-ink2 size-4 shrink-0 transition-transform motion-reduce:transition-none {open
					? 'rotate-180'
					: ''}"
			/>
		{/if}
	</Popover.Trigger>
	<Popover.Portal>
		{#if layer}
			<!-- The panel's positioner takes no layer of its own: this holds it, at the overlay's (lib/overlay-layers.ts). -->
			<div class="fixed top-0 left-0" style={layerStyle(layer)}>
				<Popover.Content
					side="bottom"
					align="start"
					sideOffset={6}
					collisionPadding={10}
					class="{GLASS} animate-float-in text-duvet-ink rounded-panel z-[1000] flex max-h-80 w-(--bits-popover-anchor-width) min-w-56 origin-(--bits-floating-transform-origin) flex-col overflow-hidden outline-none"
				>
					{#if searchable}
						<input
							bind:value={query}
							placeholder={t("chat_select_search")}
							aria-label={t("chat_select_search")}
							onkeydown={(e) => {
								if (e.key !== "ArrowDown") return;
								e.preventDefault();
								optionsEl?.querySelector<HTMLElement>('[role="option"]:not(:disabled)')?.focus();
							}}
							class="bg-duvet-field text-duvet-ink placeholder:text-duvet-ink2 focus-override rounded-tile m-1.5 mb-0 h-8 shrink-0 px-2.5 text-[13px] outline-none focus:shadow-[0_0_0_3px_var(--duvet-accent-tint),0_0_0_1px_var(--duvet-accent)]"
						/>
					{/if}
					<div
						bind:this={optionsEl}
						class="overflow-y-auto p-1.5"
						role="listbox"
						aria-label={c.placeholder || t("chat_select_options")}
						aria-multiselectable={max > 1}
						tabindex="-1"
						onkeydown={optionKeys}
					>
						{#each shown as ch (ch.key)}
							{@const isChosen = chosen.includes(ch.key)}
							<button
								type="button"
								role="option"
								aria-selected={isChosen}
								class="hover:bg-duvet-accent-tint focus-visible:bg-duvet-accent-tint rounded-tile flex min-h-8 w-full items-center gap-2.5 py-1.5 pr-2.5 pl-2 text-left -outline-offset-2 disabled:pointer-events-none disabled:opacity-45"
								disabled={max > 1 && !isChosen && chosen.length >= max}
								onclick={() => pick(ch.key)}
							>
								{@render choiceIcon(ch, 20)}
								<span class="flex min-w-0 flex-1 flex-col">
									<span class="text-duvet-ink truncate text-[13px] font-medium">{ch.label}</span>
									{#if ch.description}
										<span class="text-duvet-ink2 truncate text-[11px]">{ch.description}</span>
									{/if}
								</span>
								{#if max > 1}
									<span
										class="grid size-4 shrink-0 place-items-center rounded-[5px] {isChosen
											? 'bg-duvet-accent'
											: 'bg-duvet-secondary-fill shadow-[inset_0_0_0_1px_var(--duvet-line)]'}"
									>
										{#if isChosen}
											<CheckIcon class="text-duvet-on-accent size-3" />
										{/if}
									</span>
								{:else if isChosen}
									<CheckIcon class="text-duvet-accent-text shrink-0" size={15} />
								{/if}
							</button>
						{:else}
							<p class="px-2 py-2 text-[13px] text-duvet-ink2">{t("chat_select_no_results")}</p>
						{/each}
					</div>
				</Popover.Content>
			</div>
		{/if}
	</Popover.Portal>
</Popover.Root>

{#snippet choiceIcon(ch: Choice, size: number)}
	{#if ch.emoji}
		{@render emoji(ch.emoji)}
	{:else if ch.avatar !== undefined}
		<UserAvatar src={ch.avatar} name={ch.label} {size} />
	{:else if ch.key.startsWith("role:")}
		<span
			class="bg-duvet-ink2 shrink-0 rounded-full"
			style="width: {size / 2}px; height: {size / 2}px; {ch.color ? `background: ${ch.color}` : ''}"
		></span>
	{:else if ch.roomType === 2}
		<VoiceIcon class="text-duvet-ink2 shrink-0" size={size * 0.8} />
	{:else if ch.roomType === 3}
		<CategoryIcon class="text-duvet-ink2 shrink-0" size={size * 0.8} />
	{:else if ch.roomType !== undefined}
		<HashIcon class="text-duvet-ink2 shrink-0" size={size * 0.8} />
	{/if}
{/snippet}
