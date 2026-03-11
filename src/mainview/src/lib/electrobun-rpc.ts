export type AppRPCSchema = {
	bun: {
		requests: {};
		messages: {
			closeWindow: void;
			minimizeWindow: void;
			maximizeWindow: void;
		};
	};
	webview: {
		requests: {};
		messages: {};
	};
};

export type AppRPCClient = {
	send: {
		closeWindow: () => void;
		minimizeWindow: () => void;
		maximizeWindow: () => void;
	};
};

let rpcPromise: Promise<AppRPCClient | null> | null = null;

function isElectrobunWindow() {
	return typeof window !== "undefined" && "__electrobunWindowId" in window;
}

async function createRpcClient(): Promise<AppRPCClient | null> {
	if (!isElectrobunWindow()) return null;

	const { Electroview } = await import("electrobun/view");
	const rpc = Electroview.defineRPC<AppRPCSchema>({
		handlers: {
			requests: {},
			messages: {},
		},
	});

	new Electroview({ rpc });
	return rpc as unknown as AppRPCClient;
}

export async function getElectrobunRpc() {
	if (!rpcPromise) {
		rpcPromise = createRpcClient().catch((error) => {
			rpcPromise = null;
			throw error;
		});
	}

	return rpcPromise;
}
