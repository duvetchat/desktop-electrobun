import { BrowserWindow } from "electrobun/bun";

const appUrl = "views://mainview/index.html";

new BrowserWindow({
	// titleBarStyle: "default",
	// titleBarStyle: "hiddenInset",
	titleBarStyle: "hidden",
	renderer: "native",
	sandbox: false,
	frame: {
		height: 900,
		width: 1400,
		x: 0,
		y: 0,
	},
	title: "Duvet",
	url: appUrl,
});
