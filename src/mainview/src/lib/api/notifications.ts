import api from "$lib/api/api";
import type { NotificationLevel, NotificationSetting, NotificationTarget } from "$lib/types";

/** The user's own notification levels, one per Space, room or conversation they chose one for. */
export async function getNotificationSettings(): Promise<NotificationSetting[]> {
	const response = await api.get<NotificationSetting[]>("/api/users/@me/notification-settings");
	return response.data;
}

/** Chooses what the user is told of in a place; every session of theirs hears of it as NOTIFICATION_SETTINGS_UPDATE. */
export async function setNotificationLevel(
	targetId: string,
	target: NotificationTarget,
	level: NotificationLevel,
): Promise<NotificationSetting> {
	const response = await api.put<NotificationSetting>(`/api/users/@me/notification-settings/${targetId}`, {
		target_type: target,
		level,
	});
	return response.data;
}

/** Puts a place back on its default for the user. */
export async function clearNotificationLevel(targetId: string): Promise<void> {
	await api.delete(`/api/users/@me/notification-settings/${targetId}`);
}
