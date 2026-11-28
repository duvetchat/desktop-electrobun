// The end-to-end encryption core's library (PLAN-E2E-CLIENTES.md, the desktop's boundary and Task 7): which build carries
// it, and where the app finds it. A Windows x64 build carries the DLL native/core/win-x64 holds, a Linux x64 one the
// shared object of native/core/linux-x64 (PLAN-E2E-PLATAFORMAS.md, Task 4) and a macOS arm64 one the dylib of
// native/core/macos-arm64 (Task 8), the same release's (scripts/core-artifacts.ts), which electrobun.config.ts's copy
// rule puts in Resources/app/native/. Any other build carries none, so its core is unsupported (decisions 38 and 39).
// The worker that loads it is core.ts's. This module imports nothing of Electrobun's: the config and
// scripts/build-native.ts read it too.
import { existsSync } from "node:fs";

/**
 * The library a platform's build carries: the release's file in the repository, its file's name in the app, and where
 * the copy rule takes it from when that isn't the release's file itself.
 */
const CARRIED: Record<string, { file: string; name: string; from?: string }> = {
	"win32-x64": { file: "native/core/win-x64/duvet_e2e_ffi.dll", name: "duvet_e2e_ffi.dll" },
	"linux-x64": { file: "native/core/linux-x64/libduvet_e2e_ffi.so", name: "libduvet_e2e_ffi.so" },
	// The preBuild hook's copy (scripts/build-native.ts), signed as the app's own libraries are when there's a Developer
	// ID, since notarizing takes every Mach-O signed: the release's file keeps the bytes SOURCE.json pins.
	"darwin-arm64": {
		file: "native/core/macos-arm64/libduvet_e2e_ffi.dylib",
		name: "libduvet_e2e_ffi.dylib",
		from: "native/macos/build/libduvet_e2e_ffi.dylib",
	},
};

/** The release's file a platform's build carries, as native/core/SOURCE.json pins it: what its tests load too. */
export function coreLibraryFile(platform: string = process.platform, arch: string = process.arch): string | null {
	return CARRIED[`${platform}-${arch}`]?.file ?? null;
}

/** The copy rule of a build for `platform`, which Electrobun builds on that platform alone: none without a library. */
export function coreLibraryCopy(
	platform: string = process.platform,
	arch: string = process.arch,
): Record<string, string> {
	const carried = CARRIED[`${platform}-${arch}`];
	return carried ? { [carried.from ?? carried.file]: `native/${carried.name}` } : {};
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
