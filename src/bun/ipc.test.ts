import { describe, expect, test } from "bun:test";
import { ipcPath, LineReader, MAX_LINE_LENGTH } from "./ipc";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("LineReader", () => {
	test("joins a message its client wrote in pieces", () => {
		const line = '{"type":"SET_ACTIVITY","data":{"name":"nvim"}}';
		const reader = new LineReader();
		expect(reader.push(bytes(line.slice(0, 20)))).toEqual([]);
		expect(reader.push(bytes(`${line.slice(20)}\n`))).toEqual([line]);
	});

	test("keeps a character whose bytes came in two reads", () => {
		const line = '{"name":"ñ🎵"}';
		const all = bytes(`${line}\n`);
		const cut = all.indexOf(0xf0) + 2;
		const reader = new LineReader();
		expect(reader.push(all.slice(0, cut))).toEqual([]);
		expect(reader.push(all.slice(cut))).toEqual([line]);
	});

	test("gives each line of a read, and holds the unfinished one", () => {
		const reader = new LineReader();
		expect(reader.push(bytes("a\nb\nc"))).toEqual(["a", "b"]);
		expect(reader.push(bytes("\n"))).toEqual(["c"]);
	});

	test("gives up on a line past the limit", () => {
		const longest = "x".repeat(MAX_LINE_LENGTH);
		expect(new LineReader().push(bytes(`${longest}\n`))).toEqual([longest]);
		expect(new LineReader().push(bytes(`${longest}x`))).toBeNull();
		expect(new LineReader().push(bytes(`${longest}x\n`))).toBeNull();
	});
});

describe("ipcPath", () => {
	test("is the named pipe on Windows", () => {
		expect(ipcPath("win32", { XDG_RUNTIME_DIR: "/run/user/1000" })).toBe("\\\\.\\pipe\\duvet-ipc");
	});

	test("is in the first runtime or temp directory set", () => {
		expect(ipcPath("linux", { XDG_RUNTIME_DIR: "/run/user/1000", TMPDIR: "/tmp/x" })).toBe(
			"/run/user/1000/duvet-ipc.sock",
		);
		expect(ipcPath("darwin", { XDG_RUNTIME_DIR: "", TMPDIR: "/var/folders/ab/T/" })).toBe(
			"/var/folders/ab/T/duvet-ipc.sock",
		);
		expect(ipcPath("linux", {})).toBe("/tmp/duvet-ipc.sock");
	});
});
