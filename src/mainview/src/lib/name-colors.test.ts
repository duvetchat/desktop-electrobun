import { describe, expect, test } from "bun:test";
import { nameColor, nameColors } from "$lib/name-colors";
import type { MemberOnSidebar, Role } from "$lib/types";

const role = (position: number, colors: Partial<Role> = {}): Role => ({
	id: `role-${position}`,
	name: `Role ${position}`,
	color_from: null,
	color_via: null,
	color_to: null,
	permissions: 0,
	hoisted: false,
	position,
	...colors,
});
const member = (id: string, roles: Role[]): Pick<MemberOnSidebar, "id" | "roles"> => ({ id, roles });

// A member's name above their messages takes their highest coloured role's colour, in the list and the previews alike.
describe("nameColor", () => {
	test("is the highest coloured role's colour", () => {
		expect(
			nameColor(member("a", [role(1, { color_from: 0x112233 }), role(3, { color_from: 0xe5484d }), role(5)])),
		).toBe("color: #e5484d");
	});

	test("is that role's gradient across the name, through its middle colour when it has one", () => {
		const style = nameColor(member("a", [role(2, { color_from: 0xff0000, color_via: 0x00ff00, color_to: 0x0000ff })]));
		expect(style).toStartWith("background: linear-gradient(90deg, #ff0000, #00ff00, #0000ff);");
		expect(style).toContain("background-clip: text;");
	});

	test("is nothing for a member none of whose roles has a colour", () => {
		expect(nameColor(member("a", [role(1), role(2)]))).toBe("");
		expect(nameColor(member("a", []))).toBe("");
	});

	test("nameColors keeps each member's by user ID", () => {
		expect(nameColors([member("a", [role(1, { color_from: 0x0000ff })]), member("b", [])])).toEqual({
			a: "color: #0000ff",
			b: "",
		});
	});
});
