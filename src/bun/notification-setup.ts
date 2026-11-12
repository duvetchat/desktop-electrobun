import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { NOTIFICATION_ICON } from "./notification-icon";

/**
 * Who a channel's notifications are from on Windows, the link they open, and the pipe that link reaches the running
 * Duvet on. Each channel has its own, so the dev build never takes the installed app's link, and a click reaches the
 * Duvet that showed it: the IPC pipe the apps talk to (ipc.ts) is one for every channel.
 */
export interface NotificationIdentity {
	/** The AppUserModelID the toasts are shown under. */
	aumid: string;
	/** The sender's name, as Windows shows it. */
	displayName: string;
	/** The link's scheme (notification-links.ts). */
	scheme: string;
	/** The named pipe the forwarder hands a link to (notification-forwarder.ts). */
	pipe: string;
}

export function notificationIdentity(channel: string): NotificationIdentity {
	const pipe = `\\\\.\\pipe\\duvet-open-${channel}`;
	if (channel === "stable") return { aumid: "com.duvet.desktop", displayName: "Duvet", scheme: "duvet", pipe };
	return {
		aumid: `com.duvet.desktop.${channel}`,
		displayName: `Duvet ${channel.charAt(0).toUpperCase()}${channel.slice(1)}`,
		scheme: `duvet-${channel}`,
		pipe,
	};
}

const CLASSES = "HKCU\\Software\\Classes";

/**
 * The reg commands that register a channel's sender (its AUMID's name and icon) and its link's handler: the forwarder,
 * run by the app's own Bun under conhost --headless, so no window shows (DISENO-NOTIFICACIONES.md, section 8). All in
 * the user's hive, so no administrator is asked.
 */
export function registryCommands(
	id: NotificationIdentity,
	paths: { iconPath: string; execPath: string; forwarderPath: string },
): string[][] {
	const sender = `${CLASSES}\\AppUserModelId\\${id.aumid}`;
	const scheme = `${CLASSES}\\${id.scheme}`;
	const handler = `conhost.exe --headless "${paths.execPath}" "${paths.forwarderPath}" "%1"`;
	return [
		["reg", "add", sender, "/v", "DisplayName", "/t", "REG_SZ", "/d", id.displayName, "/f"],
		["reg", "add", sender, "/v", "IconUri", "/t", "REG_SZ", "/d", paths.iconPath, "/f"],
		["reg", "add", scheme, "/ve", "/t", "REG_SZ", "/d", `URL:${id.displayName}`, "/f"],
		["reg", "add", scheme, "/v", "URL Protocol", "/t", "REG_SZ", "/d", "", "/f"],
		["reg", "add", `${scheme}\\shell\\open\\command`, "/ve", "/t", "REG_SZ", "/d", handler, "/f"],
	];
}

/**
 * Windows: registers this channel's notifications, and writes into the app's data folder (userData) what the registry
 * names: the icon, as the app's package (app.asar) isn't a folder Windows reads a file from, and the forwarder's script.
 * It runs at every start, as an update or a move changes the paths, and never blocks it: a failed command is logged.
 */
export async function setUpNotifications(
	channel: string,
	userData: string,
	forwarder: string,
): Promise<NotificationIdentity> {
	const id = notificationIdentity(channel);
	const iconPath = join(userData, "notification-icon.png");
	const forwarderPath = join(userData, "notification-forwarder.js");
	await mkdir(userData, { recursive: true });
	await Bun.write(iconPath, Buffer.from(NOTIFICATION_ICON, "base64"));
	await Bun.write(forwarderPath, forwarder);
	for (const command of registryCommands(id, { iconPath, execPath: process.execPath, forwarderPath })) {
		const proc = Bun.spawn(command, { stdout: "ignore", stderr: "pipe", windowsHide: true });
		if ((await proc.exited) !== 0) {
			const why = (await new Response(proc.stderr).text()).trim();
			console.error(`[Notifications] ${command.slice(0, 3).join(" ")} failed: ${why}`);
		}
	}
	return id;
}
