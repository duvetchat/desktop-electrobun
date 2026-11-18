import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The redesign (#357) split UserStatusBar into the profile row (the shell's) and the media controls with the voice
// status (calls and media's), without changing what any of them does. These keep each part where it went.
const source = (name: string) => readFileSync(join(import.meta.dir, `${name}.svelte`), "utf8");
const row = source("ProfileRow");
const controls = source("MediaControls");
const status = source("VoiceStatus");
const script = (component: string) => /<script lang="ts">([\s\S]*?)<\/script>/.exec(component)?.[1] ?? "";

describe("the split of the user's panel", () => {
	// The redesigned sidebar (#357, S-07) stacks its bottom itself: the playback bar, the media controls with the voice
	// status, then the profile row. The folded edge keeps the row's narrow column, which stacks them around the avatar.
	// The stand-alone rooms and chats columns that also mounted the row are gone: nothing mounted them.
	test("UserStatusBar is gone, and the sidebar mounts its three parts, in order", () => {
		expect(existsSync(join(import.meta.dir, "UserStatusBar.svelte"))).toBe(false);
		const mounts = (name: string) => [...source(name).matchAll(/<ProfileRow\b[^>]*\/>/g)].map((m) => m[0]);
		expect(mounts("DMSidebar")).toEqual([]);
		expect(mounts("ChannelsSidebar")).toEqual([]);
		// The folded edge of the sidebar.
		expect(mounts("SpaceEdge")).toEqual(["<ProfileRow collapsed />"]);
		const nav = source("SpaceNav");
		expect(mounts("SpaceNav")).toEqual(["<ProfileRow />"]);
		// What plays, then the voice status (quiet while the Now section has the voice the user is in) over the media
		// controls, then the row.
		const order = ["<VoiceNoteBar />", "<VoiceStatus showVoice={false} />", "<MediaControls />", "<ProfileRow />"].map(
			(part) => nav.indexOf(part),
		);
		expect(order.every((at) => at !== -1)).toBe(true);
		expect(order).toEqual([...order].sort((x, y) => x - y));
	});

	test("the profile row is who the user is and the way into Settings; folded, it stacks the other two", () => {
		for (const part of [
			"<StatusMenu",
			"<UserAvatar",
			"<StatusDot",
			"myStatusLabel",
			"$speakingUsers.has(",
			"<UserSettings",
		])
			expect(row).toContain(part);
		expect(row.split('aria-label="User Settings"')).toHaveLength(3);
		// Docked, the media controls and the voice status are the sidebar's to mount; only the folded column has them.
		expect(row).not.toContain("<MediaControls />");
		expect(row).not.toContain("VoiceNoteBar");
		expect(row).toContain("<MediaControls collapsed />");
		expect(row).toContain("<VoiceStatus collapsed />");
	});

	test("the profile row has none of the microphone's, the voice's or the ping's logic", () => {
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

	test("the media controls are the mic with its Input Device menu, deafen and noise suppression, in both layouts", () => {
		for (const label of ['aria-label="Toggle Mute"', 'aria-label="Deafen"', 'aria-label="Toggle Noise Suppression"'])
			expect(controls.split(label)).toHaveLength(3);
		expect(controls).toContain("Input Device");
		expect(controls).toContain("No microphones found");
		expect(controls).toContain("`Microphone ${micIndex + 1}`");
		// Only the full panel's mic has the menu: one context menu, in the branch that isn't collapsed.
		expect(controls.split("<ContextMenu.Root")).toHaveLength(2);
		expect(controls.indexOf("<ContextMenu.Root")).toBeGreaterThan(controls.indexOf("{:else}"));
		// The dot marks the microphone in use: the system's default when none was picked.
		expect(controls).toContain(
			'$selectedMicId === mic.deviceId || ($selectedMicId === "" && mic.deviceId === "default")',
		);
	});

	// Losing Speak in a voice room mutes at once and tells the gateway; without it the mic's button does nothing.
	test("the media controls keep the Speak permission's rule", () => {
		expect(controls).toContain("hasPermission(activeVoiceSpace, activeVoiceRoom, Permission.SpeakInVoice)");
		expect(controls).toMatch(
			/if \(!canSpeak && !get\(isMuted\)\) \{[\s\S]*?isMuted\.set\(true\);\s*sendVoiceSync\(\);/,
		);
		expect(controls.split("onclick={() => canSpeak && toggleMute()}")).toHaveLength(3);
		expect(controls).toContain("class:cursor-not-allowed={!canSpeak}");
	});

	test("the media controls have none of the profile's or the voice status's parts", () => {
		for (const name of [
			"StatusMenu",
			"UserAvatar",
			"StatusDot",
			"UserSettings",
			"currentUser",
			"measurePing",
			"Disconnect",
		])
			expect(controls, name).not.toContain(name);
	});

	test("the voice status is the pill and the folded column's ping and Disconnect, with their words", () => {
		for (const words of [
			'new: "Connecting..."',
			'connected: "Voice Connected"',
			'disconnected: "Reconnecting..."',
			'failed: "Connection Failed"',
			'closed: "Disconnected"',
			'"In Call"',
			'"In call"',
			"`Ping: ${ping}ms`",
			'"Measuring ping..."',
		])
			expect(status).toContain(words);
		expect(status.split('aria-label="Disconnect"')).toHaveLength(3);
		expect(status.split("onclick={disconnectVoice}")).toHaveLength(3);
		// The pill only where the voice doesn't show on its own, and never in the folded column.
		expect(status).toContain("{:else if showVoice && $activeVoiceRoomId && (activeVoiceRoom || isInConversationCall)}");
	});

	test("the ping's thresholds are 100 and 250 ms", () => {
		expect(status).toMatch(
			/if \(ms === null \|\| ms < 100\) return "text-duvet-ink2";\s*if \(ms < 250\) return "text-duvet-warn";\s*return "text-duvet-danger";/,
		);
	});
});
