// Where the app's own macOS libraries are in the app (native/macos, built by scripts/build-native.ts): the copy rules
// of electrobun.config.ts put them at Resources/app/native/.
import { join } from "node:path";
import { PATHS } from "electrobun/bun"; // 2.x: "electrobun/main" (the /bun paths remain aliases)

/** Electrobun's folders: 2.x exports RESOURCES_FOLDER; 1.15.1 only VIEWS_FOLDER (Resources/app/views). */
export type AppPaths = { RESOURCES_FOLDER?: string; VIEWS_FOLDER: string };

/** Where one of those libraries is in the app, by its file's name. */
export function nativeLibraryPath(name: string, paths: AppPaths = PATHS as AppPaths): string {
	return paths.RESOURCES_FOLDER
		? join(paths.RESOURCES_FOLDER, "app", "native", name)
		: join(paths.VIEWS_FOLDER, "..", "native", name);
}
