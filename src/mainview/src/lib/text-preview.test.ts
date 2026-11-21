import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { readTextPreview, TEXT_PREVIEW_LIMIT } from "$lib/text-preview";

let fetched: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

beforeEach(() => {
	fetched = spyOn(globalThis, "fetch");
});

afterEach(() => {
	fetched.mockRestore();
});

function answer(body: string, status = 200) {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a fetch that answers this test's file
	fetched.mockImplementation((async () => new Response(body, { status })) as unknown as typeof fetch);
}

test("reads the file's text, cut to the preview's size", async () => {
	answer("hello world");
	expect(await readTextPreview("https://api.test/file", 5)).toEqual({ text: "hello", truncated: true });
	// A file no longer than the preview is whole.
	expect(await readTextPreview("https://api.test/file", 11)).toEqual({ text: "hello world", truncated: false });
});

test("asks for the latest copy of the file", async () => {
	answer("text");
	await readTextPreview("https://api.test/file");
	expect(fetched!.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store" });
});

test("fails when the file can't be read", async () => {
	answer("not here", 404);
	await expect(readTextPreview("https://api.test/file")).rejects.toThrow("HTTP 404");
});

test("a megabyte is the most it shows", () => {
	expect(TEXT_PREVIEW_LIMIT).toBe(1_000_000);
});
