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
	expect(box).toContain('copyWebhookUrl(urls.url, "Webhook URL")');
	expect(box).toContain('copyWebhookUrl(urls.github, "GitHub URL")');
	expect(box).toContain("Copy GitHub URL");
});
