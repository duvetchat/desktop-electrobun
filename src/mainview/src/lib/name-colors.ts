import type { MemberOnSidebar } from "$lib/types";

const hex = (n: number) => `#${(n >>> 0).toString(16).padStart(6, "0")}`;

/**
 * The style of a member's name above their messages, in the chat and the previews: the colour of their highest role that
 * has one, or that role's gradient across the name; "" when none of their roles has a colour.
 */
export function nameColor(member: Pick<MemberOnSidebar, "roles">): string {
	const highest = [...member.roles]
		.filter((r) => r.color_from != null)
		.sort((a, b) => b.position - a.position)
		.at(0);
	if (!highest || highest.color_from == null) return "";
	const from = hex(highest.color_from);
	if (highest.color_to == null) return `color: ${from}`;
	const to = hex(highest.color_to);
	const via = highest.color_via != null ? `, ${hex(highest.color_via)}` : "";
	return `background: linear-gradient(90deg, ${from}${via}, ${to}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;`;
}

/** Each member's name style (nameColor), by user ID. */
export function nameColors(members: Pick<MemberOnSidebar, "id" | "roles">[]): Record<string, string> {
	return Object.fromEntries(members.map((m) => [m.id, nameColor(m)]));
}
