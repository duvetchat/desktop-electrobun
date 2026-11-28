import { t } from "$lib/i18n";

// A flag's and a badge's name are words (#464): each is a getter that asks t() as it's shown, so the lists hold no
// words of the language they were loaded in.
export const FLAGS = [
	{
		flag: 1 << 0,
		get name() {
			return t("shell_flag_staff");
		},
	},
] as const;

export const BADGES = [
	{
		flag: 1 << 0,
		get name() {
			return t("shell_badge_silly");
		},
		icon: "/badges/silly.webp",
	},
] as const;

export const FLAG_STAFF = 1 << 0;

export function isStaff(flags: number): boolean {
	return (flags & FLAG_STAFF) !== 0;
}
