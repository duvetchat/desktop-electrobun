import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { webhookUrls } from "$lib/api/webhooks";

// A webhook's GitHub URL is its URL with /github, which the API takes as a GitHub repository's webhook, as the mobile
// app's Copy GitHub URL has it (#251).
test("a webhook's GitHub URL is its URL with /github", () => {
	expect(webhookUrls("https://api.example", "w1", "secret")).toEqual({
		url: "https://api.example/api/webhooks/w1/secret",
		github: "https://api.example/api/webhooks/w1/secret/github",
	});
});

test("the token box copies the URL and the GitHub URL", () => {
	const box = readFileSync(join(import.meta.dir, "..", "components", "Webhooks.svelte"), "utf8");
	expect(box).toContain("{@const urls = webhookUrls(attachmentHost, createdWebhookId, createdWebhookToken)}");
	expect(box).toContain('copyWebhookUrl(urls.url, "room_webhook_url_copied")');
	expect(box).toContain('copyWebhookUrl(urls.github, "room_webhook_github_url_copied")');
	expect(box).toContain('t("room_webhook_copy_github_url")');
	// The words, in en.json (#464).
	const en: Record<string, string> = JSON.parse(
		readFileSync(join(import.meta.dir, "..", "..", "..", "messages", "en.json"), "utf8"),
	);
	expect(en.room_webhook_url_copied).toBe("Webhook URL copied to clipboard");
	expect(en.room_webhook_github_url_copied).toBe("GitHub URL copied to clipboard");
	expect(en.room_webhook_copy_github_url).toBe("Copy GitHub URL");
});
