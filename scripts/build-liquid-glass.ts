// preBuild hook (electrobun.config.ts → scripts.preBuild). Electrobun runs it with its own Bun, from the project root,
// before the copy step, so the dylib it writes is the one that gets bundled.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const SRC = "native/macos/liquid_glass.mm";
const OUT = "native/macos/build/libLiquidGlass.dylib";
const targetOS = process.env.ELECTROBUN_OS ?? (process.platform === "darwin" ? "macos" : process.platform);
const targetArch = process.env.ELECTROBUN_ARCH === "x64" ? "x86_64" : "arm64";

mkdirSync("native/macos/build", { recursive: true });

if (targetOS !== "macos" || process.platform !== "darwin") {
	// Keep the copy rule satisfied on Windows/Linux builds; the app never loads it there.
	writeFileSync(OUT, "");
	console.log(`[liquid-glass] ${targetOS}: wrote placeholder ${OUT}`);
	process.exit(0);
}

const run = (cmd: string, args: string[]) => {
	const r = spawnSync(cmd, args, { stdio: "inherit" });
	if (r.status !== 0) process.exit(r.status ?? 1);
};

run("xcrun", [
	"clang++",
	"-dynamiclib",
	"-fobjc-arc",
	"-O2",
	"-Wall",
	"-arch",
	targetArch,
	"-mmacosx-version-min=14.0", // NSGlassEffectView stays weak-linked: the dylib still loads on macOS 14/15
	"-framework",
	"Cocoa",
	"-framework",
	"WebKit",
	"-install_name",
	"@rpath/libLiquidGlass.dylib",
	SRC,
	"-o",
	OUT,
]);

// Notarization needs every Mach-O signed; Electrobun 1.15.1's signer only walks Contents/MacOS.
const identity = process.env.ELECTROBUN_DEVELOPER_ID;
if (identity && process.env.ELECTROBUN_BUILD_ENV !== "dev") {
	run("codesign", ["--force", "--timestamp", "--options", "runtime", "--sign", identity, OUT]);
}
console.log(`[liquid-glass] built ${OUT} (${targetArch})`);
