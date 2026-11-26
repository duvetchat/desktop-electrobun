import { describe, expect, test } from "bun:test";
import { notice, NOTICES, type NoticeKey } from "./notices";
import en from "../../../messages/en.json";
import conventions from "./testing/e2e-conventions.json";

// The notices are the same in both apps: the table of PLAN-E2E-CLIENTES.md's notices, as the conventions' file has it
// for the mobile app's test too.
const isNotice = (key: string): key is NoticeKey => Object.hasOwn(NOTICES, key);

describe("the notices", () => {
	test("are the table's, every one and nothing else", () => {
		expect(conventions.notices).toEqual(NOTICES);
	});

	test("fill their names, and leave a value's own braces alone", () => {
		for (const { key, values, text } of conventions.filled_notices) {
			expect(isNotice(key) && notice(key, values)).toBe(text);
		}
	});

	test("the mobile app's five say their words here too", () => {
		// An edit or a deletion refused for good, a row not read yet, a send refused as not ready or past the cap.
		const words: [keyof typeof en, NoticeKey][] = [
			["e2e_edit_refused", "edit_refused"],
			["e2e_delete_refused", "delete_refused"],
			["e2e_loading_message", "loading_message"],
			["e2e_not_ready", "not_ready"],
			["e2e_too_many_waiting", "too_many_waiting"],
		];
		for (const [key, table] of words) expect(en[key]).toBe(NOTICES[table]);
	});

	test("a new device's setup and its approval say the table's words", () => {
		// The plan's own words (Task 26) and what both apps must say alike: the mobile app takes the same.
		const words: [keyof typeof en, NoticeKey][] = [
			["e2e_use_code", "use_code"],
			["e2e_approval_code_hint", "approval_code_hint"],
			["e2e_code_accepted", "code_accepted"],
			["e2e_code_mismatch", "code_mismatch"],
			["e2e_approval_ask", "approval_ask"],
			["e2e_approval_confirm_after", "approval_confirm_after"],
			["e2e_start_over_warning", "start_over_warning"],
		];
		for (const [key, table] of words) {
			expect(NOTICES[table]).toEqual(expect.any(String));
			expect(en[key]).toBe(NOTICES[table]);
		}
	});

	test("a conversation's members say the table's words", () => {
		// The add sheet's full group, a restart's question and refusal, a change of the members not answered yet (task 22).
		const words: [keyof typeof en, NoticeKey][] = [
			["e2e_group_full", "group_full"],
			["e2e_restart_leaves_out", "restart_leaves_out"],
			["e2e_restart_refused", "restart_refused"],
			["e2e_members_now", "members_now"],
			["e2e_change_unanswered", "change_unanswered"],
			["e2e_no_device", "no_device"],
		];
		for (const [key, table] of words) expect(en[key]).toBe(NOTICES[table]);
	});

	test("a conversation's files say the table's words", () => {
		// The app's words for them (en.json, which t() reads) are the notices', key for key: the mobile app takes the same.
		const words: [keyof typeof en, NoticeKey][] = [
			["e2e_file_encrypted", "file_encrypted"],
			["e2e_file_progress", "file_progress"],
			["e2e_file_altered", "file_altered"],
			["e2e_file_unavailable", "file_unavailable"],
			["e2e_file_download_failed", "file_download_failed"],
			["e2e_files_gone", "files_gone"],
			["e2e_gif_failed", "gif_failed"],
			["e2e_file_save", "file_save"],
			["e2e_file_save_named", "file_save_named"],
			["e2e_file_play", "file_play"],
			["e2e_file_show", "file_show"],
			["e2e_file_named", "file_named"],
		];
		for (const [key, table] of words) expect(en[key]).toBe(NOTICES[table]);
	});
});
