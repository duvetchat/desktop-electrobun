import { afterEach, describe, it, expect } from "bun:test";
import { resolveExternalHref, setupExternalLinks } from "./external-links";

// A minimal anchor stand-in: resolveExternalHref only reads getAttribute('href') and hasAttribute('download').
function anchor(href: string | null, download = false): Pick<HTMLAnchorElement, "getAttribute" | "hasAttribute"> {
	return {
		getAttribute: (name: string) => (name === "href" ? href : null),
		hasAttribute: (name: string) => name === "download" && download,
	};
}

const APP = "views://mainview";

describe("resolveExternalHref", () => {
	it("routes external http(s) links to the system browser", () => {
		expect(resolveExternalHref(anchor("https://youtube.com/watch?v=x"), APP)).toBe("https://youtube.com/watch?v=x");
		expect(resolveExternalHref(anchor("http://example.com/a"), APP)).toBe("http://example.com/a");
		// The API is a different origin from the app, so its view links open externally too.
		expect(resolveExternalHref(anchor("https://api.duvet.chat/attachments/x"), APP)).toBe(
			"https://api.duvet.chat/attachments/x",
		);
	});

	it("opens mailto: links (system mail client)", () => {
		expect(resolveExternalHref(anchor("mailto:a@b.com?subject=hi"), APP)).toBe("mailto:a@b.com?subject=hi");
	});

	it("leaves the app's own pages to the app router", () => {
		expect(resolveExternalHref(anchor("/app"), APP)).toBeNull();
		expect(resolveExternalHref(anchor("/sign-in.html?redirect=/app"), APP)).toBeNull();
		expect(resolveExternalHref(anchor("views://mainview/invite.html"), APP)).toBeNull();
		// Same reasoning for the dev origin.
		expect(resolveExternalHref(anchor("http://localhost:5173/app"), "http://localhost:5173")).toBeNull();
	});

	it("sends a download link to another origin to the browser, which Chromium would load in the window", () => {
		expect(resolveExternalHref(anchor("https://api.duvet.chat/attachments/x", true), APP)).toBe(
			"https://api.duvet.chat/attachments/x",
		);
	});

	it("leaves the app's own blob and data downloads to the webview", () => {
		expect(resolveExternalHref(anchor("blob:views://mainview/123", true), APP)).toBeNull();
		expect(resolveExternalHref(anchor("data:text/plain,hi", true), APP)).toBeNull();
	});

	it("never launches a non-http(s) scheme", () => {
		expect(resolveExternalHref(anchor("javascript:alert(1)"), APP)).toBeNull();
		expect(resolveExternalHref(anchor("file:///etc/passwd"), APP)).toBeNull();
		expect(resolveExternalHref(anchor("data:text/html,<script>1</script>"), APP)).toBeNull();
		expect(resolveExternalHref(anchor(null), APP)).toBeNull();
		expect(resolveExternalHref(anchor(""), APP)).toBeNull();
	});
});

describe("setupExternalLinks", () => {
	// What it reads of a click's target: the link around it.
	class FakeElement {
		constructor(private link: ReturnType<typeof anchor>) {}
		closest() {
			return this.link;
		}
	}

	// What it reads of a click.
	interface Click {
		target: FakeElement;
		button: number;
		defaultPrevented: boolean;
		shiftKey: boolean;
		altKey: boolean;
		preventDefault: () => void;
	}

	afterEach(() => {
		for (const name of ["window", "location", "Element"]) Reflect.deleteProperty(globalThis, name);
	});

	/** The window, with the listeners it was given, and a way to click: what went to the browser, and whether the
	 * webview's own action was stopped. */
	function setup(windowProps: object = { __electrobunWindowId: 1 }) {
		const listeners = new Map<string, (event: Click) => void>();
		const addEventListener = (type: string, listener: (event: Click) => void, capture: boolean) => {
			expect(capture).toBe(true);
			listeners.set(type, listener);
		};
		const values = { window: { ...windowProps, addEventListener }, location: { origin: APP }, Element: FakeElement };
		for (const [name, value] of Object.entries(values)) {
			Object.defineProperty(globalThis, name, { value, configurable: true });
		}
		const opened: string[] = [];
		setupExternalLinks((url) => opened.push(url));
		const fire = (type: string, href: string, init: Partial<Click> = {}, download = false) => {
			opened.length = 0;
			let prevented = false;
			listeners.get(type)?.({
				target: new FakeElement(anchor(href, download)),
				button: 0,
				defaultPrevented: false,
				shiftKey: false,
				altKey: false,
				preventDefault: () => (prevented = true),
				...init,
			});
			return { opened: [...opened], prevented };
		};
		return { fire, listeners };
	}

	const EXTERNAL = "https://example.com/a";

	it("sends a plain click on an external link to the browser", () => {
		const { fire } = setup();
		expect(fire("click", EXTERNAL)).toEqual({ opened: [EXTERNAL], prevented: true });
	});

	it("sends Shift, Alt and middle clicks there too, which would open a second window or do nothing", () => {
		const { fire } = setup();
		expect(fire("click", EXTERNAL, { shiftKey: true })).toEqual({ opened: [EXTERNAL], prevented: true });
		expect(fire("click", EXTERNAL, { altKey: true })).toEqual({ opened: [EXTERNAL], prevented: true });
		expect(fire("auxclick", EXTERNAL, { button: 1 })).toEqual({ opened: [EXTERNAL], prevented: true });
	});

	it("leaves the other buttons alone: the right one opens the context menu", () => {
		const { fire } = setup();
		expect(fire("auxclick", EXTERNAL, { button: 2 })).toEqual({ opened: [], prevented: false });
		expect(fire("auxclick", EXTERNAL, { button: 3 })).toEqual({ opened: [], prevented: false });
	});

	it("leaves a plain click on the app's own link to its router", () => {
		const { fire } = setup();
		expect(fire("click", "/sign-up")).toEqual({ opened: [], prevented: false });
	});

	it("opens no second window for the app's own link", () => {
		const { fire } = setup();
		expect(fire("click", "/sign-up", { shiftKey: true })).toEqual({ opened: [], prevented: true });
		expect(fire("auxclick", "/sign-up", { button: 1 })).toEqual({ opened: [], prevented: true });
	});

	it("leaves a download link to the webview, whichever way it's clicked", () => {
		const { fire } = setup();
		const blob = "blob:views://mainview/123";
		expect(fire("click", blob, {}, true)).toEqual({ opened: [], prevented: false });
		expect(fire("click", blob, { shiftKey: true }, true)).toEqual({ opened: [], prevented: false });
		expect(fire("auxclick", blob, { button: 1 }, true)).toEqual({ opened: [], prevented: false });
	});

	it("leaves a click the page already took", () => {
		const { fire } = setup();
		expect(fire("click", EXTERNAL, { defaultPrevented: true })).toEqual({ opened: [], prevented: false });
	});

	it("does nothing in the web build", () => {
		const { listeners } = setup({});
		expect(listeners.size).toBe(0);
	});
});
