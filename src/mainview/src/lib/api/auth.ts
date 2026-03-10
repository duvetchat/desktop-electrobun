import { getHostURL } from "$lib/common/common";

const HOST = getHostURL();

export async function signIn(options: {
	username: string;
	alias: string | null;
	password: string;
	email: string;
}) {
	const response = await fetch(`${HOST}/api/auth/signin`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(options),
	});

	if (!response.ok) {
		throw new Error(`Sign-in failed: ${await response.text()}`);
	}
}

export async function logIn(options: {
	password: string;
	email: string;
}): Promise<{ token: string }> {
	const response = await fetch(`${HOST}/api/auth/login`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(options),
	});

	if (!response.ok) {
		throw new Error(`Log-in failed: ${await response.text()}`);
	}

	return response.json() as Promise<{ token: string }>;
}
