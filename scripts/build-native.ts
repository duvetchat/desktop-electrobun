// preBuild hook (electrobun.config.ts → scripts.preBuild). Electrobun runs it with its own Bun, from the project root,
// before the copy step, so the libraries it writes are the ones that get bundled. It builds the app's own macOS
// libraries, one from each source in native/macos:
//   - libLiquidGlass.dylib, the glass behind the main window (liquid_glass.mm, src/bun/liquid-glass.ts, #374);
//   - libWindowButtons.dylib, the traffic lights' place in the title line (window_buttons.mm,
//     src/bun/window-buttons.ts, #406);
//   - libPasteboard.dylib, the recovery key's Copy, for this Mac alone and concealed (pasteboard.mm,
//     src/bun/secret-clipboard.ts, PLAN-E2E-PLATAFORMAS.md's Task 6).
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT_DIR = "native/macos/build";
const LIBRARIES = [
	{ name: "libLiquidGlass.dylib", source: "native/macos/liquid_glass.mm", frameworks: ["Cocoa", "WebKit"] },
	{ name: "libWindowButtons.dylib", source: "native/macos/window_buttons.mm", frameworks: ["Cocoa"] },
	{ name: "libPasteboard.dylib", source: "native/macos/pasteboard.mm", frameworks: ["Cocoa"] },
];
const targetOS = process.env.ELECTROBUN_OS ?? (process.platform === "darwin" ? "macos" : process.platform);
const targetArch = process.env.ELECTROBUN_ARCH === "x64" ? "x86_64" : "arm64";

mkdirSync(OUT_DIR, { recursive: true });

if (targetOS !== "macos" || process.platform !== "darwin") {
	// Keep the copy rules satisfied on Windows/Linux builds; the app never loads them there.
	for (const { name } of LIBRARIES) {
		writeFileSync(`${OUT_DIR}/${name}`, "");
		console.log(`[native] ${targetOS}: wrote placeholder ${OUT_DIR}/${name}`);
	}
	process.exit(0);
}

const run = (cmd: string, args: string[]) => {
	const r = spawnSync(cmd, args, { stdio: "inherit" });
	if (r.status !== 0) process.exit(r.status ?? 1);
};

// Notarization needs every Mach-O signed; Electrobun 1.15.1's signer only walks Contents/MacOS.
const identity = process.env.ELECTROBUN_DEVELOPER_ID;
const sign = identity && process.env.ELECTROBUN_BUILD_ENV !== "dev";

for (const { name, source, frameworks } of LIBRARIES) {
	const out = `${OUT_DIR}/${name}`;
	run("xcrun", [
		"clang++",
		"-dynamiclib",
		"-fobjc-arc",
		"-O2",
		"-Wall",
		"-arch",
		targetArch,
		"-mmacosx-version-min=14.0", // NSGlassEffectView stays weak-linked: the dylib still loads on macOS 14/15
		...frameworks.flatMap((framework) => ["-framework", framework]),
		"-install_name",
		`@rpath/${name}`,
		source,
		"-o",
		out,
	]);
	if (sign) run("codesign", ["--force", "--timestamp", "--options", "runtime", "--sign", identity, out]);
	console.log(`[native] built ${out} (${targetArch})`);
}
