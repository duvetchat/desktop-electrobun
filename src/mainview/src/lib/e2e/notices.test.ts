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
