interface ToastItem {
	id: number;
	message: string;
	type: "error" | "success" | "info";
}

class ToastStore {
	items = $state<ToastItem[]>([]);
	private nextId = 0;

	add(message: string, type: "error" | "success" | "info" = "info", duration = 4000) {
		const id = this.nextId++;
		this.items = [...this.items, { id, message, type }];
		setTimeout(() => {
			this.items = this.items.filter((t) => t.id !== id);
		}, duration);
	}

	dismiss(id: number) {
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toastStore = new ToastStore();

export function toast(message: string, type: "error" | "success" | "info" = "info", duration = 4000) {
	toastStore.add(message, type, duration);
}
