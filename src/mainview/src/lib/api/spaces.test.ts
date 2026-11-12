import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { updateSpace } from "$lib/api/spaces";

// What the client sends: JSON through fetch, a form through XMLHttpRequest (Bun has none, this one stands in for the
// webview's). Only while a test of this file runs (#166).
const jsonBodies: unknown[] = [];
const forms: FormData[] = [];
class FakeXHR {
	status = 0;
	statusText = "";
	response: ArrayBuffer | null = null;
	upload = { onprogress: null, onload: null };
	onload: (() => void) | null = null;
	open() {}
	setRequestHeader() {}
	getAllResponseHeaders() {
		return "content-type: application/json\r\n";
	}
	send(body: FormData) {
		forms.push(body);
		queueMicrotask(() => {
			this.status = 200;
			this.response = new TextEncoder().encode("{}").buffer;
			this.onload?.();
		});
	}
	abort() {}
}
let fetched: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
beforeEach(() => {
	jsonBodies.length = 0;
	forms.length = 0;
	Object.assign(globalThis, { XMLHttpRequest: FakeXHR });
	fetched = spyOn(globalThis, "fetch").mockImplementation((async (
		_input: string | URL | Request,
		init?: RequestInit,
	) => {
		const body = init?.body;
		jsonBodies.push(typeof body === "string" ? JSON.parse(body) : body);
		return Response.json({});
	}) as typeof fetch);
});
afterEach(() => {
	fetched.mockRestore();
	delete (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
});

const SPACE = "01920000-0000-7000-8000-0000000000a1";

// What a Space notifies its members of until they choose: every message (0) or only mentions (1), set by its owner and
// its Administrators with the rest of its overview.
test("a Space's default notifications go in its JSON", async () => {
	await updateSpace(SPACE, { default_notifications: 0 });
	expect(jsonBodies).toEqual([{ default_notifications: 0 }]);
});

test("and in the form that carries a new icon", async () => {
	await updateSpace(SPACE, { icon: new File([new Uint8Array(4)], "icon.png"), default_notifications: 0 });
	expect(forms).toHaveLength(1);
	expect(forms[0].get("default_notifications")).toBe("0");
});
