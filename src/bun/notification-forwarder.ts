/**
 * What Windows runs for a click on a Duvet notification, in a process of its own (forwarderScript): it hands the link
 * to the running Duvet over the channel's pipe; with no Duvet listening, it starts one (launcher) and hands it the link
 * once its pipe is up, for a minute at most. It first passes on the foreground rights the click gave it, so Duvet's
 * window can come to the front (DISENO-NOTIFICACIONES.md, section 8).
 *
 * It runs from its source (forwarderScript), so it may use only globals and what it imports itself.
 */
export async function forward(pipe: string, launcher: string[], url: string): Promise<void> {
	try {
		const { dlopen, FFIType } = await import("bun:ffi");
		const user32 = dlopen("user32.dll", {
			AllowSetForegroundWindow: { args: [FFIType.u32], returns: FFIType.i32 },
		});
		user32.symbols.AllowSetForegroundWindow(0xffffffff); // ASFW_ANY
	} catch {
		// Not on Windows: no foreground to pass on.
	}
	const send = async () => {
		const socket = await Bun.connect({ unix: pipe, socket: { data() {} } });
		socket.end(`${JSON.stringify({ type: "OPEN_URL", url })}\n`);
	};
	try {
		await send();
		return;
	} catch {
		// No Duvet listens: one starts.
	}
	if (launcher.length > 0) Bun.spawn(launcher, { stdio: ["ignore", "ignore", "ignore"] }).unref();
	const end = Date.now() + 60_000;
	while (Date.now() < end) {
		await Bun.sleep(500);
		try {
			await send();
			return;
		} catch {
			// Its pipe isn't up yet.
		}
	}
}

/**
 * The forwarder as the script setUpNotifications writes into the app's data folder (notification-setup.ts), the link
 * coming as its argument. The function's own source, called as an expression, so a bundler's names don't matter.
 */
export function forwarderScript(pipe: string, launcher: string[]): string {
	const args = `${JSON.stringify(pipe)}, ${JSON.stringify(launcher)}, process.argv[2] ?? ""`;
	return `// Duvet's notification link forwarder (src/bun/notification-forwarder.ts), written at each start.\nawait (${forward.toString()})(${args});\n`;
}
