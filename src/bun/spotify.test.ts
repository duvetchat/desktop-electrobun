import { describe, expect, test } from "bun:test";
import {
	sameSpotifyActivity,
	spotifyActivity,
	trackFromAppleScript,
	trackFromPlayerctl,
	trackFromSmtc,
	type SpotifyTrack,
} from "./spotify";

const track: SpotifyTrack = {
	title: "Bugambilia",
	artist: "Nasa Histoires",
	album: "FLORA",
	start: 1000,
	end: 191_000,
};

describe("spotifyActivity", () => {
	test("is Spotify listening, with the song, the artist, the album and the song's start and end", () => {
		expect(spotifyActivity(track)).toEqual({
			type: 2,
			name: "Spotify",
			details: "Bugambilia",
			state: "Nasa Histoires",
			timestamps: { start: 1000, end: 191_000 },
			assets: { large_text: "FLORA" },
		});
	});

	test("is nothing when nothing plays, or an ad (no artist) or a song without a length does", () => {
		expect(spotifyActivity(null)).toBeNull();
		expect(spotifyActivity({ ...track, artist: "" })).toBeNull();
		expect(spotifyActivity({ ...track, end: track.start })).toBeNull();
	});

	test("leaves the album out when there's none", () => {
		expect(spotifyActivity({ ...track, album: "" })?.assets).toBeUndefined();
	});

	test("clips texts to the gateway's 128 characters, counting an emoji as one", () => {
		const details = spotifyActivity({ ...track, title: "🎵".repeat(200) })?.details ?? "";
		expect([...details].length).toBe(128);
		expect(details.endsWith("…")).toBe(true);
		expect(spotifyActivity({ ...track, title: "🎵".repeat(128) })?.details).toBe("🎵".repeat(128));
	});
});

describe("sameSpotifyActivity", () => {
	const a = spotifyActivity(track);
	test("is the same song read again a moment later", () => {
		expect(sameSpotifyActivity(a, spotifyActivity({ ...track, start: 2500, end: 192_500 }))).toBe(true);
		expect(sameSpotifyActivity(null, null)).toBe(true);
	});
	test("changes with a seek, another song, or when the song stops", () => {
		expect(sameSpotifyActivity(a, spotifyActivity({ ...track, start: 31_000, end: 221_000 }))).toBe(false);
		expect(sameSpotifyActivity(a, spotifyActivity({ ...track, title: "Otra" }))).toBe(false);
		expect(sameSpotifyActivity(a, null)).toBe(false);
	});
});

describe("trackFromSmtc", () => {
	const line = JSON.stringify({
		playing: true,
		title: "Mon Amour - Remix",
		artist: "zzoilo",
		album: "Mon Amour (Remix)",
		position: 81_973,
		duration: 179_940,
		updated: 1_792_785_000_000,
	});
	test("starts the song at the date Windows gave its position, minus the position", () => {
		expect(trackFromSmtc(line, 1_792_785_009_000)).toEqual({
			title: "Mon Amour - Remix",
			artist: "zzoilo",
			album: "Mon Amour (Remix)",
			start: 1_792_785_000_000 - 81_973,
			end: 1_792_785_000_000 - 81_973 + 179_940,
		});
	});
	test("takes now when Windows has no date for the position", () => {
		const undated = JSON.stringify({ ...JSON.parse(line), updated: -62_135_596_800_000 });
		expect(trackFromSmtc(undated, 5_000_000_000_000)?.start).toBe(5_000_000_000_000 - 81_973);
	});
	test("reads a line that starts with a byte order mark", () => {
		expect(trackFromSmtc(String.fromCharCode(0xfeff) + line, 0)?.title).toBe("Mon Amour - Remix");
	});
	test("is nothing when nothing plays, or for a line that isn't JSON", () => {
		expect(trackFromSmtc('{"playing":false}', 0)).toBeNull();
		expect(trackFromSmtc("spotify-smtc: oops", 0)).toBeNull();
		expect(trackFromSmtc("null", 0)).toBeNull();
	});
});

describe("trackFromAppleScript", () => {
	test("reads the title, artist, album, position and length", () => {
		expect(trackFromAppleScript("Bugambilia\tNasa Histoires\tFLORA\t50000\t190000\n", 100_000)).toEqual({
			title: "Bugambilia",
			artist: "Nasa Histoires",
			album: "FLORA",
			start: 50_000,
			end: 240_000,
		});
	});
	test("is nothing when Spotify doesn't play", () => {
		expect(trackFromAppleScript("\n", 0)).toBeNull();
	});
});

describe("trackFromPlayerctl", () => {
	const out = "Playing\tBugambilia\tNasa Histoires\tFLORA\t50000000\t190000000\n";
	test("reads the position and the length in microseconds", () => {
		expect(trackFromPlayerctl(out, 100_000, null)).toEqual({ ...track, start: 50_000, end: 240_000 });
	});
	test("is nothing when Spotify is paused", () => {
		expect(trackFromPlayerctl(out.replace("Playing", "Paused"), 100_000, null)).toBeNull();
	});
	test("keeps the start a song had when Spotify reports position 0 for it", () => {
		const stuck = "Playing\tBugambilia\tNasa Histoires\tFLORA\t0\t190000000\n";
		const last = trackFromPlayerctl(out, 100_000, null);
		expect(trackFromPlayerctl(stuck, 105_000, last)?.start).toBe(50_000);
		// Another song at position 0 starts now.
		expect(trackFromPlayerctl(stuck.replace("Bugambilia", "Otra"), 105_000, last)?.start).toBe(105_000);
	});
});
