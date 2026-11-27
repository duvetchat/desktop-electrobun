import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { t } from "$lib/i18n";

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
			'"shell_now_call_elsewhere"',
			"answerRequest(request, accept)",
			"answerInvite(invite.id, accept)",
			'role="progressbar"',
			// Who is in voice, and the online friends with what they do.
			'"shell_now_in_voice"',
			'"shell_now_online_friends"',
			"Permission.JoinVoice",
			"{onFriend}",
			"onMore={onFriendsSelect}",
			"OnlineFriendFaces.svelte",
			// The folds and "show more", saved on this device.
			'toggleNow("roomsFolded")',
			'toggleNow("friendsFolded")',
			'toggleNow("allRooms")',
		])
			expect(now, part).toContain(part);
		// Every row the jump marks label (keyboard.ts): a call and a room. The friend faces are in
		// OnlineFriendFaces, which marks its own.
		expect(now.match(/\bdata-jump\b/g)).toHaveLength(2);
	});

	// #464: the percent sign is the message's, so English writes 42% on every system (Intl's percent writes "42 %"
	// for some English regions, en-DE among them), and a language writes it its own way.
	test("writes how far files being moved have got as English always has", () => {
		expect(now).toContain('t("shell_now_moving_percent", { percent: progress.percent })');
		// formatNumber writes the section's counts, not the percent.
		expect(now).not.toMatch(/formatNumber\([^)]*percent/);
		expect(now).not.toContain('style: "percent"');
		expect(t("shell_now_moving_percent", { percent: 42 })).toBe("42%");
		expect(t("shell_now_moving_percent", { percent: 100 })).toBe("100%");
	});

	test("is drawn on the sidebar's tokens and the primitives, not the old cards", () => {
		const classes = [...now.matchAll(/\b(?:bg|ring|text|shadow)-duvet-[\w-]+/g)].map((m) => m[0]);
		for (const old of ["bg-duvet-card", "bg-duvet-bg", "ring-duvet-card", "ring-duvet-sunk", "text-duvet-sunk"])
			expect(classes, old).not.toContain(old);
		expect(now).not.toContain("shadow-duvet-press");
		for (const part of ["bg-duvet-sb-card", "hover:bg-duvet-sb-hover", "ring-duvet-sb-ring", "--duvet-sb-edge"])
			expect(now, part).toContain(part);
		for (const primitive of ["ui/Button.svelte", "ui/IconButton.svelte", "ui/SpaceIcon.svelte"])
			expect(now, primitive).toContain(`$lib/components/${primitive}`);
	});

	// Every online friend is one face in the wrapping row. What they're doing rides in the face's bubble, so a song
	// doesn't take a full row above the faces.
	test("shows every online friend as a face, with presence and activity in its bubble", () => {
		expect(now).not.toContain("friendsSplit");
		expect(now).toContain("fitFaces(");
		expect(now).toContain("activity: activityLine(activity)");
		expect(now).toContain("<OnlineFriendFaces");
	});

	test("scrolls within its share of the column, which is never more than the rows leave it", () => {
		expect(now).toMatch(
			/<section class="flex min-h-0 flex-col[^"]*" aria-label=\{t\("shell_now"\)\}>\s*<div class="[^"]*\boverflow-y-auto\b/,
		);
		const nav = source("SpaceNav.svelte");
		expect(nav).toMatch(
			/<div class="flex max-h-\[max\(50%,calc\(100%-var\(--rows-height\)\)\)\] shrink-0 flex-col">\s*<NowSection/,
		);
	});
});
