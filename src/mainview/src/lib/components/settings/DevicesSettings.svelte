<script module lang="ts">
	import { FetchError, getApiError } from "$lib/api/api";
	import type { Device } from "$lib/api/e2e";
	import { CoreError } from "$lib/e2e/errors";
	import { onlyDevice } from "$lib/e2e/engine/devices";
	import type { BackupShown, EngineState } from "$lib/e2e/engine/engine";
	import { t } from "$lib/i18n";
	import { formatList, formatNumber } from "$lib/i18n/format";
	import { confirmAction } from "$lib/stores/confirm.svelte";

	/**
	 * What Settings takes of the page's encryption engine (lib/e2e/engine.svelte.ts), which only the app's own page has:
	 * the page that mounts Settings as a sheet hands it in, and a window of its own has none (nor its devices).
	 */
	export interface DevicesEngine {
		readonly encryption: { readonly state: EngineState };
		removeDevice(deviceId: string, changeKeys: boolean): Promise<void>;
		changeKeys(): Promise<void>;
		/** What an earlier removal that never went up takes along with the next list or change of keys. */
		alsoRemoved(): Promise<string[]>;
		removeThisDevice(): Promise<void>;
	}

	/** The sentence naming the devices an earlier removal takes along (M3), by name, or none. */
	function alongLine(along: readonly string[], devices: readonly Device[] | null): string | null {
		if (along.length === 0) return null;
		const names = along.map((id) => devices?.find((device) => device.id === id)?.name ?? id.slice(0, 8));
		return t("e2e_device_remove_along", { names: formatList(names) });
	}

	/**
	 * What the removal of a device says beside its question: the start of its ID, as Bun's own box names it in full
	 * (M7), and the devices an earlier removal takes along (M3).
	 */
	export function removalNotes(device: Device, along: readonly string[], devices: readonly Device[] | null): string[] {
		const line = alongLine(along, devices);
		return [t("e2e_device_id_start", { id: device.id.slice(0, 8) }), ...(line ? [line] : [])];
	}

	/**
	 * What a removal that failed says: while a device this one approved sets up, why it waits; the API's refusal of a
	 * list naming a device this one approved that never finished (task 26's I1), in words; anything else, the API's.
	 */
	export function removalProblem(error: unknown): string {
		if (error instanceof CoreError && error.code === "approval_waits") return t("e2e_approval_waits");
		const refusal: unknown = error instanceof FetchError ? error.response?.data?.error : undefined;
		if (typeof refusal === "string" && /has no certificate of this identity/.test(refusal)) {
			return t("e2e_device_unfinished");
		}
		return getApiError(error, t("e2e_device_action_failed"));
	}

	/** Asks before changing the keys, naming the devices an earlier removal takes along (M3). */
	export function askToChangeKeys(
		devices: readonly Device[] | null,
		along: readonly string[],
		run: () => Promise<void>,
	): Promise<void> {
		const line = alongLine(along, devices);
		const message = line ? `${t("e2e_change_keys_confirm")} ${line}` : t("e2e_change_keys_confirm");
		return confirmAction(message, t("e2e_change_keys"), run);
	}

	/**
	 * What Settings says of the encrypted backup (Task 32): how far a new device's restore went, a pause and why, days
	 * going up, or else that it's up to date.
	 */
	export function backupLine(backup: BackupShown | undefined): string {
		if (backup?.state === "restoring") {
			return t("e2e_backup_restoring", { done: formatNumber(backup.done), total: formatNumber(backup.total) });
		}
		if (backup?.state === "paused") return t(backup.reason === "full" ? "e2e_backup_paused" : "e2e_backup_too_large");
		return t(backup?.state === "uploading" ? "e2e_backup_uploading" : "e2e_backup_up_to_date");
	}

	/**
	 * Asks before this device's data goes (decision 13), saying what's lost: on the user's only listed device, what only
	 * the recovery key brings back; on one listed beside others, that it stays on that list until another takes it off.
	 * Without the list, it asks the most careful way.
	 */
	export function askToDeleteThisDevice(devices: readonly Device[] | null, run: () => Promise<void>): Promise<void> {
		const own = devices?.find(({ current }) => current);
		const key =
			!devices || onlyDevice(devices)
				? "e2e_delete_only_device_confirm"
				: own?.listed
					? "e2e_delete_listed_device_confirm"
					: "e2e_delete_device_confirm";
		return confirmAction(t(key), t("e2e_delete_device"), run);
	}
</script>

