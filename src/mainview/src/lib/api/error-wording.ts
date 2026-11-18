// The API's error texts go to the user as they are (getApiError, lib/api/api.ts), and a few of them say "channel" or
// "server", which the app never does: it says room, and a Space is not a server (#357, docs/redesign/COPY.md §3,
// DECISIONS.md). The API can't change for this, so its known texts are put in the app's words here, on their way to
// the screen. Nothing sent or received changes.
//
// The known texts (api/internal/services/errors.go; the gateway has the first three too):
//   you don't have permission to view this channel
//   you don't have permission to send messages in this channel
//   you don't have permission to manage channels
//   you don't have permission to manage permissions for this channel
//   internal server error
// They are matched by pattern, not listed as strings: wording.test.ts keeps those two words out of the app's strings.

const PERMISSION = /^you don't have permission to .*\bchannels?$/i;
const INTERNAL = /^internal server error$/i;

/**
 * An API error's text in the app's words. A permission error about a channel says room; "internal server error",
 * which tells the user nothing, gives way to the caller's own message (`fallback`) when there is one. Any other text
 * comes back unchanged.
 */
export function inAppWords(text: string, fallback: string): string {
	const trimmed = text.trim();
	if (INTERNAL.test(trimmed)) return fallback || "Something went wrong on Duvet's side";
	if (PERMISSION.test(trimmed)) return trimmed.replace(/\bchannels\b/gi, "rooms").replace(/\bchannel\b/gi, "room");
	return text;
}
