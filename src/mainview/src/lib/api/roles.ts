import { userSession } from "$lib/stores.svelte";
import { getHostURL } from "$lib/common/common";

const HOST = getHostURL();

export interface CreateRolePayload {
	name: string;
	permissions?: number;
	color_from?: number | null;
	color_via?: number | null;
	color_to?: number | null;
	hoisted?: boolean;
}

export interface UpdateRolePayload {
	name?: string;
	permissions?: number;
	color_from?: number | null;
	color_via?: number | null;
	color_to?: number | null;
	hoisted?: boolean;
	position?: number;
	/** When true, null color fields explicitly clear those colors in the DB */
	clear_colors?: boolean;
}

export async function createRole(
	spaceId: string,
	payload: CreateRolePayload,
): Promise<unknown> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const response = await fetch(`${HOST}/api/spaces/${spaceId}/roles`, {
		method: "POST",
		headers: {
			Authorization: userSession.token,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		throw new Error(`Failed to create role: ${await response.text()}`);
	}

	return response.json();
}

export async function updateRole(
	spaceId: string,
	roleId: string,
	payload: UpdateRolePayload,
): Promise<unknown> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const response = await fetch(
		`${HOST}/api/spaces/${spaceId}/roles/${roleId}`,
		{
			method: "PATCH",
			headers: {
				Authorization: userSession.token,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
		},
	);

	if (!response.ok) {
		throw new Error(`Failed to update role: ${await response.text()}`);
	}

	return response.json();
}

export async function deleteRole(
	spaceId: string,
	roleId: string,
): Promise<void> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const response = await fetch(
		`${HOST}/api/spaces/${spaceId}/roles/${roleId}`,
		{
			method: "DELETE",
			headers: {
				Authorization: userSession.token,
			},
		},
	);

	if (!response.ok) {
		throw new Error(`Failed to delete role: ${await response.text()}`);
	}
}

export async function assignRoleToMember(
	spaceId: string,
	roleId: string,
	memberId: string,
): Promise<void> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const response = await fetch(
		`${HOST}/api/spaces/${spaceId}/members/${memberId}/roles/${roleId}`,
		{
			method: "PUT",
			headers: {
				Authorization: userSession.token,
			},
		},
	);

	if (!response.ok) {
		throw new Error(`Failed to assign role: ${await response.text()}`);
	}
}

export async function removeRoleFromMember(
	spaceId: string,
	roleId: string,
	memberId: string,
): Promise<void> {
	if (!userSession.token) {
		throw new Error("No user session token found");
	}

	const response = await fetch(
		`${HOST}/api/spaces/${spaceId}/members/${memberId}/roles/${roleId}`,
		{
			method: "DELETE",
			headers: {
				Authorization: userSession.token,
			},
		},
	);

	if (!response.ok) {
		throw new Error(`Failed to remove role: ${await response.text()}`);
	}
}
