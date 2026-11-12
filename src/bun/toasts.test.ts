import { describe, expect, spyOn, test } from "bun:test";
import { Toasts, toastXml, type ToastContent } from "./toasts";

// A message's toast as the webview asks for it: who, what, where, the photo's cached file, and the link that opens it.
const base: ToastContent = {
	tag: "m1",
	group: "room-1",
	title: "Ana",
	text: "Hello",
	place: "#general · Alpha",
	avatarPath: "C:\\Users\\me\\AppData\\Local\\com.duvet.desktop\\dev\\notification-avatars\\a b.png",
	launch: "duvet-dev://open/?space=s&room=r&message=m",
	silent: true,
};

// What a toast's XML holds outside its tags: no stray < or >, and no & but one of the five entities.
function wellFormed(xml: string): boolean {
	const outside = xml.replace(/<[^<>]*>/g, "");
	return !/[<>]/.test(outside) && !/&(?!(?:amp|lt|gt|quot|apos);)/.test(outside);
}

describe("a toast's XML", () => {
	test("escapes what others wrote, names included", () => {
		const xml = toastXml({ ...base, title: `<b>&"'`, text: "x < y & z" });
		expect(xml).toContain("<text>&lt;b&gt;&amp;&quot;&apos;</text>");
		expect(xml).toContain("<text>x &lt; y &amp; z</text>");
		expect(wellFormed(xml)).toBe(true);
	});

	test("drops the characters XML 1.0 can't hold", () => {
		const text = `a${String.fromCharCode(1)}b${String.fromCharCode(0xfffe)}c${String.fromCharCode(0xd800)}d`;
		expect(toastXml({ ...base, text })).toContain("<text>abcd</text>");
	});

	test("cuts a long text at 500 characters", () => {
		const text = /<text>(x+)…<\/text>/.exec(toastXml({ ...base, text: "x".repeat(10_000) }))?.[1];
		expect(text).toHaveLength(500);
	});

	test("names the place in a header, and shows the photo, only when there are", () => {
		const xml = toastXml(base);
		expect(xml).toContain('<header id="room-1" title="#general · Alpha"');
		expect(xml).toContain(
			'src="file:///C:/Users/me/AppData/Local/com.duvet.desktop/dev/notification-avatars/a%20b.png"',
		);
		const bare = toastXml({ ...base, place: null, avatarPath: null });
		expect(bare).not.toContain("<header");
		expect(bare).not.toContain("<image");
		expect(wellFormed(bare)).toBe(true);
	});

	// Windows reads a file URL's escapes in the ANSI code page: a profile folder named José, escaped as UTF-8
	// (encodeURI), read as JosÃ© and the photo didn't show. Only what a URL can't hold as it is gets escaped.
	test("names the photo's file as Windows reads it, whatever the profile folder's name", () => {
		const xml = toastXml({ ...base, avatarPath: "C:\\Users\\José\\a b#1%?.png" });
		expect(xml).toContain('src="file:///C:/Users/José/a%20b%231%25%3F.png"');
	});

	test("opens its link through the protocol, and is silent", () => {
		const xml = toastXml(base);
		expect(xml).toStartWith(
			'<toast launch="duvet-dev://open/?space=s&amp;room=r&amp;message=m" activationType="protocol">',
		);
		expect(xml).toContain('<audio silent="true"/>');
		expect(wellFormed(xml)).toBe(true);
	});

	// Before the page's first click Duvet can't play its sound (Chromium's autoplay policy): the toast makes it.
	test("makes the system's message sound when asked", () => {
		const xml = toastXml({ ...base, silent: false });
		expect(xml).toContain('<audio src="ms-winsoundevent:Notification.IM"/>');
		expect(xml).not.toContain("silent");
		expect(wellFormed(xml)).toBe(true);
	});
});

