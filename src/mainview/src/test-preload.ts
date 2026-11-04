import { afterAll } from "bun:test";

// bun test runs every test file in one global object, one after the other: a file that replaces fetch and doesn't put
// it back answers every later file's requests with its own mock (#166). Loaded before any test file (bunfig.toml), this
// keeps the real one, and fails the run if it isn't back once the last file has run.
const realFetch = globalThis.fetch;

afterAll(() => {
	if (globalThis.fetch !== realFetch) {
		throw new Error("a test file left globalThis.fetch replaced: put the real one back when its tests end (#166)");
	}
});
