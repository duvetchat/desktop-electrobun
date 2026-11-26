import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A conversation's history shared with a member (PLAN-E2E-CLIENTES.md, Task 30): one dialog for the app, opened from a
// member's menu in a conversation, which shares only on its Share, as far back as the person picked; what it says
// after is lib/e2e/sharing.ts' (sharing.test.ts).
const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8").replaceAll("\r\n", "\n");

describe("the share history dialog", () => {
	test("is one dialog for the app, which a member's menu in a conversation opens", () => {
		expect(source("../../../routes/app/+page.svelte")).toContain("<ShareHistoryDialog />");
		const menu = source("../MemberMenu.svelte");
		expect(menu).toContain("shareHistoryRequest.set(shared)");
		expect(menu).toContain('{t("e2e_share_history")}');
		// Lists of a conversation hand the menu their conversation; a Space's hand none.
		expect(source("../MemberList.svelte")).toContain("conversationId={space ? null : channelId}");
		expect(source("../MessageList.svelte")).toContain("conversationId={isConversation ? channelId : null}");
	});

	test("offers the four ranges, and shares on Share alone, with the one picked", () => {
		const dialog = source("ShareHistoryDialog.svelte");
		expect(dialog).toMatch(/\{#each SHARE_RANGES as option \(option\)\}/);
		expect(dialog).toContain("{t(RANGE_WORDS[option])}");
		expect(dialog).toContain("await shareHistory(conversationId, userId, range)");
		expect(dialog.match(/shareHistory\(/g)).toHaveLength(1);
		expect(dialog).toContain("onclick={share}");
		// What it says once answered: the cut, the limit, why else it didn't go.
		expect(dialog).toContain("outcomeLine(outcome, name)");
	});

	test("shares only once this device is ready, and says so until then", () => {
		const dialog = source("ShareHistoryDialog.svelte");
		expect(dialog).toContain('const ready = $derived(encryption.state.name === "ready");');
		expect(dialog).toContain("disabled={sharing || !ready}");
		expect(dialog).toContain('{t("e2e_not_ready")}');
		// The request comes through member-actions, which a menu's page that never loads the engine reaches too.
		expect(dialog).toContain('import { shareHistoryRequest } from "$lib/member-actions";');
	});
});
