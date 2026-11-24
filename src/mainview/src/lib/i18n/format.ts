// Dates, times, numbers, lists and sizes in the app's language (#464). Each reads the locale through
// lib/i18n.ts's regionalLocale(), so what draws them runs again when the language changes, and a system in the app's
// language keeps its region's conventions (an English app on a British system writes 24 November, at 14:05).
// Nothing in the app names a locale for Intl itself: it asks here.
import { regionalLocale, t } from "$lib/i18n";

// Intl's formatters, built once per locale and options.
const dates = new Map<string, Intl.DateTimeFormat>();
const numbers = new Map<string, Intl.NumberFormat>();
const lists = new Map<string, Intl.ListFormat>();
const relatives = new Map<string, Intl.RelativeTimeFormat>();

function cached<Format>(cache: Map<string, Format>, options: object, make: (locale: string) => Format): Format {
	const locale = regionalLocale();
	const id = `${locale}\u0000${JSON.stringify(options)}`;
	let format = cache.get(id);
	if (!format) {
		format = make(locale);
		cache.set(id, format);
	}
	return format;
}

/** A date or a time, as Intl.DateTimeFormat writes it with these options. */
export function formatDate(date: Date | number, options: Intl.DateTimeFormatOptions = {}): string {
	return cached(dates, options, (locale) => new Intl.DateTimeFormat(locale, options)).format(date);
}

/** A number, as Intl.NumberFormat writes it with these options: 1,234.5 in English, 1.234,5 in German. */
export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
	return cached(numbers, options, (locale) => new Intl.NumberFormat(locale, options)).format(value);
}

/** Words joined as a list: "Ana, Ben and Cy" in English, "Ana, Ben y Cy" in Spanish. */
export function formatList(items: readonly string[], options: Intl.ListFormatOptions = {}): string {
	return cached(lists, options, (locale) => new Intl.ListFormat(locale, options)).format(items);
}

/** A time from now: "in 3 days", "5 minutes ago", or with numeric: "auto", "yesterday". */
export function formatRelativeTime(
	value: number,
	unit: Intl.RelativeTimeFormatUnit,
	options: Intl.RelativeTimeFormatOptions = {},
): string {
	return cached(relatives, options, (locale) => new Intl.RelativeTimeFormat(locale, options)).format(value, unit);
}

const fixed = (digits: number): Intl.NumberFormatOptions => ({
	minimumFractionDigits: digits,
	maximumFractionDigits: digits,
	useGrouping: false,
});

/**
 * A file's size: bytes, kilobytes with one decimal, megabytes with two, in the locale's digits and its unit's name
 * (French writes octets: Ko, Mo). No grouping, as before: 1023.9 KB, not 1,023.9 KB.
 */
export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return t("format_size_bytes", { size: formatNumber(bytes, { useGrouping: false }) });
	if (bytes < 1024 * 1024) return t("format_size_kb", { size: formatNumber(bytes / 1024, fixed(1)) });
	return t("format_size_mb", { size: formatNumber(bytes / (1024 * 1024), fixed(2)) });
}
