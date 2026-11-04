import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Which node the browser keeps in view as a page of newer messages goes in below a jump's pages (scroll anchoring) is
// the browser's choice, which no unit test sees. Firefox, and Chromium alike, chose the "newer messages below"
// indicator, which follows the page down: the reader was taken to each new page's end, about 100 messages on
// (desktop-electrobun#142, measured in headless Firefox and Chromium). This pins the indicator out of the choice.
const here = dirname(fileURLToPath(import.meta.url));
const messageList = readFileSync(join(here, "components", "MessageList.svelte"), "utf8");

describe("the newer messages indicator below a jump's pages", () => {
	it("is never the node the browser keeps in view (overflow-anchor: none)", () => {
		const indicator = messageList.match(/<div\s+data-sentinel-bottom\s+class="([^"]*)"/)?.[1];
		expect(indicator).toBeDefined();
		expect(indicator!.split(/\s+/)).toContain("[overflow-anchor:none]");
	});
});
