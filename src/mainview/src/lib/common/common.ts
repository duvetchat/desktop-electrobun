const isDevServer = import.meta.env.DEV;
const isLocalEnv = import.meta.env.LOCAL_ENV;

const routes: Record<string, string> = {
	'/index.html': '/',
	'/app.html': '/app',
	'/sign-in.html': '/sign-in',
	'/sign-up.html': '/sign-up',
	'/forgot-password.html': '/forgot-password',
	'/invite.html': '/invite',
};

export function route(path: string): string {
	if (!isDevServer) return path;
	const [base, query] = path.split('?');
	const clean = routes[base] ?? base;
	return query ? `${clean}?${query}` : clean;
}

export function getHostURL(): string {
	let base = 'duvet-api.andremor.eu.org';
	let protocol = 'https://';
	if (isLocalEnv) {
		base = import.meta.env.HOST_URL || 'localhost:8080';
		protocol = import.meta.env.HOST_PROTOCOL || 'http://';
	}

	return protocol + base;
}

export function getWSHostURL(): string {
	let base = 'duvet-ws.andremor.eu.org';
	let protocol = 'wss://'
	if (isLocalEnv) {
		base = import.meta.env.HOST_WS_URL || 'localhost:8081';
		protocol = import.meta.env.HOST_WS_PROTOCOL || 'ws://';
	}

	return protocol + base;
}

