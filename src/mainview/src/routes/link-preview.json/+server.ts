import type { RequestHandler } from "./$types";

export const prerender = true;

const site = "https://duvet.chat";

// The card Discord shows for a link to duvet.chat, which links this file from its head (routes/+page.svelte): a
// component embed, https://docs.discord.com/developers/link-previews/component-embeds. Every page also has the Open
// Graph tags of app.html, for other apps and for Discord when the card can't render. Only the web build serves it:
// electrobun.config.ts doesn't copy it into the app.
// Component types: 17 container, 12 media gallery, 9 section, 10 text, 14 separator, 1 row, 2 button (style 5: a link).
const embed = {
	component: {
		type: 17,
		accent_color: 0x818cf8,
		components: [
			{
				type: 12,
				items: [{ media: { url: `${site}/opengraph-image.png` }, description: "Duvet, a cozy place to talk" }],
			},
			{
				type: 9,
				components: [
					{
						type: 10,
						content:
							"# Duvet\n**A cozy place to talk.** Spaces with text and voice rooms, direct messages and groups, for you and your people.",
					},
				],
				accessory: { type: 2, style: 5, label: "Get started", url: `${site}/sign-up` },
			},
			{ type: 14, spacing: 1 },
			{
				type: 10,
				content:
					"✓ **Voice rooms** with noise suppression\n✓ **Search and pins**, so nothing said gets lost\n✓ **Bots and webhooks** on a documented API",
			},
			{
				type: 1,
				components: [
					{ type: 2, style: 5, label: "Sign in", url: `${site}/sign-in` },
					{ type: 2, style: 5, label: "Docs", url: "https://docs.duvet.chat" },
				],
			},
		],
	},
};

// Discord drops a card over 3000 bytes without a word: the build fails instead.
const body = JSON.stringify(embed);
const bytes = new TextEncoder().encode(body).length;
if (bytes > 3000) throw new Error(`The link preview card is ${bytes} bytes; Discord takes 3000 at most.`);

export const GET: RequestHandler = () => new Response(body, { headers: { "content-type": "application/json" } });
