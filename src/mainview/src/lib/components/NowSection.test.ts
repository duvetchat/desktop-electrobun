import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (name: string) => readFileSync(join(import.meta.dir, name), "utf8");
const now = source("NowSection.svelte");

// The Now section after the redesign (#357): what asks the user something, who is in voice and which friends are
// online, as part of the sidebar's column. The voice the user is in is the call panel's alone (DECISIONS.md, "The
// prototype's unanswered questions", 3): drawn here too, "Voice connected" showed twice.
describe("the Now section", () => {
	test("has no voice dock: where the user is, its faces and Leave are the call panel's", () => {
		for (const part of [
			"currentVoicePlace",
			"voiceConnectionState",
			"speakingUsers",
			"disconnectVoice",
			"Voice connected",
			"Call connected",
			"Leave voice",
			"Leave call",
		])
			expect(now, part).not.toContain(part);
		// What the dock showed is the call panel's first row, and the folded edge's button.
		const status = source("VoiceStatus.svelte");
		for (const part of ["mediaTitle(media)", "<FaceStack", "liveLabel(media.live)", "actions.disconnect"])
			expect(status, part).toContain(part);
		const controls = source("MediaControls.svelte");
		expect(controls).toContain("label={openPlaceLabel(media)}");
		expect(controls).toContain("tip={placeTip(media)}");
	});

	test("keeps everything else it did", () => {
		for (const part of [
			// What asks the user something, with its answers.
			"joinConversationCall(call.conv)",
			"Calling from another device",
			"answerRequest(request, accept)",
			"answerInvite(invite.id, accept)",
			'role="progressbar"',
			// Who is in voice, and the online friends with what they do.
			'"In voice now"',
			'"Online friends"',
			"Permission.JoinVoice",
			"onFriend(friend.id)",
			"onclick={onFriendsSelect}",
			// The folds and "show more", saved on this device.
			'toggleNow("roomsFolded")',
			'toggleNow("friendsFolded")',
			'toggleNow("allRooms")',
		])
			expect(now, part).toContain(part);
		// Every row the jump marks label (keyboard.ts): a call, a room, a friend's row and a friend's face.
		expect(now.match(/\bdata-jump\b/g)).toHaveLength(4);
	});

	test("is drawn on the sidebar's tokens and the primitives, not the old cards", () => {
		const classes = [...now.matchAll(/\b(?:bg|ring|text|shadow)-duvet-[\w-]+/g)].map((m) => m[0]);
		for (const old of ["bg-duvet-card", "bg-duvet-bg", "ring-duvet-card", "ring-duvet-sunk", "text-duvet-sunk"])
			expect(classes, old).not.toContain(old);
		expect(now).not.toContain("shadow-duvet-press");
		for (const part of ["bg-duvet-sb-card", "hover:bg-duvet-sb-hover", "ring-duvet-sb-ring", "--duvet-sb-edge"])
			expect(now, part).toContain(part);
		for (const primitive of ["ui/Avatar.svelte", "ui/Button.svelte", "ui/IconButton.svelte", "ui/SpaceIcon.svelte"])
			expect(now, primitive).toContain(`$lib/components/${primitive}`);
	});

	test("scrolls within its share of the column, which is never more than the rows leave it", () => {
		expect(now).toMatch(
			/<section class="flex min-h-0 flex-col[^"]*" aria-label="Now">\s*<div class="[^"]*\boverflow-y-auto\b/,
		);
		const nav = source("SpaceNav.svelte");
		expect(nav).toMatch(
			/<div class="flex max-h-\[max\(50%,calc\(100%-var\(--rows-height\)\)\)\] shrink-0 flex-col">\s*<NowSection/,
		);
	});
});
