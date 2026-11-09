<script lang="ts">
	import { Dialog } from "bits-ui";
	import { CircleAlert as AlertIcon, X as XIcon } from "@lucide/svelte";
	import ComponentSelect from "$lib/components/ComponentSelect.svelte";
	import Emphasis from "$lib/components/Emphasis.svelte";
	import UserAvatar from "$lib/components/UserAvatar.svelte";
	import { FetchError, getApiError } from "$lib/api/api";
	import { sendModalSubmit } from "$lib/api/interactions";
	import { getHostURL } from "$lib/common/common";
	import { renderEmoji } from "$lib/emoji";
	import { customEmojiMapOf, mentionMapOf, parseTextSegments, renderMarkdown } from "$lib/markdown";
	import { initialValues, isRequired, modalAnswers, modalInputs, type ModalValue } from "$lib/modals";
	import { roomNames, spaceEmojis } from "$lib/stores.svelte";
	import { interactionModal, type OpenedModal } from "$lib/stores/interactionModal.svelte";
	import { ComponentType, type Component, type ComponentEmoji } from "$lib/types";

	// The modal a bot opened for the user (one at a time): its text displays, and its labels with their inputs (a
	// text, a select, a radio or checkbox group, a checkbox). Submit (or Enter in a one-line text) sends what was
	// entered once every field is valid, as the API checks them; while the bot answers, the fields wait, and if
	// it doesn't, the modal stays open with the reason under it. Esc, Cancel or the × closes it, which tells the
	// bot nothing.

	const host = getHostURL();
	let values = $state<Record<string, ModalValue>>({});
	let problems = $state<Record<string, string>>({});
	let sending = $state(false);
	let failure = $state<{ text: string; detail: string } | null>(null);
	let formEl = $state<HTMLFormElement | null>(null);

	// Each modal starts from what its bot gave its inputs.
	let shown: OpenedModal | null = null;
	$effect.pre(() => {
		const next = interactionModal.current;
		if (next === shown) return;
		shown = next;
		values = next ? initialValues(next.modal) : {};
		problems = {};
		failure = null;
		sending = false;
	});

	const opened = $derived(interactionModal.current);
	const inputs = $derived(opened ? modalInputs(opened.modal) : []);
	const mentionMap = $derived(mentionMapOf(opened?.members ?? []));
	const customEmojiMap = $derived(customEmojiMapOf(opened?.space ? ($spaceEmojis[opened.space.id] ?? []) : []));

	const selectTypes: number[] = [
		ComponentType.StringSelect,
		ComponentType.UserSelect,
		ComponentType.RoleSelect,
		ComponentType.MentionableSelect,
		ComponentType.RoomSelect,
	];

	// The first field, or the first one with a problem, for the focus.
	function focusField(customId?: string) {
		const field = customId
			? formEl?.querySelector<HTMLElement>(`[data-field="${CSS.escape(customId)}"]`)
			: formEl?.querySelector<HTMLElement>("[data-field]");
		field?.querySelector<HTMLElement>("input, textarea, button")?.focus();
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		const current = interactionModal.current;
		if (!current || sending) return;
		const result = modalAnswers(current.modal, values);
		if ("problems" in result) {
			problems = result.problems;
			focusField(inputs.find(({ input }) => input.custom_id! in result.problems)?.input.custom_id);
			return;
		}
		problems = {};
		failure = null;
		sending = true;
		try {
			await sendModalSubmit(current.roomId, current.applicationId, current.messageId, {
				custom_id: current.modal.custom_id,
				components: result.components,
			});
			if (interactionModal.current === current) interactionModal.close();
		} catch (err) {
			if (interactionModal.current !== current) return;
			const text =
				err instanceof FetchError && err.response?.status === 504
					? "The application did not respond"
					: "This interaction failed";
			failure = { text, detail: getApiError(err, text) };
		} finally {
			if (interactionModal.current === current) sending = false;
		}
	}

	function set(customId: string, value: ModalValue) {
		values[customId] = value;
		delete problems[customId];
	}

	function toggle(customId: string, value: string, on: boolean) {
		const chosen = (values[customId] as string[] | undefined) ?? [];
		set(customId, on ? [...chosen, value] : chosen.filter((v) => v !== value));
	}

	// A select as ComponentSelect draws it: what's chosen as its default, so that it shows it, and no minimum, so
	// that any change comes back (the modal checks the bounds when it's submitted).
	function selectOf(input: Component): Component {
		const chosen = (values[input.custom_id!] as string[] | undefined) ?? [];
		const base = { ...input, disabled: sending, min_values: 0 };
		if (input.type === ComponentType.StringSelect) {
			return { ...base, options: (input.options ?? []).map((o) => ({ ...o, default: chosen.includes(o.value) })) };
		}
		const isRole = (id: string) => !!opened?.space?.roles.some((r) => r.id === id);
		return {
			...base,
			default_values: chosen.map((id) => ({
				id,
				type:
					input.type === ComponentType.RoomSelect
						? "room"
						: input.type === ComponentType.RoleSelect || (input.type === ComponentType.MentionableSelect && isRole(id))
							? "role"
							: "user",
			})),
		};
	}

	// An input's element id, by its component id (unique in the modal): a custom_id can hold any character.
	const fieldId = (input: Component) => `modal-field-${input.id}`;
