import { t } from "$lib/i18n";
import { clockFormat, formatClock, formatDate } from "$lib/i18n/format";
import { isEphemeral, isNotice, type Message } from "$lib/types";

/** How long after a message its author's next one still joins its group. */
export const GROUP_WINDOW_MS = 5 * 60_000;

type Grouped = Pick<
	Message,
	"author_id" | "author_name" | "created_at" | "type" | "flags" | "referenced_message" | "interaction_metadata"
>;

/** Whether two moments are on one calendar day, by this device's clock. */
export function sameDay(a: string | number | Date, b: string | number | Date): boolean {
	const da = new Date(a);
	const db = new Date(b);
	return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

// A message's moment, read once: its time, and its calendar day on this device's clock.
type Moment = { at: number; day: number };
function momentOf(iso: string): Moment {
	const date = new Date(iso);
	return { at: date.getTime(), day: date.getFullYear() * 10_000 + date.getMonth() * 100 + date.getDate() };
}

function joins(previous: Grouped, was: Moment, message: Grouped, is: Moment): boolean {
	if (isNotice(previous) || isNotice(message)) return false;
	if (message.referenced_message || message.interaction_metadata) return false;
	if (previous.author_id !== message.author_id || previous.author_name !== message.author_name) return false;
	if (isEphemeral(previous) !== isEphemeral(message)) return false;
	return is.at - was.at <= GROUP_WINDOW_MS && is.day === was.day;
}

/**
 * Whether a message continues the group of the one before it (previous, the older one): the same author, no more than
 * five minutes later, on the same day. A notice on either side, a switch between a bot's ephemeral messages and the
 * room's, a reply and a bot's answer to an interaction each start a new group, and so does the first unread message
 * (dividerBetween: the "new messages" line sits between the two).
 */
export function joinsPrevious(previous: Grouped | undefined, message: Grouped, dividerBetween = false): boolean {
	if (!previous || dividerBetween) return false;
	return joins(previous, momentOf(previous.created_at), message, momentOf(message.created_at));
}

/** A message's place in its group, and whether it's its day's first. */
export type GroupShape = { first: boolean; last: boolean; newDay: boolean };

/**
 * Each message's place in its group, for a list sorted newest first (as the message list keeps it), in one pass that
 * reads each date once. unreadFrom is how many of the newest messages are unread: the "new messages" line sits above
 * the oldest of them, and no group crosses it. A message still being sent has this device's clock, as the list shows it.
 */
export function groupShapes(newestFirst: readonly Grouped[], unreadFrom: number | null = null): GroupShape[] {
	const moments = newestFirst.map((m) => momentOf(m.created_at));
	// joined[i]: whether message i continues the group of the one before it, i + 1.
	const joined = newestFirst.map((message, i) => {
		const previous = newestFirst[i + 1];
		if (!previous || (unreadFrom !== null && unreadFrom > 0 && i === unreadFrom - 1)) return false;
		return joins(previous, moments[i + 1]!, message, moments[i]!);
	});
	return newestFirst.map((_, i) => ({
		first: !joined[i],
		last: i === 0 || !joined[i - 1],
		newDay: i === newestFirst.length - 1 || moments[i]!.day !== moments[i + 1]!.day,
	}));
}

const WEEKDAY: Intl.DateTimeFormatOptions = { weekday: "long" };
const DAY_OF_YEAR: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" };
const DAY_OF_ANOTHER_YEAR: Intl.DateTimeFormatOptions = { ...DAY_OF_YEAR, year: "numeric" };

/**
 * What a day's separator says: "Today", "Yesterday", the weekday for the five days before, then "Monday, November 10",
 * with the year when it isn't this one, in the app's language (lib/i18n/format.ts).
 */
export function dayLabel(iso: string, now: number | Date = Date.now()): string {
	const day = new Date(iso);
	const today = new Date(now);
	const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const daysAgo = Math.round((start(today) - start(day)) / 86_400_000);
	if (daysAgo === 0) return t("chat_day_today");
	if (daysAgo === 1) return t("chat_day_yesterday");
	if (daysAgo > 1 && daysAgo < 7) return formatDate(day, WEEKDAY);
	return formatDate(day, day.getFullYear() === today.getFullYear() ? DAY_OF_YEAR : DAY_OF_ANOTHER_YEAR);
}

/** A message's time of day in the system's clock format, whatever the app's language: "9:14 AM", or "21:14" (an
 * English app on a German system writes 21:14, as it always has: lib/i18n/format.ts, formatClock). */
export function clockTime(iso: string): string {
	return formatClock(new Date(iso));
}

/** The same without AM or PM, for a narrow gutter: "9:14". */
export function shortClockTime(iso: string): string {
	const parts = clockFormat().formatToParts(new Date(iso));
	return parts
		.filter((p) => p.type === "hour" || p.type === "minute" || (p.type === "literal" && p.value.trim() !== ""))
		.map((p) => p.value.trim())
		.join("");
}

/** A flat row's head time: "Today at 9:14 AM" for a message of today, the time alone under an older day's separator. */
export function headTime(iso: string, now: number | Date = Date.now()): string {
	const time = clockTime(iso);
	return sameDay(iso, now) ? t("chat_day_today_at", { time }) : time;
}
