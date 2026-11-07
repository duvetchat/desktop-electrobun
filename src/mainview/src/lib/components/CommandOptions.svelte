<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import { SvelteMap } from "svelte/reactivity";
	import { CircleAlert as AlertIcon, X as XIcon } from "@lucide/svelte";
	import ComponentSelect from "$lib/components/ComponentSelect.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { FetchError, getApiError } from "$lib/api/api";
	import type { CommandUse } from "$lib/api/interactions";
	import { commandUse, usedOptions, type CommandEntry, type FieldValue } from "$lib/commands";
	import { getAvatarURL } from "$lib/common/common";
	import {
		CommandOptionType,
		ComponentType,
		type CommandOption,
		type Component,
		type GatewaySpace,
		type MemberOnSidebar,
		type SpaceCommandApplication,
	} from "$lib/types";

	// The message box in command mode: what was picked from the "/" menu (a command, or one of its subcommands),
	// with a field for each of its options, in its order. Enter sends it once the required ones are there and every
	// value is valid; while the bot answers, the fields wait (read-only, so the focus stays and a failure can be
	// retried with Enter), and if it doesn't, the command keeps its values, with the reason below. Esc, the
	// command's ×, or Backspace in an empty first field goes back to the message box.
	let {
		entry,
		app,
		space = null,
		members = [],
		onSend,
		onExit,
	}: {
		entry: CommandEntry;
		app: SpaceCommandApplication;
		space?: GatewaySpace | null;
		members?: MemberOnSidebar[];
		onSend: (data: CommandUse) => Promise<unknown>;
		onExit: () => void;
	} = $props();

	// By option name, in a map: every plain object already has a constructor and a __proto__, which an
	// option may be named.
	const fields = new SvelteMap<string, FieldValue>();
	let sending = $state(false);
	// Why the command wasn't sent, or what its interaction answered.
	let notice = $state<{ text: string; detail: string } | null>(null);
	let rowEl = $state<HTMLDivElement>(null!);

	const botName = $derived(app.bot.alias ?? app.bot.username);

	// Left (the user went to another chat, which ends a command) before the bot answered: its answer closes nothing
	// there.
	let gone = false;
	onDestroy(() => (gone = true));

	onMount(() => {
		// The first field, or the row of a command without options, so that Enter and Esc reach it.
		(rowEl.querySelector<HTMLElement>("[data-option] input, [data-option] button") ?? rowEl).focus();
	});

	async function send() {
		if (sending) return;
		const used = usedOptions(entry, fields);
		if ("problem" in used) {
			notice = { text: used.problem, detail: used.problem };
			return;
		}
		sending = true;
		notice = null;
		try {
			await onSend(commandUse(entry, used.options));
			if (!gone) onExit();
		} catch (err) {
			const text =
				err instanceof FetchError && err.response?.status === 504
					? "The application did not respond"
					: "This interaction failed";
			notice = { text, detail: getApiError(err, text) };
		} finally {
			sending = false;
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		// While an IME composes, keys are its own: an Enter picks its text, an Esc drops it.
		if (e.isComposing) return;
		const target = e.target as HTMLElement;
		if (e.key === "Escape") {
			e.preventDefault();
			onExit();
		} else if (e.key === "Enter" && !e.shiftKey && target.tagName !== "BUTTON") {
			e.preventDefault();
			send();
		} else if (
			e.key === "Backspace" &&
			((target === rowEl && entry.options.length === 0) ||
				(target instanceof HTMLInputElement &&
					!target.readOnly &&
					target.value === "" &&
					target.closest("[data-option]") === rowEl.querySelector("[data-option]")))
		) {
			e.preventDefault();
			onExit();
		}
	}

	const selectTypes: Partial<Record<number, ComponentType>> = {
		[CommandOptionType.User]: ComponentType.UserSelect,
		[CommandOptionType.Room]: ComponentType.RoomSelect,
		[CommandOptionType.Role]: ComponentType.RoleSelect,
		[CommandOptionType.Mentionable]: ComponentType.MentionableSelect,
	};

	// The select of an option with choices, of an optional boolean (true, false, or not given), or of members,
	// roles or rooms: a message's, with what's chosen as its default, so that it shows it.
	function selectOf(o: CommandOption): Component {
		const v = fields.get(o.name);
		const base = { custom_id: o.name, placeholder: o.description, disabled: sending, min_values: 1, max_values: 1 };
		if (o.type === CommandOptionType.Boolean) {
			return {
				...base,
				type: ComponentType.StringSelect,
				options: [
					{ label: "True", value: "true", default: v === true },
					{ label: "False", value: "false", default: v === false },
				],
			};
		}
		if (o.choices?.length) {
			// A bot's choices can repeat a value (1 and 1.0 are both 1); the select takes each once.
			const choices = o.choices.filter(
				(ch, i, all) => all.findIndex((other) => String(other.value) === String(ch.value)) === i,
			);
			return {
				...base,
				type: ComponentType.StringSelect,
				options: choices.map((ch) => ({ label: ch.name, value: String(ch.value), default: ch.value === v })),
			};
		}
		const id = typeof v === "string" ? v : undefined;
		const isRole =
			o.type === CommandOptionType.Role ||
			(o.type === CommandOptionType.Mentionable && !!space?.roles.some((r) => r.id === id));
		return {
			...base,
			type: selectTypes[o.type] ?? ComponentType.UserSelect,
			room_types: o.room_types,
			default_values: id ? [{ id, type: o.type === CommandOptionType.Room ? "room" : isRole ? "role" : "user" }] : [],
		};
	}

	// A select's pick: a boolean, a choice's value as the command has it, or the member's, role's or room's ID.
	function choose(o: CommandOption, picked: string) {
		if (o.type === CommandOptionType.Boolean) fields.set(o.name, picked === "true");
		else fields.set(o.name, o.choices?.find((ch) => String(ch.value) === picked)?.value ?? picked);
	}

	const isText = (o: CommandOption) =>
		!o.choices?.length &&
		(o.type === CommandOptionType.String ||
			o.type === CommandOptionType.Integer ||
			o.type === CommandOptionType.Number);
</script>

<div class="pointer-events-auto flex min-w-0 flex-1 flex-col gap-1">
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		bind:this={rowEl}
		role="group"
		aria-label="/{entry.name}"
		tabindex="-1"
		onkeydown={handleKeyDown}
		class="bg-night-22/80 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] outline-none"
	>
		<span
			class="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-indigo-500/15 pr-1 pl-2 text-sm font-semibold text-indigo-200"
			title={entry.description}
		>
			<UserAvatar src={getAvatarURL(app.bot.id, app.bot.avatar)} name={botName} size={16} />
			/{entry.name}
			<button
				type="button"
				class="rounded p-0.5 text-indigo-300 transition-colors hover:bg-indigo-500/20 hover:text-white"
				aria-label="Cancel command"
				onclick={onExit}
			>
				<XIcon class="size-3.5" />
			</button>
		</span>
		{#each entry.options as o (o.name)}
			<!-- A label, so that a click on the option's name goes to its field -->
			<label data-option class="flex items-center gap-1.5" title={o.description}>
				<span class="text-xs font-medium text-zinc-400"
					>{o.name}{#if o.required}<span class="text-red-400" aria-hidden="true">*</span>{/if}</span
				>
				{#if o.type === CommandOptionType.Boolean && o.required}
					<!-- A required one always has a value: off until it's turned on -->
					{@const on = fields.get(o.name) === true}
					<button
						type="button"
						role="switch"
						aria-checked={on}
						aria-label={o.name}
						disabled={sending}
						onclick={() => fields.set(o.name, !on)}
						class="relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 {on
							? 'bg-indigo-500'
							: 'bg-zinc-600'}"
					>
						<span
							class="bg-fixed-white absolute top-0.5 left-0.5 size-4 rounded-full transition-transform {on
								? 'translate-x-4'
								: ''}"
						></span>
					</button>
				{:else if isText(o)}
					<input
						value={String(fields.get(o.name) ?? "")}
						oninput={(e) => fields.set(o.name, e.currentTarget.value)}
						readonly={sending}
						placeholder={o.description}
						aria-label={o.name}
						inputmode={o.type === CommandOptionType.Integer
							? "numeric"
							: o.type === CommandOptionType.Number
								? "decimal"
								: undefined}
						class="h-8 w-44 rounded-md border border-zinc-700 bg-zinc-900/60 px-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 read-only:opacity-50 focus:border-zinc-500"
					/>
				{:else}
					<div class="w-52">
						<ComponentSelect
							component={selectOf(o)}
							{space}
							{members}
							{emoji}
							onSubmit={async (picked) => choose(o, picked[0])}
						/>
					</div>
				{/if}
			</label>
		{/each}
		{#if sending}
			<!-- Waiting on the bot, as the typing indicator's dots -->
			<span class="flex items-center gap-1 text-zinc-400" aria-label="Waiting for the application">
				<span class="animate-typing-bounce block size-1.5 rounded-full bg-current"></span>
				<span class="animate-typing-bounce block size-1.5 rounded-full bg-current [animation-delay:0.2s]"></span>
				<span class="animate-typing-bounce block size-1.5 rounded-full bg-current [animation-delay:0.4s]"></span>
			</span>
		{/if}
	</div>
	{#if notice}
		<p role="alert" class="flex items-center gap-1.5 px-1 text-sm text-red-400" title={notice.detail}>
			<AlertIcon class="size-4 shrink-0" />
			{notice.text}
		</p>
	{/if}
</div>

<!-- Command choices have no emojis. -->
{#snippet emoji()}{/snippet}
