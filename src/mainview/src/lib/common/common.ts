const isDevServer = import.meta.env.DEV;

const routes: Record<string, string> = {
	"/index.html": "/",
	"/app.html": "/app",
	"/sign-in.html": "/sign-in",
	"/sign-up.html": "/sign-up",
	"/forgot-password.html": "/forgot-password",
	"/invite.html": "/invite",
	"/verify.html": "/verify",
	"/reset-password.html": "/reset-password",
	"/change-email.html": "/change-email",
};

export function route(path: string): string {
	if (!isDevServer) return path;
	const [base, query] = path.split("?");
	const clean = routes[base] ?? base;
	return query ? `${clean}?${query}` : clean;
}

export function getHostURL(): string {
	let base: string;
	let protocol: string = "https://";
	switch (VITE_DOMAIN_TARGET_ENV) {
		case "n128":
			base = "duvet-api.n128.xyz";
			break;

		case "local":
			base = "localhost:9876";
			protocol = "http://";
			break;

		case "andremor":
		default:
			base = "duvet-api.andremor.eu.org";
	}

	return protocol + base;
}

export function getAvatarURL(_userId: string, avatar: string | null | undefined): string | null {
	if (!avatar) return null;
	if (avatar.startsWith("http://") || avatar.startsWith("https://")) return avatar;
	return `${getHostURL()}/attachments/${avatar}`;
}

export function getWSHostURL(): string {
	let base: string;
	let protocol: string = "wss://";
	switch (VITE_DOMAIN_TARGET_ENV) {
		case "n128":
			base = "duvet-gateway.n128.xyz";
			break;

		case "local":
			base = "localhost:8765";
			protocol = "ws://";
			break;

		case "andremor":
		default:
			base = "duvet-ws.andremor.eu.org";
	}

	return protocol + base;
}
