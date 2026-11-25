// XMLHttpRequest for the engine's tests: Bun has none, and the app sends every form through one (lib/api/api.ts's
// sendForm), a message with files among them. This one sends through fetch, which a test's fake API answers (useFake),
// and says its body went up in halves: the first half, then a wait a test can hold (`holdUploads`), then the rest, so
// a test cancels an upload with its bytes still going up.

/** While set, each upload stops halfway through its body until the promise it gives settles. */
let held: (() => Promise<void>) | null = null;

/** Uploads stop halfway until the promise `wait` gives settles; null lets them go at once again. */
export function holdUploads(wait: (() => Promise<void>) | null) {
	held = wait;
}

class TestXHR {
	upload: {
		onprogress?: (e: { loaded: number; total: number; lengthComputable: boolean }) => void;
		onload?: () => void;
	} = {};
	onload?: () => void;
	onerror?: () => void;
	onabort?: () => void;
	responseType = "";
	withCredentials = false;
	status = 0;
	statusText = "";
	response: ArrayBuffer | null = null;
	#method = "GET";
	#url = "";
	#headers = new Headers();
	#answerHeaders = "";
	#stop = new AbortController();
	#done = false;

	open(method: string, url: string) {
		this.#method = method;
		this.#url = url;
	}

	setRequestHeader(name: string, value: string) {
		this.#headers.set(name, value);
	}

	getAllResponseHeaders() {
		return this.#answerHeaders;
	}

	abort() {
		if (this.#done) return;
		this.#done = true;
		this.#stop.abort();
		this.onabort?.();
	}

	send(body: FormData | Blob) {
		void this.#send(body);
	}

	async #send(body: FormData | Blob) {
		const request = new Request(this.#url, { method: this.#method, headers: this.#headers, body });
		const bytes = new Uint8Array(await request.clone().arrayBuffer());
		const total = bytes.length;
		const progress = (loaded: number) => this.upload.onprogress?.({ loaded, total, lengthComputable: true });
		progress(Math.floor(total / 2));
		await held?.();
		if (this.#done) return;
		progress(total);
		this.upload.onload?.();
		let answer: Response;
		try {
			answer = await fetch(request, { signal: this.#stop.signal });
		} catch {
			if (this.#done) return;
			this.#done = true;
			this.onerror?.();
			return;
		}
		const response = await answer.arrayBuffer();
		if (this.#done) return;
		this.#done = true;
		const lines: string[] = [];
		answer.headers.forEach((value, name) => lines.push(`${name}: ${value}`));
		Object.assign(this, { status: answer.status, statusText: answer.statusText, response });
		this.#answerHeaders = lines.join("\r\n");
		this.onload?.();
	}
}

/** The tests' XMLHttpRequest, in place of the one Bun lacks. */
export function useXHR() {
	Object.assign(globalThis, { XMLHttpRequest: TestXHR });
}
