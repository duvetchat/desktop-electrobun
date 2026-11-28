// A notice that asks nothing on Linux and macOS (PLAN-E2E-PLATAFORMAS.md, Task 6; its Ruling 3): a new device's
// fingerprints (confirm.ts' newDeviceNotice) in a window of Bun's own, where Windows shows its system's box (confirm.ts'
// windowsNotice). The app's page can't draw on it: it's another window, whose page Bun writes.
//
// - **Nothing in it reaches Bun:** the window is Electrobun's sandbox, whose page gets no RPC, no bun bridge, no internal
//   bridge and no socket key, and it's made with no RPC of its own.
// - **Its page is Bun's:** HTML made from the notice, its text escaped, with no script, as the window's address (a data:
//   URL). Electrobun's `html` would first load the window's empty address, which on Linux is https://www.wikipedia.org
//   (its CEF wrapper's default), and the notice only 100 ms later.
// - **It goes nowhere else:** once its page is in (dom-ready), `^*` is its only navigation rule: no link, dropped file or
//   other page.
// - **The page's window can't cover it:** it's kept above other windows, as Windows' box is (MB_TOPMOST).
// - **Only the first takes the foreground:** Electrobun brings every window it makes to the front, with the keyboard (its
//   showWindow), so a notice that replaces the one shown (the QR's renewal, every 9 minutes: RM5) is written into the same
//   window, as text, by a script of Bun's: the page itself has none. A window the person closed stays closed for the rest
//   of its run, as a new one would come in front.
import { language } from "../i18n";
import type { Rect } from "../window-frame";
import type { Notice, NoticeBox } from "./confirm";

/** The window's size: room for a new device's notice, which the person may resize. */
export const NOTICE_SIZE = { width: 460, height: 380 };

/** What a notice's window is made with: Electrobun's BrowserWindow takes these as they are. */
export interface NoticeWindowOptions {
	title: string;
	url: string;
	sandbox: true;
	frame: Rect;
}

/** What a notice needs of the window made for it (Electrobun's BrowserWindow, or a test's). */
export interface NoticeWindow {
	setTitle(title: string): void;
	setAlwaysOnTop(on: boolean): void;
	close(): void;
	on(event: "close", run: () => void): void;
	webview: {
		on(event: "dom-ready", run: () => void): void;
		setNavigationRules(rules: string[]): void;
		executeJavascript(js: string): void;
	};
}

/** Text as HTML gives it back: the five characters markup reads, as numeric references. */
const escaped = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** The notice's page, as the window's address: its words, escaped, with no script, in the language Bun speaks. */
export function noticePage({ title, message }: Notice): string {
	const html =
		`<!doctype html><html lang="${language()}"><head><meta charset="utf-8"><meta name="color-scheme" content="light dark">` +
		`<title>${escaped(title)}</title><style>body{margin:0;padding:20px 24px;font:14px/1.5 system-ui,sans-serif;` +
		`white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body>${escaped(message)}</body></html>`;
	return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/** What shows another notice in the window's page: its words as text, never as markup. */
const written = ({ title, message }: Notice) =>
	`document.title = ${JSON.stringify(title)}; document.body.textContent = ${JSON.stringify(message)};`;

/**
 * confirm.ts' `open` off Windows: a notice in a window `make` makes (index.ts: Electrobun's BrowserWindow), over the
 * middle of the main window (`around`), or where the system puts it when that can't be read.
 */
export function noticeWindow(
	make: (options: NoticeWindowOptions) => NoticeWindow,
	around: () => Rect,
): (notice: Notice) => NoticeBox {
	return (notice) => {
		let frame: Rect = { x: 0, y: 0, ...NOTICE_SIZE };
		try {
			const main = around();
			frame = {
				x: Math.round(main.x + (main.width - NOTICE_SIZE.width) / 2),
				y: Math.round(main.y + (main.height - NOTICE_SIZE.height) / 2),
				...NOTICE_SIZE,
			};
		} catch (error) {
			console.error("[e2e] the main window's place wasn't read for a notice:", error);
		}
		const window = make({ title: notice.title, url: noticePage(notice), sandbox: true, frame });
		// One that can't be kept above still shows: the person can bring it back to compare.
		try {
			window.setAlwaysOnTop(true);
		} catch (error) {
			console.error("[e2e] a notice's window couldn't be kept above the others:", error);
		}
		let shown = notice;
		let loaded = false;
		let open = true;
		window.webview.on("dom-ready", () => {
			window.webview.setNavigationRules(["^*"]);
			if (loaded) return;
			loaded = true;
			// A notice that came while the page loaded.
			if (shown !== notice) window.webview.executeJavascript(written(shown));
		});
		window.on("close", () => (open = false));
		return {
			close() {
				if (open) window.close();
				open = false;
			},
			replace(next) {
				if (!open) return;
				shown = next;
				window.setTitle(next.title);
				if (loaded) window.webview.executeJavascript(written(next));
			},
		};
	};
}