<script lang="ts">
	import {
		ArchiveRestore as BackupIcon,
		KeyRound as KeyIcon,
		MonitorSmartphone as DeviceIcon,
		Trash2 as TrashIcon,
		TriangleAlert as WarningIcon,
	} from "@lucide/svelte";
	import Button from "$lib/components/ui/Button.svelte";
	import Dialog from "$lib/components/ui/Dialog.svelte";
	import { hasDeviceData, inactiveDevice } from "$lib/e2e/engine/devices";
	import { formatDate } from "$lib/i18n/format";
	import { calloutClass, CHECKBOX, NOTE, ROW_TILE, rowClass, TAG } from "./recipes";
	import SettingsGroup from "./SettingsGroup.svelte";
	import SettingsRow from "./SettingsRow.svelte";

	// Settings → Devices (PLAN-E2E-CLIENTES.md, Task 24; decisions 13 and 52): the user's devices, as the API lists them,
	// each one's client and when it was last seen, this one and those not seen in 45 days marked. On a device that's
	// ready, another one can be taken off the account, with new keys for one that was lost, and the keys changed; this
	// one's data can be deleted wherever it has some. Each act asks first; on the desktop, Bun asks again in its own box.
	// A ready device says how its encrypted backup is (Task 32): up to date, going up, restoring, or paused and why.
	let {
		devices,
		failed = false,
		encryption,
		web,
		storageKept = null,
		now = Date.now(),
		onReload,
		onRemove,
		onChangeKeys,
		onAlsoRemoved = async () => [],
		onRemoveThis,
	}: {
		/** The user's devices, null until they're read. */
		devices: Device[] | null;
		/** The list couldn't be read. */
		failed?: boolean;
		encryption: EngineState;
		/** The web app, whose browser may not keep this device's data. */
		web: boolean;
		/** Whether the browser agreed to keep this device's data (navigator.storage.persisted), null untold. */
		storageKept?: boolean | null;
		now?: number;
		onReload: () => void;
		onRemove: (deviceId: string, changeKeys: boolean) => Promise<void>;
		/** Also Finish, for a change that waits. */
		onChangeKeys: () => Promise<void>;
		/** What an earlier removal that never went up takes along with the next one. */
		onAlsoRemoved?: () => Promise<string[]>;
		onRemoveThis: () => Promise<void>;
	} = $props();

	// A device this one approved, until its own list is up: a list or new keys meanwhile would leave it out (Task 26).
	const approving = $derived(encryption.name === "ready" && encryption.approval?.step === "confirmed");
	// A list, or new keys, only from a device with the user's identity, and not while new keys wait to be saved, nor
	// while a device it approved sets up.
	const ready = $derived(encryption.name === "ready" && !encryption.rotation && !approving);
	const hasData = $derived(hasDeviceData(encryption));

	// A change of keys that waits, with no key on screen (which is its dialog's): Finish, or why it can't (M1, I1).
	const waiting = $derived(
		encryption.name === "ready" && encryption.rotation && !encryption.rotation.recoveryKey ? encryption.rotation : null,
	);

	let removing = $state<Device | null>(null);
	let along = $state<string[]>([]);
	let lost = $state(false);
	let busy = $state(false);
	let failure = $state<string | null>(null);

	/** What an earlier removal takes along, or none when it can't be told. */
	const readAlong = () =>
		onAlsoRemoved().catch((error: unknown) => {
			console.error("[e2e] What an earlier removal takes along wasn't read:", error);
			return [];
		});

	function askToRemove(device: Device) {
		removing = device;
		along = [];
		lost = false;
		failure = null;
		void readAlong().then((ids) => {
			if (removing === device) along = ids.filter((id) => id !== device.id);
		});
	}

	async function askToChange() {
		await askToChangeKeys(devices, await readAlong(), onChangeKeys);
	}

	async function remove() {
		const device = removing;
		if (!device || busy) return;
		busy = true;
		failure = null;
		try {
			await onRemove(device.id, lost && device.listed);
			removing = null;
		} catch (error) {
			failure = removalProblem(error);
		} finally {
			busy = false;
		}
	}
</script>

