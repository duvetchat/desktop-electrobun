import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { LICENSES_FILE, loadLicenses, type Licenses } from "./licenses";

// The Licenses page's notices (#628) are fetched only when the page shows them, once: a failure is asked again.
const LICENSES: Licenses = { page: [], bun: [], runtime: [], assets: [], core: null };

describe("the notices", () => {
	let restore = () => {};
	afterEach(() => restore());

	test("that didn't load are asked again at the next call", async () => {
		const answers = [new Response("", { status: 404 }), Response.json(LICENSES)];
		const asked: string[] = [];
		const fetched = spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request) => {
			asked.push(input instanceof Request ? input.url : input.toString());
			return answers.shift() ?? Response.error();
		}) as typeof fetch);
		restore = () => fetched.mockRestore();
		await expect(loadLicenses()).rejects.toThrow("404");
		expect(await loadLicenses()).toEqual(LICENSES);
		expect(asked).toEqual([LICENSES_FILE, LICENSES_FILE]);
	});

	test("that loaded are kept, not fetched again", async () => {
		const fetched = spyOn(globalThis, "fetch").mockImplementation((async (_input: string | URL | Request) =>
			Response.error()) as typeof fetch);
		restore = () => fetched.mockRestore();
		expect(await loadLicenses()).toEqual(LICENSES);
		expect(fetched).not.toHaveBeenCalled();
	});

	test("are at the root of the pages, where the build writes them", () => {
		expect(LICENSES_FILE).toBe("/licenses.json");
	});
});
