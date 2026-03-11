import { BrowserView, BrowserWindow } from "electrobun/bun";

type AppRPCSchema = {
	bun: {
		requests: {};
		messages: {
			closeWindow: void;
			minimizeWindow: void;
			maximizeWindow: void;
			setWindowFrame: {
				x: number;
				y: number;
				width: number;
				height: number;
			};
			startWindowResize: { direction: string };
			stopWindowResize: void;
		};
	};
	webview: {
		requests: {};
		messages: {};
	};
}

const appUrl = "views://mainview/index.html";
const rpc = BrowserView.defineRPC<AppRPCSchema>({
	handlers: {
		messages: {
			closeWindow: () => win.close(),
			minimizeWindow: () => win.minimize(),
			maximizeWindow: () => {
				if (win.isMaximized()) {
					win.unmaximize();
					return;
				}

				win.maximize();
			},
		},
	},
});

const win = new BrowserWindow({
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
	rpc
});
