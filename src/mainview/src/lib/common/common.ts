const isDevServer = import.meta.env.DEV;

export const DUVET_DOMAIN = "https://duvet.chat";

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
	const [base = "", query] = path.split("?");
	const clean = routes[base] ?? base;
	return query ? `${clean}?${query}` : clean;
}

export function getHostURL(): string {
	if (VITE_API_URL) return VITE_API_URL;
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
			base = "duvet-api.andremor.eu.org";
			break;

		case "duvet":
		default:
			base = "api.duvet.chat";
	}

	return protocol + base;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether value is a UUID, as Duvet's IDs are. An ID read from a message's text or a link (a message link's, a
 * bot invite's) goes into an API path only then: a "..", "/", "\", "?" or "#" in it would send the request, with
 * the user's credentials, to another endpoint.
 */
export function isUuid(value: unknown): value is string {
	return typeof value === "string" && UUID.test(value);
}

export function getAvatarURL(_userId: string, avatar: string | null | undefined): string | null {
	if (!avatar) return null;
	if (avatar.startsWith("http://") || avatar.startsWith("https://")) return avatar;
	// Otherwise an attachment's ID (the API serves no other): a webhook's message can name any text as its avatar.
	return isUuid(avatar) ? `${getHostURL()}/attachments/${avatar}` : null;
}

export function getWSHostURL(): string {
	if (VITE_WS_URL) return VITE_WS_URL;
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
			base = "duvet-ws.andremor.eu.org";
			break;

		case "duvet":
		default:
			base = "ws.duvet.chat";
	}

	return protocol + base;
}