{#if encryption.name === "unsupported"}
	<p class={calloutClass("info")}>{web ? t("e2e_unsupported_browser") : t("e2e_no_e2e_here")}</p>
{:else}
	<p class={NOTE}>{t("e2e_devices_lead")}</p>
	{#if web && storageKept === false}
		<div class="{calloutClass('warn')} items-center">
			<WarningIcon size={18} class="shrink-0" aria-hidden="true" />
			<p>{t("e2e_storage_not_kept")}</p>
		</div>
	{/if}

	<SettingsGroup title={t("e2e_devices")}>
		{#if devices}
			{#each devices as device (device.id)}
				<div class={rowClass()}>
					<span class={ROW_TILE} aria-hidden="true"><DeviceIcon size={18} /></span>
					<div class="min-w-0 flex-1">
						<p class="text-duvet-ink flex flex-wrap items-center gap-1.5 text-[14.5px] leading-[1.35] font-medium">
							<span class="min-w-0 truncate">{device.name}</span>
							{#if device.current}
								<span class="{TAG} bg-duvet-accent-tint text-duvet-ink">{t("e2e_this_device")}</span>
							{/if}
							{#if !device.listed}
								<span class="{TAG} bg-duvet-secondary-fill text-duvet-ink2">{t("e2e_device_not_set_up")}</span>
							{/if}
							{#if !device.current && inactiveDevice(device, now)}
								<span class="{TAG} bg-duvet-warn/10 text-duvet-warn">{t("e2e_inactive_device")}</span>
							{/if}
						</p>
						<p class="text-duvet-ink2 mt-1 text-[13px] leading-[1.45]">
							{t("e2e_device_seen", {
								client: device.client,
								date: formatDate(Date.parse(device.last_seen_at), { dateStyle: "medium" }),
							})}
						</p>
					</div>
					{#if ready && !device.current}
						<Button variant="secondary" size="sm" onclick={() => askToRemove(device)}>{t("e2e_device_remove")}</Button>
					{/if}
				</div>
			{/each}
		{:else if failed}
			<div class={rowClass()}>
				<p class="text-duvet-ink2 min-w-0 flex-1 text-[13.5px]" role="alert">{t("e2e_devices_failed")}</p>
				<Button variant="secondary" size="sm" onclick={onReload}>{t("e2e_try_again")}</Button>
			</div>
		{:else}
			<div class={rowClass()}>
				<p class="text-duvet-ink2 text-[13.5px]">{t("e2e_devices_loading")}</p>
			</div>
		{/if}
	</SettingsGroup>

	{#if approving}
		<p class={NOTE} role="status">{t("e2e_approval_waits")}</p>
	{/if}

	{#if encryption.name === "ready"}
		<SettingsGroup>
			<SettingsRow label={t("e2e_backup")} line={backupLine(encryption.backup)} icon={BackupIcon} />
		</SettingsGroup>
	{/if}

	{#if ready || hasData || waiting}
		<SettingsGroup>
			{#if waiting?.stuck}
				<SettingsRow label={t("e2e_change_keys")} line={t("e2e_rotation_stuck")} icon={KeyIcon} />
			{:else if waiting}
				<SettingsRow label={t("e2e_finish_keys")} icon={KeyIcon}>
					<Button size="sm" onclick={() => void onChangeKeys()}>{t("e2e_finish")}</Button>
				</SettingsRow>
			{/if}
			{#if ready}
				<SettingsRow label={t("e2e_change_keys")} line={t("e2e_change_keys_line")} icon={KeyIcon}>
					<Button variant="secondary" size="sm" onclick={() => void askToChange()}>
						{t("e2e_change_keys")}
					</Button>
				</SettingsRow>
			{/if}
			{#if hasData}
				<SettingsRow label={t("e2e_delete_device")} line={t("e2e_delete_device_line")} icon={TrashIcon}>
					<Button variant="danger" size="sm" onclick={() => askToDeleteThisDevice(devices, onRemoveThis)}>
						{t("e2e_delete_device")}
					</Button>
				</SettingsRow>
			{/if}
		</SettingsGroup>
	{/if}
{/if}

<Dialog
	open={removing !== null}
	onOpenChange={(open) => {
		if (!open && !busy) removing = null;
	}}
	title={removing ? t("e2e_device_remove_title", { name: removing.name }) : ""}
	escapeKeydownBehavior={busy ? "ignore" : "close"}
>
	{t("e2e_device_remove_text")}
	{#snippet body()}
		{#if removing}
			{#each removalNotes(removing, along, devices) as note (note)}
				<p class="text-duvet-ink2 font-content text-[13.5px] leading-[1.4]">{note}</p>
			{/each}
		{/if}
		{#if removing?.listed}
			<label class="text-duvet-ink flex items-start gap-2.5 text-[13.5px] leading-[1.45]">
				<input type="checkbox" bind:checked={lost} disabled={busy} class="{CHECKBOX} mt-0.5" />
				<span>
					{t("e2e_device_lost")}
					<span class="text-duvet-ink2 block">{t("e2e_device_lost_note")}</span>
				</span>
			</label>
		{/if}
		{#if failure}
			<p class="text-duvet-danger text-[13px]" role="alert">{failure}</p>
		{/if}
	{/snippet}
	{#snippet actions()}
		<Button variant="quiet" disabled={busy} onclick={() => (removing = null)}>{t("e2e_cancel")}</Button>
		<Button variant="danger" disabled={busy} onclick={() => void remove()}>{t("e2e_device_remove")}</Button>
	{/snippet}
</Dialog>