</script>

<Dialog.Root
	open={!!opened}
	onOpenChange={(o) => {
		if (!o) interactionModal.close();
	}}
>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-50 bg-black/60" />
		<!-- Its fields are 400px wide, as wide as a select gets. A click outside it doesn't close it: what was entered
		     would be lost. -->
		<Dialog.Content
			interactOutsideBehavior="ignore"
			onOpenAutoFocus={(e) => {
				e.preventDefault();
				focusField();
			}}
			class="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[calc(100%-2rem)] max-w-110.5 -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl outline-none"
		>
			{#if opened}
				<div class="flex items-start gap-3 px-5 pt-5 pb-3">
					<div class="flex min-w-0 flex-1 flex-col gap-1.5">
						<span class="flex items-center gap-1.5 text-xs text-zinc-400">
							<UserAvatar src={opened.from.avatarUrl} name={opened.from.name} size={16} />
							<span class="truncate">{opened.from.name}</span>
						</span>
						<Dialog.Title class="text-base font-semibold wrap-break-word text-white">{opened.modal.title}</Dialog.Title>
					</div>
					<Dialog.Close
						class="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
						aria-label="Close"
					>
						<XIcon class="size-5" />
					</Dialog.Close>
				</div>
				<form bind:this={formEl} onsubmit={submit} novalidate class="flex min-h-0 flex-1 flex-col">
					<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-2">
						{#each opened.modal.components as c, i (c.id ?? i)}
							{#if c.type === ComponentType.TextDisplay}
								<div class="min-w-0 text-sm wrap-break-word text-zinc-300 select-text">
									{#each parseTextSegments(c.content ?? "") as segment}
										{#if segment.type === "link"}
											<Emphasis marks={segment.emphasis}>
												<a
													href={segment.content}
													target="_blank"
													rel="noopener noreferrer"
													class="text-stone-300 hover:underline">{segment.content}</a
												>
											</Emphasis>
										{:else}
											{@html renderMarkdown(segment.content, false, mentionMap, customEmojiMap, $roomNames)}
										{/if}
									{/each}
								</div>
							{:else if c.type === ComponentType.Label && c.component?.custom_id}
								{@render field(c, c.component)}
							{/if}
						{/each}
					</div>
					<div class="flex flex-col gap-3 px-5 pt-3 pb-5">
						{#if failure}
							<div role="alert" class="flex flex-col gap-0.5 text-sm text-red-400">
								<p class="flex items-center gap-1.5">
									<AlertIcon class="size-4 shrink-0" />
									{failure.text}
								</p>
								{#if failure.detail !== failure.text}
									<p class="pl-5.5 text-xs wrap-break-word text-red-300/80">{failure.detail}</p>
								{/if}
							</div>
						{/if}
						<div class="flex justify-end gap-2">
							<Dialog.Close
								type="button"
								class="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
							>
								Cancel
							</Dialog.Close>
							<button
								type="submit"
								disabled={sending}
								aria-busy={sending}
								class="text-fixed-white relative inline-flex min-w-20 items-center justify-center rounded-md bg-indigo-500 px-4 py-1.5 text-sm font-semibold transition-colors hover:bg-indigo-600 disabled:opacity-70"
							>
								<span class={sending ? "invisible" : ""}>Submit</span>
								{#if sending}
									<!-- Waiting on the bot, as the typing indicator's dots -->
									<span class="absolute inset-0 flex items-center justify-center gap-1" aria-hidden="true">
										<span class="animate-typing-bounce block size-1.5 rounded-full bg-current"></span>
										<span class="animate-typing-bounce block size-1.5 rounded-full bg-current [animation-delay:0.2s]"
										></span>
										<span class="animate-typing-bounce block size-1.5 rounded-full bg-current [animation-delay:0.4s]"
										></span>
									</span>
								{/if}
							</button>
						</div>
					</div>
				</form>
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<!-- A label and its input, with the label's description and the field's problem under it. -->
{#snippet field(label: Component, input: Component)}
	{@const id = input.custom_id!}
	{@const problem = problems[id]}
	{@const describedBy = problem
		? `${fieldId(input)}-problem`
		: label.description
			? `${fieldId(input)}-description`
			: undefined}
	<div data-field={id} class="flex flex-col gap-1.5">
		{#if input.type === ComponentType.Checkbox}
			<label class="flex items-start gap-2.5 text-sm text-zinc-200">
				<input
					type="checkbox"
					checked={values[id] === true}
					disabled={sending}
					aria-describedby={describedBy}
					onchange={(e) => set(id, e.currentTarget.checked)}
					class="mt-0.5 size-4 shrink-0 accent-indigo-500"
				/>
				<span class="font-semibold">{label.label}</span>
			</label>
		{:else}
			<span id="{fieldId(input)}-label" class="text-sm font-semibold text-zinc-200">
				{#if input.type === ComponentType.TextInput}
					<label for={fieldId(input)}>{label.label}</label>
				{:else}
					{label.label}
				{/if}
				{#if isRequired(input)}<span class="text-red-400" aria-hidden="true">*</span>{/if}
			</span>
		{/if}
		{#if label.description}
			<p id="{fieldId(input)}-description" class="text-xs text-zinc-400">{label.description}</p>
		{/if}

		{#if input.type === ComponentType.TextInput}
			{@const cls =
				"w-full rounded-md border bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none read-only:opacity-60 focus:border-stone-500 " +
				(problem ? "border-red-500/70" : "border-zinc-700")}
			{#if input.style === 2}
				<textarea
					id={fieldId(input)}
					rows="4"
					value={String(values[id] ?? "")}
					oninput={(e) => set(id, e.currentTarget.value)}
					readonly={sending}
					placeholder={input.placeholder}
					maxlength={input.max_length}
					aria-required={isRequired(input)}
					aria-invalid={!!problem}
					aria-describedby={describedBy}
					class="{cls} resize-y"
				></textarea>
			{:else}
				<input
					id={fieldId(input)}
					type="text"
					value={String(values[id] ?? "")}
					oninput={(e) => set(id, e.currentTarget.value)}
					readonly={sending}
					placeholder={input.placeholder}
					maxlength={input.max_length}
					aria-required={isRequired(input)}
					aria-invalid={!!problem}
					aria-describedby={describedBy}
					class="h-9 {cls}"
				/>
			{/if}
		{:else if selectTypes.includes(input.type)}
			<div role="group" aria-labelledby="{fieldId(input)}-label" aria-describedby={describedBy}>
				<ComponentSelect
					component={selectOf(input)}
					space={opened?.space ?? null}
					members={opened?.members ?? []}
					{emoji}
					onSubmit={async (picked) => set(id, picked)}
				/>
			</div>
		{:else if input.type === ComponentType.RadioGroup || input.type === ComponentType.CheckboxGroup}
			{@const radio = input.type === ComponentType.RadioGroup}
			<div
				role={radio ? "radiogroup" : "group"}
				aria-labelledby="{fieldId(input)}-label"
				aria-describedby={describedBy}
				aria-required={radio ? isRequired(input) : undefined}
				class="flex flex-col gap-1 rounded-lg border bg-zinc-800/40 p-1 {problem
					? 'border-red-500/70'
					: 'border-zinc-700/60'}"
			>
				{#each input.options ?? [] as o (o.value)}
					{@const checked = radio
						? values[id] === o.value
						: ((values[id] as string[] | undefined) ?? []).includes(o.value)}
					<label
						class="flex cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 transition-colors hover:bg-zinc-800 {checked
							? 'bg-zinc-800'
							: ''}"
					>
						<input
							type={radio ? "radio" : "checkbox"}
							name={fieldId(input)}
							value={o.value}
							{checked}
							disabled={sending}
							onchange={(e) => (radio ? set(id, o.value) : toggle(id, o.value, e.currentTarget.checked))}
							class="mt-0.5 size-4 shrink-0 accent-indigo-500"
						/>
						<span class="flex min-w-0 flex-col">
							<span class="text-sm wrap-break-word text-zinc-200">{o.label}</span>
							{#if o.description}
								<span class="text-xs wrap-break-word text-zinc-400">{o.description}</span>
							{/if}
						</span>
					</label>
				{/each}
			</div>
		{/if}
		{#if problem}
			<p id="{fieldId(input)}-problem" class="text-xs text-red-400">{problem}</p>
		{/if}
	</div>
{/snippet}

<!-- An option's emoji: a space emoji by id, or a Unicode one by name. -->
{#snippet emoji(e: ComponentEmoji | undefined)}
	{#if e?.id}
		{@const custom = customEmojiMap[e.id]}
		{#if custom}
			<img
				src="{host}/attachments/{custom.attachment_id}"
				alt=":{custom.name}:"
				title=":{custom.name}:"
				class="size-5 shrink-0 object-contain"
				draggable="false"
			/>
		{/if}
	{:else if e?.name}
		<span class="shrink-0">{@html renderEmoji(e.name)}</span>
	{/if}
{/snippet}
