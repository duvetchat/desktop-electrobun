import { expect, test } from "bun:test";
import { busyLabel, ERROR_NOTE, FIELD_ERROR, FIELD_LABEL, fieldClass, spinnerClass } from "./overlay-forms";

const classes = (list: string) => list.split(/\s+/);

test("a field is 38 px tall on the card's fill, and draws its own focus ring", () => {
	const line = classes(fieldClass());
	expect(line).toEqual(expect.arrayContaining(["h-[38px]", "rounded-[11px]", "bg-duvet-card"]));
	// Recessed inside a hairline. The app's outline for a focused element stays off it (app.css): its own mark is
	// the accent's line inside a tint, and danger's line while it reads wrong.
	expect(line).toContain("shadow-[var(--duvet-shadow-well),0_0_0_1px_var(--duvet-line)]");
	expect(line).toContain("focus-override");
	expect(line).toContain(
		"focus:shadow-[var(--duvet-shadow-well),0_0_0_1px_var(--duvet-accent),0_0_0_4px_var(--duvet-accent-tint)]",
	);
	expect(line).toContain("aria-invalid:shadow-[var(--duvet-shadow-well),0_0_0_1px_var(--duvet-danger)]");
	expect(line).toContain("motion-reduce:transition-none");
});

test("a field of several lines has no fixed height and isn't resized by default", () => {
	const area = classes(fieldClass("area"));
	expect(area).not.toContain("h-[38px]");
	expect(area).toContain("resize-none");
	expect(area).toContain("bg-duvet-card");
});

test("labels are in the second ink, and what's wrong in the danger color", () => {
	expect(classes(FIELD_LABEL)).toContain("text-duvet-ink2");
	expect(classes(FIELD_ERROR)).toContain("text-duvet-danger");
	expect(classes(ERROR_NOTE)).toContain("text-duvet-danger");
});

test("a spinner takes the ink of what holds it", () => {
	expect(classes(spinnerClass())).toEqual(expect.arrayContaining(["size-3.5", "animate-spin", "border-t-current"]));
	expect(classes(spinnerClass("lg"))).toContain("size-6");
});

test("a busy button's label ends in one ellipsis character", () => {
	expect(busyLabel("Delete")).toBe("Delete…");
	expect(busyLabel("Delete...")).toBe("Delete…");
	expect(busyLabel("Joining…")).toBe("Joining…");
});

test("sheets, Settings and the sign-in pages draw one field", async () => {
	const { fieldClass: one } = await import("$lib/components/ui/recipes");
	const settings = await import("$lib/components/settings/recipes");
	expect(fieldClass()).toBe(one("line"));
	expect(settings.FIELD).toBe(one("line"));
	expect(settings.FIELD_SM).toBe(one("sm"));
	expect(classes(settings.FIELD_SM)).toContain("h-8");
	expect(classes(settings.FIELD_AREA)).toEqual(expect.arrayContaining(classes(one("area"))));
});
