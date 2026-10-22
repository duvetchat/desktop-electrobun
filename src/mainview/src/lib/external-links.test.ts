import { describe, it, expect } from "bun:test";
import { resolveExternalHref } from "./external-links";

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
