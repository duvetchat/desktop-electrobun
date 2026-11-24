import { getApiError } from "$lib/api/api";
import { t } from "$lib/i18n";

interface ConfirmState {
	message: string;
	confirmLabel?: string;
	onConfirm: () => Promise<void>;
	resolve: () => void;
}

class ConfirmStore {
	pending = $state<ConfirmState | null>(null);
	loading = $state(false);
	error = $state<string | null>(null);

	open(message: string, confirmLabel: string, onConfirm: () => Promise<void>): Promise<void> {
		return new Promise<void>((resolve) => {
			this.error = null;
			this.loading = false;
			this.pending = { message, confirmLabel, onConfirm, resolve };
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

export function confirmAction(message: string, confirmLabel: string, onConfirm: () => Promise<void>): Promise<void> {
	return confirmStore.open(message, confirmLabel, onConfirm);
}
