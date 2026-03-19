const isDevServer = import.meta.env.DEV;

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
	let base: string;
	let protocol: string = 'https://';
	switch (__DOMAIN_TARGET_ENV__) {
		case 'n128':
			base = 'api.duvet.n128.xyz';
			break;

		case 'local':
			base = 'localhost:8080';
			protocol = 'http://';
			break;

		case 'andremor':
		default:
			base = 'duvet-api.andremor.eu.org';
	}

	return protocol + base;
}

export function getWSHostURL(): string {
	let base: string;
	let protocol: string = 'wss://';
	switch (__DOMAIN_TARGET_ENV__) {
		case 'n128':
			base = 'gateway.duvet.n128.xyz';
			break;

		case 'local':
			base = 'localhost:8081';
			protocol = 'ws://';
			break;

		case 'andremor':
		default:
			base = 'duvet-ws.andremor.eu.org';
	}

	return protocol + base;
}

