import api from "$lib/api/api";

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

export async function createRole(spaceId: string, payload: CreateRolePayload): Promise<unknown> {
	const response = await api.post(`/api/spaces/${spaceId}/roles`, payload);
	return response.data;
}

export async function updateRole(spaceId: string, roleId: string, payload: UpdateRolePayload): Promise<unknown> {
	const response = await api.patch(`/api/spaces/${spaceId}/roles/${roleId}`, payload);
	return response.data;
}

export async function deleteRole(spaceId: string, roleId: string): Promise<void> {
	await api.delete(`/api/spaces/${spaceId}/roles/${roleId}`);
}

export async function assignRoleToMember(spaceId: string, roleId: string, memberId: string): Promise<void> {
	await api.put(`/api/spaces/${spaceId}/members/${memberId}/roles/${roleId}`);
}

export async function removeRoleFromMember(spaceId: string, roleId: string, memberId: string): Promise<void> {
	await api.delete(`/api/spaces/${spaceId}/members/${memberId}/roles/${roleId}`);
}
