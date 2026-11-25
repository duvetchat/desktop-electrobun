import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The redesign (#357) split UserStatusBar into the profile row (the shell's), the user's own bar (the microphone,
// deafen and Settings) and the media controls (calls and media's), which grow into the call panel in voice. These keep
// each part where it went.
const source = (name: string) => readFileSync(join(import.meta.dir, `${name}.svelte`), "utf8");
const row = source("ProfileRow");
const bar = source("ProfileControls");
const controls = source("MediaControls");
const status = source("VoiceStatus");
const script = (component: string) => /<script lang="ts">([\s\S]*?)<\/script>/.exec(component)?.[1] ?? "";

describe("the split of the user's panel", () => {
	// The redesigned sidebar (#357, S-07) stacks its bottom itself: the playback bar, the media controls with the voice
	// status, and the profile row with the user's own controls at its end. The folded edge keeps the row's narrow
	// column, which stacks them around the avatar. The stand-alone rooms and chats columns that also mounted the row are
	// gone.
	test("UserStatusBar is gone, and the sidebar mounts its parts, in order", () => {
		expect(existsSync(join(import.meta.dir, "UserStatusBar.svelte"))).toBe(false);
		const mounts = (name: string) => [...source(name).matchAll(/<ProfileRow\b[^>]*\/>/g)].map((m) => m[0]);
		expect(mounts("DMSidebar")).toEqual([]);
		expect(mounts("ChannelsSidebar")).toEqual([]);
		// The folded edge of the sidebar.
		expect(mounts("SpaceEdge")).toEqual(["<ProfileRow collapsed />"]);
		const nav = source("SpaceNav");
		expect(mounts("SpaceNav")).toEqual(["<ProfileRow />"]);
		// What plays, then the media controls (the call panel is theirs in voice, so no voice status is mounted beside
		// them), then the profile row with the user's controls inside it.
		const order = ["<VoiceNoteBar />", "<MediaControls />", "<ProfileRow />"].map((part) => nav.indexOf(part));
		expect(order.every((at) => at !== -1)).toBe(true);
		expect(order).toEqual([...order].sort((x, y) => x - y));
	});

	test("the profile row is who the user is, with the controls at its end; folded, it stacks the media controls", () => {
		for (const part of [
			"<StatusMenu",
			"<UserAvatar",
			"<StatusDot",
			"myStatusLabel",
			"$speakingUsers.has(",
			"<ProfileControls />",
			"<ProfileControls collapsed />",
		])
			expect(row).toContain(part);
		expect(row.split('aria-label={t("shell_settings")}')).toHaveLength(3);
		// Docked, the media controls are the sidebar's to mount, as one block above the row (BRIEF.md "Media controls");
		// only the folded column has them here. The call panel is theirs in voice, so the row mounts no voice status.
		expect(row).not.toContain("<UserSettings");
		expect(row).not.toContain('aria-label="Settings"');
		expect(row).not.toContain("<MediaControls />");
		expect(row).not.toContain("VoiceNoteBar");
		expect(row).toContain("<MediaControls collapsed />");
		expect(row).not.toContain("<VoiceStatus");
	});

	// The macOS menu bar's Settings… (src/bun/app-menu.ts, #372): Bun sends it to the main window's page as a command,
	// which the user's bar answers while it's mounted (one is at a time), by the rule ⌘, follows: not over another dialog.
	test("the user's bar opens Settings for the menu bar's Settings… as for ⌘,", () => {
		const code = script(bar);
		expect(code).toMatch(
			/onMount\(\(\) => \{\s*const stop = addWindowCommands\(SETTINGS_MENU_COMMAND\.channel, \{ \[SETTINGS_MENU_COMMAND\.name\]: openSettings \}\);[\s\S]*?return stop;\s*\}\);/,
		);
		// The page answers the relay's commands from here too, whoever else wired it first.
		expect(code).toContain(".then((rpc) => rpc?.on.windowCommand(answerWindowCommand))");
		expect(code).toMatch(
			/function openSettings\(\): boolean \{\s*if \(!showUserSettings && document\.querySelector\('\[role="dialog"\], \[role="alertdialog"\]'\)\) return false;\s*showUserSettings = true;\s*return true;\s*\}/,
		);
		expect(code).toContain("if (!isSettingsShortcut(event, mac) || showUserSettings || !openSettings()) return;");
		expect(script(row)).not.toContain("openSettings");
	});
	// The quick mute, deafen and Settings at the profile row's end, on the same stores as the media controls above
	// them: two presses, the microphone's picker, the output volume, and Settings.
	test("has mute, deafen and Settings at the row's end, from the media stores", () => {
		const expanded = bar.slice(
			bar.indexOf('<div class="flex shrink-0 items-center gap-0.5">'),
			bar.indexOf("<UserSettings"),
		);
		expect(expanded).toContain('class="flex shrink-0 items-center gap-0.5"');
		expect(expanded).toContain("label={micLabel}");
		expect(expanded).toContain("onclick={actions.toggleMute}");
		expect(expanded).toContain('label={media.deafened ? t("shell_undeafen") : t("shell_deafen")}');
		expect(expanded).toContain("onclick={actions.toggleDeafen}");
		expect(expanded).toContain("disabled={!media.canSpeak}");
		expect(expanded).toContain("onclick={openSettings}");
		const mic = expanded.indexOf("actions.toggleMute");
		const deafen = expanded.indexOf("actions.toggleDeafen");
		const settings = expanded.indexOf("onclick={openSettings}");
		expect(mic).toBeGreaterThan(-1);
		expect(mic).toBeLessThan(deafen);
		expect(deafen).toBeLessThan(settings);
		// The deafen's chevron opens the output volume: a bar over the voice and shared sound.
		expect(expanded).toContain('aria-label="Audio output"');
		expect(expanded).toContain("Output volume");
		expect(expanded).toContain("<Slider");
		expect(expanded).toContain("voiceOutputVolume");
		const code = script(bar);
		expect(code).toContain('const micLabel = $derived(media.muted ? "Unmute" : "Mute");');
		expect(code).toContain("const media = $derived($liveMedia);");
		expect(code).toContain("const actions = liveMediaActions;");
	});

	test("the output volume the deafen's chevron sets reaches everyone's sound", () => {
		const voice = readFileSync(join(import.meta.dir, "VoiceChat.svelte"), "utf8");
		expect(voice).toContain("use:applyVolume={$voiceOutputVolume}");
		expect(voice).toMatch(/function applyVolume\(node: HTMLAudioElement, volume: number\)/);
	});

	test("the profile row has none of the microphone's picker, the voice's or the ping's logic", () => {
		for (const name of [
			"isMuted",
			"isDeafened",
			"noiseSuppression",
			"selectedMicId",
			"toggleDeafen",
			"toggleMic",
			"sendVoiceSync",
			"hasPermission",
			"enumerateDevices",
			"measurePing",
			"disconnectVoice",
			"voiceConnectionState",
			"activeCall",
		])
			expect(script(row), name).not.toContain(name);
	});

	// What the controls draw is MediaPanel.test.ts's, and what they do media-state.test.ts's and media-source.test.ts's.
	// These keep each part's work where the redesign put it.
	test("the media controls keep the Speak permission's rule", () => {
		// Losing Speak in a voice room mutes at once and tells the gateway; without it the mic's button does nothing.
		expect(controls).toMatch(
			/if \(!\$canSpeakInVoice && !get\(isMuted\)\) \{[\s\S]*?isMuted\.set\(true\);\s*sendVoiceSync\(\);/,
		);
		const live = readFileSync(join(import.meta.dir, "../media-source.ts"), "utf8");
		expect(live).toContain("hasPermission($room.space, $room.room, Permission.SpeakInVoice)");
		expect(live).toMatch(/toggleMute\(\) \{[\s\S]*?if \(get\(canSpeakInVoice\)\) toggleMute\(\);/);
	});

	test("the media controls have none of the profile's parts, and no settings gear", () => {
		for (const name of ["StatusMenu", "UserAvatar", "StatusDot", "UserSettings", "currentUser", "Settings"])
			expect(controls, name).not.toContain(name);
	});

	test("the voice status draws the state it is given, and reads no store", () => {
		expect(status).not.toContain("$lib/stores");
		expect(status).toContain("onclick={actions.disconnect}");
		expect(status).toContain("onclick={actions.openPlace}");
	});
});
