import { describe, expect, test } from "bun:test";
import { activityLine, formatPlaybackTime, isSpotify, shownActivities, spotifySearchUrl } from "./activity";
import type { UserActivity } from "$lib/stores.svelte";

const spotify: UserActivity = {
	type: 2,
	name: "Spotify",
	details: "Bugambilia",
	state: "Nasa Histoires",
	timestamps: { start: 1_000_000, end: 1_190_000 },
	assets: { large_text: "FLORA" },
};
const game: UserActivity = { name: "Visual Studio Code", details: "Editing main.go", timestamps: { start: 1_000_000 } };

describe("isSpotify", () => {
	test("is Spotify listening only", () => {
		expect(isSpotify(spotify)).toBe(true);
		expect(isSpotify({ ...spotify, type: undefined })).toBe(false);
		expect(isSpotify({ ...spotify, name: "Deezer" })).toBe(false);
		expect(isSpotify(game)).toBe(false);
	});
});

describe("shownActivities", () => {
	test("shows a song until a while after its end, and the rest always", () => {
		expect(shownActivities([spotify, game], 1_100_000)).toEqual([spotify, game]);
		expect(shownActivities([spotify, game], 1_190_000 + 30_000)).toEqual([spotify, game]);
		expect(shownActivities([spotify, game], 1_190_000 + 30_001)).toEqual([game]);
		expect(shownActivities([game], 9_999_999_999)).toEqual([game]);
	});
	test("is nothing for a member without activities", () => {
		expect(shownActivities(undefined)).toEqual([]);
	});
});

describe("spotifySearchUrl", () => {
	test("searches the song and its artist", () => {
		expect(spotifySearchUrl(spotify)).toBe("https://open.spotify.com/search/Bugambilia%20Nasa%20Histoires");
		expect(spotifySearchUrl({ ...spotify, details: "Mon Amour - Remix", state: "zzoilo & co/2" })).toBe(
			"https://open.spotify.com/search/Mon%20Amour%20-%20Remix%20zzoilo%20%26%20co%2F2",
		);
	});
});

describe("formatPlaybackTime", () => {
	test("is m:ss, and h:mm:ss from an hour on", () => {
		expect(formatPlaybackTime(0)).toBe("0:00");
		expect(formatPlaybackTime(81_973)).toBe("1:21");
		expect(formatPlaybackTime(190_000)).toBe("3:10");
		expect(formatPlaybackTime(3_725_000)).toBe("1:02:05");
		expect(formatPlaybackTime(-5)).toBe("0:00");
	});
});

describe("activityLine", () => {
	test("a song reads as its title and artist", () => {
		expect(activityLine(spotify)).toEqual({ kind: "listening", text: "Bugambilia — Nasa Histoires" });
		expect(activityLine({ ...spotify, state: undefined })).toEqual({ kind: "listening", text: "Bugambilia" });
		expect(activityLine({ ...spotify, details: undefined })).toEqual({
			kind: "listening",
			text: "Spotify",
		});
	});

	test("anything else reads as what is played or listened to", () => {
		expect(activityLine(game)).toEqual({ kind: "playing", text: "Visual Studio Code" });
		expect(activityLine({ type: 2, name: "Apple Music" })).toEqual({
			kind: "listening",
			text: "Apple Music",
		});
	});
});
