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

test("asks for the latest copy of the file, streamed by the API rather than redirected to storage", async () => {
	answer("text");
	await readTextPreview("https://api.test/attachments/x?sig=a&exp=1");
	expect(fetched.mock.calls[0]?.[0]).toBe("https://api.test/attachments/x?sig=a&exp=1&stream=1");
	expect(fetched.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store", credentials: "include" });
});

test("reads the file's own URL when the stream doesn't take it", async () => {
	const url = "https://api.test/attachments/x";
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a fetch that answers this test's file
	fetched.mockImplementationOnce((async () => new Response("no", { status: 400 })) as unknown as typeof fetch);
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a fetch that answers this test's file
	fetched.mockImplementationOnce((async () => new Response("the file")) as unknown as typeof fetch);
	expect(await readTextPreview(url)).toEqual({ text: "the file", truncated: false });
	expect(fetched.mock.calls.map((call) => call[0])).toEqual([`${url}?stream=1`, url]);
});

test("fails when the file can't be read", async () => {
	answer("not here", 404);
	await expect(readTextPreview("https://api.test/file")).rejects.toThrow("HTTP 404");
});

test("a megabyte is the most it shows", () => {
	expect(TEXT_PREVIEW_LIMIT).toBe(1_000_000);
});
