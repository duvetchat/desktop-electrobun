import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "svelte/server";
import { NOTICES } from "$lib/e2e/notices";
import conventions from "$lib/e2e/testing/e2e-conventions.json";
import en from "../../../../messages/en.json";
import { tags } from "../server-render";

// A contact's security number (PLAN-E2E-CLIENTES.md, Task 28; decision 25): its 60 digits in 12 groups of 5 and its
// QR, which Android scans, and Mark as verified for the person who compared them; the dialog that shows it opens from a
// contact's profile, their menu and a changed key's notice.
const { default: SafetyNumber } = await import("./SafetyNumber.svelte");

const DIGITS = "12345 67890 13579 24680 11223 34455 66778 89900 98765 43210 10293 84756";
const QR = conventions.safety_qr.qr;
type Props = { number: { digits: string; qr: string } | null; verified: boolean; problem: string | null };
const props = (given: Partial<Props> = {}) => ({
	...{ name: "Bo", number: { digits: DIGITS, qr: QR }, verified: false, problem: null, busy: false },
	onVerify: () => {},
	...given,
});
const drawn = (given: Partial<Props> = {}) =>
	render(SafetyNumber, { props: props(given) })
		.body.replace(/<!--[^]*?-->/g, "")
		.replaceAll("&#39;", "'");
const groupsOf = (html: string) => [...html.matchAll(/<li[^>]*>\s*([^<]*?)\s*<\/li>/g)].map((match) => match[1]);

describe("a contact's security number", () => {
	test("its 60 digits in 12 groups of 5, as the core gives them", () => {
		const groups = groupsOf(drawn());
		expect(groups).toHaveLength(12);
		expect(groups.every((group) => /^\d{5}$/.test(group ?? ""))).toBe(true);
		expect(groups.join(" ")).toBe(DIGITS);
	});

	test("its QR is the core's qr as its text, which the other's phone scans, with how to compare", async () => {
		const drawnTags = await tags(SafetyNumber, props());
		const svg = drawnTags.find((tag) => tag.name === "svg" && tag.attributes.role === "img");
		expect(svg?.attributes["aria-label"]).toBe(en.e2e_safety_qr_label.replace("{name}", "Bo"));
		expect(drawn()).toContain(en.e2e_safety_compare.replace("{name}", "Bo"));
		// The QR's own test holds what it draws to its text (QrCode.test.ts): here, that the text is the core's qr.
		const source = readFileSync(join(import.meta.dir, "SafetyNumber.svelte"), "utf8").replaceAll("\r\n", "\n");
		expect(source).toMatch(/<QrCode text=\{number\.qr\}/);
	});

	test("Mark as verified for one not verified yet; the mark once they are", () => {
		expect(drawn()).toMatch(/<button [^>]*>\s*Mark as verified\s*<\/button>/);
		const verified = drawn({ verified: true });
		expect(verified).not.toContain("Mark as verified");
		expect(verified).toContain(`aria-label="${NOTICES.verified}"`);
		expect(en.e2e_mark_verified).toBe(NOTICES.mark_verified);
	});

	test("while it loads, nothing to compare; what went wrong, said", () => {
		const loading = drawn({ number: null });
		expect(groupsOf(loading)).toEqual([]);
		expect(loading).not.toContain("Mark as verified");
		expect(loading).toContain(en.e2e_safety_loading);
		const failed = drawn({ number: null, problem: en.e2e_safety_failed });
		expect(failed).toMatch(new RegExp(`role="alert"[^>]*>\\s*${en.e2e_safety_failed.replace(/[.]/g, "\\.")}`));
		expect(failed).not.toContain(en.e2e_safety_loading);
	});
});

describe("the security number's dialog", () => {
	const dialog = readFileSync(join(import.meta.dir, "SafetyNumberDialog.svelte"), "utf8").replaceAll("\r\n", "\n");
	const shared = readFileSync(join(import.meta.dir, "../../e2e/encryption.svelte.ts"), "utf8").replaceAll("\r\n", "\n");
	const page = readFileSync(join(import.meta.dir, "../../../routes/app/+page.svelte"), "utf8").replaceAll("\r\n", "\n");

	test("is one for the app, opened by whoever names a contact", () => {
		// Kept apart from the engine, which another window's page (Space settings' members, whose menu asks) never loads.
		expect(shared).toContain("export const safetyNumberRequest = writable<");
		expect(dialog).toContain('import { encryption, safetyNumberRequest } from "$lib/e2e/encryption.svelte";');
		expect(page).toMatch(/import SafetyNumberDialog from "\$lib\/components\/e2e\/SafetyNumberDialog\.svelte";/);
		expect(page).toContain("<SafetyNumberDialog />");
		expect(dialog).toMatch(/<Sheet\b[^>]*>\s*<SafetyNumber\b/);
	});

	test("a no in Bun's own box changes nothing, and says nothing is wrong", () => {
		expect(dialog).toContain('if (error instanceof CoreError && error.code === "refused") return;');
	});

	test("marks only the number the person compared, and shows the new one when it changed meanwhile", () => {
		expect(dialog).toMatch(/verifyContact\(asked\.id, shown\.digits\)/);
		expect(dialog).toContain('t("e2e_safety_changed", { name: request.name })');
	});

	test("opens from a contact's menu and profile, as the menu's rule offers it, and the profile wears the mark", () => {
		const menu = readFileSync(join(import.meta.dir, "../MemberMenu.svelte"), "utf8").replaceAll("\r\n", "\n");
		const popover = readFileSync(join(import.meta.dir, "../MemberProfilePopover.svelte"), "utf8").replaceAll(
			"\r\n",
			"\n",
		);
		expect(menu).toMatch(
			/\{#if items\.verify\}\s*<MenuItem\s+icon=\{ShieldCheck\}\s+onSelect=\{\(\) => afterClose\(\(\) => safetyNumberRequest\.set\(\{ id: person\.id, name: person\.name \}\)\)\}/,
		);
		expect(menu).toContain('encrypted: encryption.state.name === "ready",');
		expect(popover).toMatch(
			/const canVerifyThem = \$derived\(\s*encryption\.state\.name === "ready" &&\s*!!\$currentUser &&\s*canVerify\(/,
		);
		expect(popover).toContain("safetyNumberRequest.set({ id: member.id, name: member.username });");
		expect(popover).toMatch(/\{#if encryption\.contacts\.verified\[member\.id\]\}\s*<VerifiedMark\b/);
		// What the profile shows of them is the core's as they're seen now: looked at as it opens.
		expect(popover).toMatch(/\$effect\(\(\) => \{\s*if \(shown && canVerifyThem\) void contactOf\(member\.id\)/);
	});
});
