<script lang="ts" module>
	import { writable } from "svelte/store";

	/** Whose flags and badges Duvet staff's editor opens on, as they are: a member's menu's Edit flags and badges. */
	export const userFlagsRequest = writable<{ id: string; flags: number; badges: number } | null>(null);
</script>

<script lang="ts">
	import { getApiError } from "$lib/api/api";
	import { updateUserFlagsBadges } from "$lib/api/user";
	import { BADGES, FLAGS } from "$lib/badges";
	import { toast } from "$lib/stores/toast.svelte";
	import Sheet from "$lib/components/ui/Sheet.svelte";
	import { buttonClass } from "$lib/components/ui/recipes";
	import { t } from "$lib/i18n";

	// Duvet staff's editor of a user's flags and badges, one for the app, as a member's menu asks for it
	// (userFlagsRequest): their flags and badges as switches, saved together.
	let target = $state.raw<{ id: string; flags: number; badges: number } | null>(null);
	let open = $state(false);
	let saving = $state(false);
	let flags = $state(0);
	let badges = $state(0);

	$effect(() => {
		const asked = $userFlagsRequest;
		if (!asked) return;
		userFlagsRequest.set(null);
		target = asked;
		flags = asked.flags;
		badges = asked.badges;
		open = true;
	});

	async function save() {
		if (!target || saving) return;
		saving = true;
		try {
			await updateUserFlagsBadges(target.id, { flags, badges });
			open = false;
		} catch (err) {
			toast(getApiError(err, t("people_flags_failed")), "error");
		} finally {
			saving = false;
		}
	}
</script>

{#if target}
	<Sheet
		bind:open
		title={t("people_flags_title")}
		description={t("people_flags_user", { id: target.id })}
		class="max-w-[384px]"
	>
		<fieldset class="flex flex-col gap-2">
			<legend class="text-duvet-ink2 mb-2 text-[13px] font-semibold">{t("people_flags_flags")}</legend>
			{#each FLAGS as f}
				<label class="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						checked={!!(flags & f.flag)}
						onchange={() => (flags ^= f.flag)}
						class="accent-duvet-accent"
					/>
					{f.name}
				</label>
			{/each}
		</fieldset>

		<fieldset class="flex flex-col gap-2">
			<legend class="text-duvet-ink2 mb-2 text-[13px] font-semibold">{t("people_flags_badges")}</legend>
			{#each BADGES as b}
				<label class="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						checked={!!(badges & b.flag)}
						onchange={() => (badges ^= b.flag)}
						class="accent-duvet-accent"
					/>
					{b.name}
				</label>
			{/each}
		</fieldset>

		{#snippet foot()}
			<span></span>
			<button type="button" class={buttonClass("quiet")} onclick={() => (open = false)}>{t("dialog_cancel")}</button>
			<button type="button" class={buttonClass("primary")} disabled={saving} onclick={save}>
				{saving ? t("dialog_saving") : t("dialog_save")}
			</button>
		{/snippet}
	</Sheet>
{/if}
