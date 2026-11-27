import { describe, expect, test } from "bun:test";
import { render } from "svelte/server";
import { tags } from "./components/server-render";

// duvet.chat/download (routes/download, #456, #590): where people get the desktop app, and where Download update sends
// an app Bun can't update in place. Its installers are the rolling desktop-stable release's, as release.yml publishes
// each system's.
const { default: Download } = await import("../routes/download/+page.svelte");
const RELEASE = "https://github.com/duvetchat/releases/releases/download/desktop-stable";

describe("the download page", () => {
	test("links the Windows and the Linux installers the release publishes", async () => {
		const links = (await tags(Download, {})).filter((tag) => tag.name === "a");
		expect(links.map((link) => link.attributes.href)).toEqual([
			`${RELEASE}/stable-win-x64-Duvet-Setup.zip`,
			`${RELEASE}/stable-linux-x64-Duvet-Setup.tar.gz`,
		]);
		const html = render(Download, { props: {} }).body;
		expect(html).toContain("Download for Windows");
		expect(html).toContain("Download for Linux");
		expect(html).toContain("macOS and Android are on their way.");
	});
});
