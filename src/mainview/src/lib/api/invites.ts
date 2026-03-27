import api from "$lib/api/api";

export interface InviteInfo {
    code: string;
    space_id: string;
    space_name: string;
    description: string;
    member_count: number;
}

export async function getInvite(code: string): Promise<InviteInfo> {
    const response = await api.get(`/api/invites/${encodeURIComponent(code)}`);
    return response.data;
}

export async function joinInvite(code: string): Promise<InviteInfo> {
    const response = await api.post(`/api/invites/${encodeURIComponent(code)}/join`);
    return response.data;
}