import api from "$lib/api/api";

// ── Types ───────────────────────────────────────────────────────────────────

export interface Team {
	id: string;
	name: string;
	owner_id: string;
	created_at: string;
	updated_at: string;
}

export interface TeamMember {
	team_id: string;
	user_id: string;
	role: number;
	username: string;
	avatar: string | null;
}

export const TeamRole = {
	Admin: 0,
	Member: 1,
} as const;

export interface TeamInvite {
	id: string;
	team_id: string;
	user_id: string;
	invited_by: string;
	created_at: string;
	team_name: string;
	invited_by_username: string;
}

export interface Application {
	id: string;
	team_id: string;
	name: string;
	description: string | null;
	icon: string | null;
	public: boolean;
	bot_user_id: string | null;
	bot_token_hash: string | null;
	created_at: string;
	updated_at: string;
}

// ── Teams ───────────────────────────────────────────────────────────────────

export async function createTeam(name: string): Promise<Team> {
	const res = await api.post("/api/users/@me/teams", { name });
	return res.data;
}

export async function listTeams(): Promise<Team[]> {
	const res = await api.get("/api/users/@me/teams");
	return res.data;
}

export async function updateTeam(teamId: string, name: string): Promise<Team> {
	const res = await api.patch(`/api/users/@me/teams/${teamId}`, { name });
	return res.data;
}

export async function deleteTeam(teamId: string): Promise<void> {
	await api.delete(`/api/users/@me/teams/${teamId}`);
}

export async function listTeamMembers(teamId: string): Promise<TeamMember[]> {
	const res = await api.get(`/api/users/@me/teams/${teamId}/members`);
	return res.data;
}

export async function inviteToTeam(teamId: string, email: string): Promise<void> {
	await api.post(`/api/users/@me/teams/${teamId}/invites`, { email });
}

export async function removeTeamMember(teamId: string, userId: string): Promise<void> {
	await api.delete(`/api/users/@me/teams/${teamId}/members/${userId}`);
}

// ── Team Invites ────────────────────────────────────────────────────────────

export async function listMyTeamInvites(): Promise<TeamInvite[]> {
	const res = await api.get("/api/users/@me/team-invites");
	return res.data;
}

export async function acceptTeamInvite(inviteId: string): Promise<void> {
	await api.post(`/api/users/@me/team-invites/${inviteId}/accept`);
}

export async function declineTeamInvite(inviteId: string): Promise<void> {
	await api.post(`/api/users/@me/team-invites/${inviteId}/decline`);
}

// ── Applications ────────────────────────────────────────────────────────────

export async function createApplication(teamId: string, name: string, description?: string): Promise<Application> {
	const res = await api.post(`/api/users/@me/teams/${teamId}/applications`, { name, description });
	return res.data;
}

export async function listApplications(teamId: string): Promise<Application[]> {
	const res = await api.get(`/api/users/@me/teams/${teamId}/applications`);
	return res.data;
}

export async function updateApplication(
	teamId: string,
	appId: string,
	data: { name?: string; description?: string; public?: boolean },
): Promise<Application> {
	const res = await api.patch(`/api/users/@me/teams/${teamId}/applications/${appId}`, data);
	return res.data;
}

export async function deleteApplication(teamId: string, appId: string): Promise<void> {
	await api.delete(`/api/users/@me/teams/${teamId}/applications/${appId}`);
}

// ── Bot ─────────────────────────────────────────────────────────────────────

export async function createBot(teamId: string, appId: string): Promise<{ token: string }> {
	const res = await api.post(`/api/users/@me/teams/${teamId}/applications/${appId}/bot`);
	return res.data;
}

export async function resetBotToken(teamId: string, appId: string): Promise<{ token: string }> {
	const res = await api.post(`/api/users/@me/teams/${teamId}/applications/${appId}/bot/reset-token`);
	return res.data;
}

export async function deleteBot(teamId: string, appId: string): Promise<void> {
	await api.delete(`/api/users/@me/teams/${teamId}/applications/${appId}/bot`);
}

export async function updateBot(
	teamId: string,
	appId: string,
	data: { username?: string; avatar?: File | null; banner?: File | null; remove_avatar?: boolean; remove_banner?: boolean },
): Promise<any> {
	const form = new FormData();
	if (data.username) form.append("username", data.username);
	if (data.avatar) form.append("avatar", data.avatar);
	if (data.banner) form.append("banner", data.banner);
	if (data.remove_avatar) form.append("remove_avatar", "true");
	if (data.remove_banner) form.append("remove_banner", "true");
	const res = await api.patch(`/api/users/@me/teams/${teamId}/applications/${appId}/bot`, form);
	return res.data;
}

// ── Bot → Space ─────────────────────────────────────────────────────────────

export interface BotUser {
	id: string;
	username: string;
	avatar: string | null;
	banner: string | null;
	is_bot: boolean;
}

export async function getBotUser(userId: string): Promise<BotUser> {
	const res = await api.get(`/api/users/${userId}`);
	return res.data;
}

export async function addBotToSpace(spaceId: string, botUserId: string): Promise<void> {
	await api.post(`/api/spaces/${spaceId}/bots/${botUserId}`);
}

export async function removeBotFromSpace(spaceId: string, botUserId: string): Promise<void> {
	await api.delete(`/api/spaces/${spaceId}/bots/${botUserId}`);
}
