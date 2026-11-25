// The end-to-end encryption core's library (PLAN-E2E-CLIENTES.md, the desktop's boundary and Task 7): which build carries
// it, and where the app finds it. Only a Windows x64 build does: the DLL native/core/win-x64 holds (scripts/
// core-artifacts.ts), which electrobun.config.ts's copy rule puts in Resources/app/native/. A macOS or Linux build carries
// none, so its core is unsupported (decisions 38 and 39); the Linux library native/core holds is the tests'. The worker
// that loads it is core.ts's. This module imports nothing of Electrobun's: the config reads it too.
import { existsSync } from "node:fs";

/** The library a platform's build carries: where it is in the repository, and its file's name in the app. */
const CARRIED: Record<string, { from: string; name: string }> = {
	"win32-x64": { from: "native/core/win-x64/duvet_e2e_ffi.dll", name: "duvet_e2e_ffi.dll" },
};

/** The copy rule of a build for `platform`, which Electrobun builds on that platform alone: none without a library. */
export function coreLibraryCopy(
	platform: string = process.platform,
	arch: string = process.arch,
): Record<string, string> {
	const carried = CARRIED[`${platform}-${arch}`];
	return carried ? { [carried.from]: `native/${carried.name}` } : {};
}

/**
 * Where the app's library is, by `inApp` (native-library.ts's nativeLibraryPath, which index.ts gives), or null when
 * the build carries none or the file isn't there: the core is unsupported then.
 */
export function coreLibraryPath(
	inApp: (name: string) => string,
	platform: string = process.platform,
	arch: string = process.arch,
): string | null {
	const carried = CARRIED[`${platform}-${arch}`];
	if (!carried) return null;
	const path = inApp(carried.name);
	return existsSync(path) ? path : null;
}
