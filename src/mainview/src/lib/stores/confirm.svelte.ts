import { getApiError } from "$lib/api/api";
import { t } from "$lib/i18n";

interface ConfirmState {
	message: string;
	confirmLabel?: string;
	/** The confirm button's label while the action is on its way, its own message ("Deleting…" in some languages). */
	busyLabel?: string;
	onConfirm: () => Promise<void>;
	resolve: () => void;
}

class ConfirmStore {
	pending = $state<ConfirmState | null>(null);
	loading = $state(false);
	error = $state<string | null>(null);

	open(message: string, confirmLabel: string, onConfirm: () => Promise<void>, busyLabel?: string): Promise<void> {
		return new Promise<void>((resolve) => {
			this.error = null;
			this.loading = false;
			this.pending = { message, confirmLabel, busyLabel, onConfirm, resolve };
		});
	}

	cancel() {
		this.pending?.resolve();
		this.pending = null;
		this.loading = false;
		this.error = null;
	}

	async execute() {
		if (!this.pending) return;
		this.loading = true;
		this.error = null;
		try {
			await this.pending.onConfirm();
			this.pending.resolve();
			this.pending = null;
			this.loading = false;
		} catch (err) {
			this.error = getApiError(err, t("dialog_error_fallback"));
			this.loading = false;
		}
	}
}

export const confirmStore = new ConfirmStore();

/**
 * Asks before an action, with the confirm button's label, and its label while the action is on its way (busyLabel: a
 * message of its own, as languages word work in progress with another form of the verb; without one, the label and an
 * ellipsis, dialog_busy_label).
 */
export function confirmAction(
	message: string,
	confirmLabel: string,
	onConfirm: () => Promise<void>,
	busyLabel?: string,
): Promise<void> {
	return confirmStore.open(message, confirmLabel, onConfirm, busyLabel);
}