// The helper's process as a test drives it: the lines Toasts writes, and what the helper answers, says, or how it ends.
function fakeHelper() {
	const written: string[] = [];
	const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
	const stream = () => new ReadableStream<Uint8Array>({ start: (c) => void streams.push(c) });
	let end: (code: number) => void = () => {};
	const helper = {
		stdin: { write: (chunk: string) => void written.push(...chunk.split("\n").filter(Boolean)), flush() {} },
		stdout: stream(),
		stderr: stream(),
		exited: new Promise<number>((resolve) => (end = resolve)),
		exitCode: null as number | null,
		kill: () => exit(1),
	};
	const [stdout, stderr] = streams;
	const say = (to: ReadableStreamDefaultController<Uint8Array> | undefined, line: string) =>
		to?.enqueue(new TextEncoder().encode(`${line}\n`));
	function exit(code: number) {
		helper.exitCode = code;
		stdout?.close();
		stderr?.close();
		end(code);
	}
	return {
		helper,
		tags: () => written.map((line) => /"tag":"([^"]*)"/.exec(line)?.[1]),
		answer: (answer: { tag: string; error?: string }) => say(stdout, JSON.stringify(answer)),
		complain: (line: string) => say(stderr, line),
		exit,
	};
}

// What the webview asks Bun for answers whether the toast showed: one that didn't gets Duvet's notice instead.
describe("the toast helper", () => {
	test("answers whether each toast showed, as the helper says, and logs why one didn't", async () => {
		const fake = fakeHelper();
		const toasts = new Toasts("com.duvet.test", () => fake.helper);
		const errors = spyOn(console, "error").mockImplementation(() => {});
		const first = toasts.show({ ...base, tag: "m1" });
		const second = toasts.show({ ...base, tag: "m2" });
		fake.answer({ tag: "m2", error: "The notification platform is unavailable." });
		fake.answer({ tag: "m1" });
		const shown = [await first, await second];
		const logged = errors.mock.calls.map((call) => call.join(" "));
		errors.mockRestore();
		expect(shown).toEqual([true, false]);
		expect(fake.tags()).toEqual(["m1", "m2"]);
		expect(logged.some((line) => line.includes("The notification platform is unavailable."))).toBe(true);
	});

	test("a toast it doesn't answer in time, or that it ended before answering, didn't show", async () => {
		const fake = fakeHelper();
		const toasts = new Toasts("com.duvet.test", () => fake.helper, 20);
		const errors = spyOn(console, "error").mockImplementation(() => {});
		const late = await toasts.show({ ...base, tag: "late" });
		const cut = toasts.show({ ...base, tag: "cut" });
		fake.exit(1);
		const ended = await cut;
		errors.mockRestore();
		expect([late, ended]).toEqual([false, false]);
	});

	// PowerShell says why it can't run there: Constrained Language Mode refusing the WinRT types, say.
	test("logs what the helper says on stderr, and that it ended", async () => {
		const fake = fakeHelper();
		const toasts = new Toasts("com.duvet.test", () => fake.helper, 20);
		const errors = spyOn(console, "error").mockImplementation(() => {});
		const shown = toasts.show(base);
		fake.complain("Cannot find type [Windows.UI.Notifications.ToastNotificationManager]");
		fake.exit(1);
		await shown;
		await Bun.sleep(10);
		const logged = errors.mock.calls.map((call) => call.join(" "));
		errors.mockRestore();
		expect(logged.some((line) => line.includes("Cannot find type [Windows.UI.Notifications"))).toBe(true);
		expect(logged.some((line) => line.includes("ended") && line.includes("1"))).toBe(true);
	});

	test("a helper that can't start shows nothing", async () => {
		const errors = spyOn(console, "error").mockImplementation(() => {});
		const toasts = new Toasts("com.duvet.test", () => {
			throw new Error("powershell.exe was not found");
		});
		const shown = await toasts.show(base);
		errors.mockRestore();
		expect(shown).toBe(false);
	});
});
