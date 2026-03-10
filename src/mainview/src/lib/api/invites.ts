import { userSession } from "$lib/stores.svelte";
import { getHostURL } from "$lib/common/common";

const HOST = getHostURL();

export interface InviteInfo {
	code: string;
	space_id: string;
	space_name: string;
	description: string;
	member_count: number;
}

export async function getInvite(code: string): Promise<InviteInfo> {
	const response = await fetch(
		`${HOST}/api/invites/${encodeURIComponent(code)}`,
	);

	if (!response.ok) {
		const errorData = (await response.json().catch(() => ({}))) as {
			error?: string;
		};
		throw new Error(errorData.error || "Invite not found");
	}

	return (await response.json()) as InviteInfo;
}

export async function joinInvite(code: string): Promise<InviteInfo> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const response = await fetch(
		`${HOST}/api/invites/${encodeURIComponent(code)}/join`,
		{
			method: "POST",
			headers: {
				Authorization: userSession.token,
			},
		},
	);

	if (!response.ok) {
		const errorData = (await response.json().catch(() => ({}))) as {
			error?: string;
		};
		throw new Error(errorData.error || "Failed to join server");
	}

	return (await response.json()) as InviteInfo;
}
