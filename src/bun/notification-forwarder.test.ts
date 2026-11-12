import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forward, forwarderScript } from "./notification-forwarder";

const dir = await mkdtemp(join(tmpdir(), "duvet-forwarder-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

// A pipe of each test's own: a named pipe on Windows, a socket file elsewhere (the CI runs on Linux).
let pipes = 0;
const pipePath = () =>
	process.platform === "win32"
		? `\\\\.\\pipe\\duvet-open-test-${process.pid}-${++pipes}`
		: join(dir, `open-${++pipes}.sock`);

// A running Duvet's pipe, which keeps every line it gets.
function listen(pipe: string) {
	const lines: string[] = [];
	const server = Bun.listen({
		unix: pipe,
		socket: { data: (_socket, raw) => void lines.push(...raw.toString().split("\n").filter(Boolean)) },
	});
	return { lines, stop: () => server.stop(true) };
}

async function until(done: () => boolean, ms = 10_000) {
	const end = Date.now() + ms;
	while (!done() && Date.now() < end) await Bun.sleep(25);
}

// A Duvet started by the forwarder (its launcher): it listens on the pipe after a while, as an app starting does, and
// after a few seconds more writes what it got to a file, so the file shows it outlived the forwarder.
const stubPath = join(dir, "duvet-stub.ts");
await Bun.write(
	stubPath,
	[
		"const [pipe, out] = process.argv.slice(2);",
		"await Bun.sleep(300);",
		"const got = [];",
		"Bun.listen({ unix: pipe, socket: { data: (_s, raw) => void got.push(raw.toString()) } });",
		"await Bun.sleep(3000);",
		"await Bun.write(out, got.join(''));",
		"process.exit(0);",
	].join("\n"),
);

const URL_SENT = "duvet-test://open/?conversation=01920000-0000-7000-8000-00000000d001";

describe("the notification link forwarder", () => {
	test("hands the link to the Duvet that listens", async () => {
		const pipe = pipePath();
		const duvet = listen(pipe);
		await forward(pipe, [], URL_SENT);
		await until(() => duvet.lines.length > 0);
		duvet.stop();
		expect(duvet.lines.map((l) => JSON.parse(l))).toEqual([{ type: "OPEN_URL", url: URL_SENT }]);
	});

	test("with no Duvet listening, starts one and hands it the link once its pipe is up", async () => {
		const pipe = pipePath();
		const out = join(dir, "started.txt");
		await forward(pipe, [process.execPath, stubPath, pipe, out], URL_SENT);
		await until(() => Bun.file(out).size > 0);
		expect(JSON.parse(await Bun.file(out).text())).toEqual({ type: "OPEN_URL", url: URL_SENT });
	});

	test("runs as the script Windows starts, with the link as its argument", async () => {
		const pipe = pipePath();
		const duvet = listen(pipe);
		const script = join(dir, "notification-forwarder.js");
		await Bun.write(script, forwarderScript(pipe, []));
		const proc = Bun.spawn([process.execPath, script, URL_SENT], { stdout: "ignore", stderr: "pipe" });
		expect(await proc.exited).toBe(0);
		await until(() => duvet.lines.length > 0);
		duvet.stop();
		expect(duvet.lines.map((l) => JSON.parse(l))).toEqual([{ type: "OPEN_URL", url: URL_SENT }]);
	});

	// Bun puts the processes it starts on Windows in a job that ends them with it: the launcher goes through
	// cmd /c start, whose child is out of that job, so the Duvet it starts outlives the forwarder.
	test.skipIf(process.platform !== "win32")("the Duvet it starts outlives it, on Windows", async () => {
		const pipe = pipePath();
		const out = join(dir, "outlived.txt");
		const script = join(dir, "notification-forwarder-start.js");
		const launcher = ["cmd.exe", "/d", "/c", "start", "", "/b", process.execPath, stubPath, pipe, out];
		await Bun.write(script, forwarderScript(pipe, launcher));
		const proc = Bun.spawn([process.execPath, script, URL_SENT], { stdout: "ignore", stderr: "ignore" });
		expect(await proc.exited).toBe(0);
		await until(() => Bun.file(out).size > 0);
		expect(JSON.parse(await Bun.file(out).text())).toEqual({ type: "OPEN_URL", url: URL_SENT });
	});
});
