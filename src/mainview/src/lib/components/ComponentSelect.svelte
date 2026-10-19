<script lang="ts">
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
	import {
		ComponentType,
		type Component,
		type ComponentEmoji,
		type GatewaySpace,
		type MemberOnSidebar,
	} from "$lib/types";

	// A message's select menu: its own options, or the space's members, roles or rooms, with its defaults
	// chosen. Choosing only changes what it shows for now, as there are no interactions to send.
	let {
		component: c,
		space = null,
		members = [],
		emoji,
	}: {
		component: Component;
		space?: GatewaySpace | null;
		members?: MemberOnSidebar[];
		emoji: Snippet<[ComponentEmoji | undefined]>;
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
		return [...(space?.rooms ?? [])]
			.filter((r) => !r.deleted_at && (!c.room_types?.length || c.room_types.includes(r.type)))
			.sort((a, b) => a.position - b.position)
			.map((r) => ({ key: `room:${r.id}`, label: r.name, roomType: r.type }));
	});

	const max = $derived(c.max_values ?? 1);
	const searchable = $derived(c.type !== ComponentType.StringSelect);

	// What's chosen, by choice key: the defaults until something is picked.
	function defaults(): string[] {
		if (c.type === ComponentType.StringSelect) {
			return (c.options ?? []).filter((o) => o.default).map((o) => `option:${o.value}`);
		}
		return (c.default_values ?? []).map((d) => `${d.type}:${d.id}`);
	}
	let chosen = $state<string[]>(defaults());
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
		} else if (chosen.includes(key)) {
			chosen = chosen.filter((k) => k !== key);
		} else if (chosen.length < max) {
			chosen = [...chosen, key];
		}
	}
</script>

<Popover.Root
	bind:open
	onOpenChange={(o) => {
		if (!o) query = "";
	}}
>
	<Popover.Trigger
		disabled={c.disabled}
		class="flex min-h-10 w-full max-w-100 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-left text-sm transition-colors outline-none hover:border-zinc-600 disabled:pointer-events-none disabled:opacity-50"
	>
		<span class="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
			{#if chosenChoices.length === 0}
				<span class="truncate text-zinc-400">{c.placeholder || "Make a selection"}</span>
			{:else}
				{#each chosenChoices as ch, i}
					{@render choiceIcon(ch, 16)}
					<span class="truncate text-zinc-100">{ch.label}{i < chosenChoices.length - 1 ? "," : ""}</span>
				{/each}
			{/if}
		</span>
		<ChevronDownIcon class="size-4 shrink-0 text-zinc-400 transition-transform {open ? 'rotate-180' : ''}" />
	</Popover.Trigger>
	<Popover.Portal>
		<Popover.Content
			side="bottom"
			align="start"
			sideOffset={4}
			class="z-80 flex max-h-80 w-(--bits-popover-anchor-width) flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
		>
			{#if searchable}
				<input
					bind:value={query}
					placeholder="Search"
					class="m-2 rounded-md bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
				/>
			{/if}
			<div class="overflow-y-auto py-1">
				{#each shown as ch (ch.key)}
					{@const isChosen = chosen.includes(ch.key)}
					<button
						type="button"
						class="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-50"
						disabled={max > 1 && !isChosen && chosen.length >= max}
						onclick={() => pick(ch.key)}
					>
						{@render choiceIcon(ch, 20)}
						<span class="flex min-w-0 flex-1 flex-col">
							<span class="truncate text-sm {isChosen ? 'text-white' : 'text-zinc-200'}">{ch.label}</span>
							{#if ch.description}
								<span class="truncate text-xs text-zinc-400">{ch.description}</span>
							{/if}
						</span>
						{#if max > 1}
							<span
								class="flex size-4 shrink-0 items-center justify-center rounded border {isChosen
									? 'border-indigo-500 bg-indigo-500'
									: 'border-zinc-500'}"
							>
								{#if isChosen}
									<CheckIcon class="size-3 text-white" />
								{/if}
							</span>
						{:else if isChosen}
							<CheckIcon class="size-4 shrink-0 text-indigo-400" />
						{/if}
					</button>
				{:else}
					<p class="px-3 py-2 text-sm text-zinc-500">No results</p>
				{/each}
			</div>
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>

{#snippet choiceIcon(ch: Choice, size: number)}
	{#if ch.emoji}
		{@render emoji(ch.emoji)}
	{:else if ch.avatar !== undefined}
		<UserAvatar src={ch.avatar} name={ch.label} {size} />
	{:else if ch.key.startsWith("role:")}
		<span
			class="shrink-0 rounded-full bg-zinc-400"
			style="width: {size / 2}px; height: {size / 2}px; {ch.color ? `background: ${ch.color}` : ''}"
		></span>
	{:else if ch.roomType === 2}
		<VoiceIcon class="shrink-0 text-zinc-400" size={size * 0.8} />
	{:else if ch.roomType === 3}
		<CategoryIcon class="shrink-0 text-zinc-400" size={size * 0.8} />
	{:else if ch.roomType !== undefined}
		<HashIcon class="shrink-0 text-zinc-400" size={size * 0.8} />
	{/if}
{/snippet}
