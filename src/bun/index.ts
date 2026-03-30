import { BrowserView, BrowserWindow, Updater } from "electrobun/bun";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
	if (channel === "dev") {
		try {
			await fetch(DEV_SERVER_URL, { method: "HEAD" });
			console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);

			return DEV_SERVER_URL;
		} catch {
			console.log("Vite dev server not running. Run 'bun run dev:hmr' for HMR support.");
		}
	}

	return "views://mainview/index.html";
}

const url = await getMainViewUrl();

type AppRPCSchema = {
	bun: {
		requests: {};
		messages: {
			closeWindow: void;
			minimizeWindow: void;
			maximizeWindow: { availX: number; availY: number; availWidth: number; availHeight: number };
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
};

let savedFrame: { x: number; y: number; width: number; height: number } | null = null;
let isManuallyMaximized = false;

const rpc = BrowserView.defineRPC<AppRPCSchema>({
	handlers: {
		messages: {
			closeWindow: () => win.close(),
			minimizeWindow: () => win.minimize(),
			maximizeWindow: ({ availX, availY, availWidth, availHeight }) => {
				if (isManuallyMaximized && savedFrame) {
					win.setFrame(savedFrame.x, savedFrame.y, savedFrame.width, savedFrame.height);
					isManuallyMaximized = false;
					savedFrame = null;
					return;
				}

				savedFrame = win.getFrame();
				win.setFrame(availX, availY, availWidth, availHeight);
				isManuallyMaximized = true;
			},
		},
	},
});

const currentOS = process.platform;

const rendererType = currentOS === "linux" ? "cef" : "native";

const win = new BrowserWindow({
	titleBarStyle: "hidden",
	renderer: rendererType,
	sandbox: false,
	frame: {
		height: 900,
		width: 1400,
		x: 0,
		y: 0,
	},
	title: "Duvet",
	url,
	rpc,
});
