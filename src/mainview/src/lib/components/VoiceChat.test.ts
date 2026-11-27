import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const voiceChat = readFileSync(join(import.meta.dir, "VoiceChat.svelte"), "utf8");

// How voice's failures reach the user. VoiceChat carries the connection, mounted hidden: without one of these, it fails or
// leaves with nothing on screen.
// #207: it joined with the user unmuted, so the others saw an unmuted member who sent nothing, and the controls offered
// Mute; unmuting never asked for the microphone again.
test("a microphone that can't open says so, and voice joins to listen, muted: unmuting asks for it again", () => {
	expect(voiceChat).toMatch(
		/await acquireMic\(\);\s*\} catch \(e\) \{[^}]*if \(!isDestroyed\) \{\s*isMuted\.set\(true\);\s*askForMicWith\(askForMicAgain\);\s*toast\(t\("call_mic_listening_only"\), "error"\);\s*\}/,
	);
	// One that fails once SpeakInVoice comes is asked for again too.
	expect(voiceChat).toMatch(
		/toast\(t\("call_mic_failed"\), "error"\);\s*if \(!isDestroyed\) askForMicWith\(askForMicAgain\);/,
	);
	// Asked for again and open, it's metered, and sent once the unmute takes the mute off; voice left, nothing asks.
	expect(voiceChat).toMatch(
		/async function askForMicAgain\(\): Promise<boolean> \{\s*if \(localAudioStream\) return true;\s*try \{\s*await acquireMic\(\);\s*\} catch \(err\) \{[^}]*return false;\s*\}\s*if \(isDestroyed \|\| !localAudioStream\) return false;\s*askForMicWith\(null\);\s*startLocalLevelMeter\(\);\s*return true;\s*\}/,
	);
	expect(voiceChat).toMatch(/isDestroyed = true;\s*askForMicWith\(null\);/);
	expect(voiceChat).toMatch(/const shouldSend = !\$isMuted && !\$isDeafened;\s*if \(audioSender\) \{/);
	// One that's still asked for when the user left says nothing.
	expect(voiceChat).toMatch(
		/if \(isDestroyed\) return;\s*activeVoiceRoomId\.set\(channelId\);\s*joining = true;\s*joinVoice\(\);/,
	);
});

// #370: a call placed as a video call turns the camera on as its voice joins, as the camera button does: a camera that
// can't open (refused, missing, busy) says why, and the call goes on without it.
test("a video call's voice turns the camera on as it joins, through the camera's own start", () => {
	expect(voiceChat).toMatch(
		/joining = true;\s*joinVoice\(\);\s*(?:\/\/[^\n]*\n\s*)*if \(takeVideoCall\(channelId\)\) queueCamera\(startCamera\);/,
	);
	expect(voiceChat).toMatch(
		/stream = await openCamera\(\$selectedCameraId\);\s*\} catch \(err\) \{\s*console\.error\("\[Voice\] Couldn't open the camera:", err\);\s*toast\(cameraErrorMessage\(err\), "error"\);\s*return;\s*\}/,
	);
});

test("a connection that fails with the gateway up says so, and leaves", () => {
	expect(voiceChat).toMatch(
		/if \(gatewayConnection\(\) !== null\) \{\s*toast\(t\("call_connection_lost"\), "error"\);\s*leaveVoice\(\);\s*\} else wantFreshSession\(\);/,
	);
});

test("voice left because the gateway was silent for long says so", () => {
	expect(voiceChat).toMatch(
		/data\.silent_ms > REJOIN_WINDOW_MS\) \{\s*toast\(t\("call_left_voice_silent"\), "error"\);\s*leaveVoice\(\);/,
	);
});

test("a join that can't start says so, and leaves: not one a newer join replaced", () => {
	expect(voiceChat).toMatch(
		/const attempt = connectWebRTC\(\);\s*const generation = webrtcGeneration;\s*attempt\.catch\(\(err\) => \{[^}]*if \(generation !== webrtcGeneration \|\| isDestroyed\) return;\s*toast\(t\("call_connect_failed"\), "error"\);\s*leaveVoice\(\);/,
	);
	expect(voiceChat.match(/connectWebRTC\(\)/g)).toHaveLength(2);
});

test("the notices that were there stay: a join unanswered, and a mic that fails once SpeakInVoice comes", () => {
	expect(voiceChat).toMatch(/toast\(t\("call_connect_failed"\), "error"\);\s*leaveVoice\(\);\s*\}, JOIN_TIMEOUT_MS\)/);
	expect(voiceChat).toContain(`toast(t("call_mic_failed"), "error");`);
});

// #324: every frame in voice, each user's level made a new set of who speaks and a new amplitudes object, even when
// nothing they show changed (a user who doesn't speak).
test("a user's level changes the stores only when what they show changes", () => {
	const showLevel = voiceChat.slice(
		voiceChat.indexOf("function showLevel"),
		voiceChat.indexOf("function averageLevel"),
	);
	expect(showLevel).toMatch(/if \(get\(speakingUsers\)\.has\(userId\) !== speaking\)/);
	expect(showLevel).toMatch(/if \(get\(userAmplitudes\)\[userId\] !== amplitude\)/);
});
