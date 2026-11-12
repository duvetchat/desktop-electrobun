import { describe, expect, test } from "bun:test";
import { toastXml, type ToastContent } from "./toasts";

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
