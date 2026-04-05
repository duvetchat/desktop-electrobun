export const FLAGS = [
	{ flag: 1 << 0, name: "Staff" },
] as const;

export const BADGES = [
	{ flag: 1 << 0, name: "Silly", icon: "/badges/silly.webp" },
] as const;

export const FLAG_STAFF = 1 << 0;

export function isStaff(flags: number): boolean {
	return (flags & FLAG_STAFF) !== 0;
}
