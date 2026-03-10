export function getHostURL(): string {
	const base = "duvet-api.andremor.eu.org";
	const protocol = "https://";

	return protocol + base;
}

export function getWSHostURL(): string {
	const base = "duvet-ws.andremor.eu.org";
	const protocol = "wss://";

	return protocol + base;
}

/*
export function getHostURL(): string {
    const base = 'localhost:8080';
    const protocol = 'http://';

    return protocol + base;
}

export function getWSHostURL(): string {
    const base = 'localhost:8081';
    const protocol = 'ws://';

    return protocol + base;
}
*/
