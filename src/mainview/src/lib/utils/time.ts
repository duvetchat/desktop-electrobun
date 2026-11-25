import { formatDate } from "$lib/i18n/format";

export function formatDuration(secs: number): string {
	if (!isFinite(secs) || secs < 0) return "0:00";
	const m = Math.floor(secs / 60);
	const s = Math.floor(secs % 60);
	return `${m}:${s.toString().padStart(2, "0")}`;
}

/** A date as a message preview's header and an embed's footer show it: the locale's short date and time. */
export function formatShortDateTime(iso: string): string {
	return formatDate(new Date(iso), { dateStyle: "short", timeStyle: "short" });
}
