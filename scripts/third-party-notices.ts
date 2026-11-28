// Writes src/mainview/licenses/bun.json: the notices of the packages the desktop app's Bun process ships, from its
// bundle built as Electrobun builds it (electrobun.config.ts's build.bun), for the Licenses page (#628), whose build
// (src/mainview/third-party-notices.ts) reads the file: the page's build runs under Node too, which can't bundle for
// Bun. src/bun/third-party-notices.test.ts holds the file to a new build, so a change of the Bun process's packages
// fails it until this runs again.
//
//   bun scripts/third-party-notices.ts
import { join, resolve } from "node:path";
import config from "../electrobun.config";
import { MANIFEST } from "../src/mainview/licenses/notices";
import { packageNotice, packageOf } from "../src/mainview/third-party-notices";
import type { Notice } from "../src/mainview/src/lib/licenses";

const root = join(import.meta.dir, "..");
const page = join(root, "src", "mainview");
export const BUN_NOTICES = join(page, "licenses", "bun.json");

/** The notices of the packages whose code is in the Bun bundle, by name. */
export async function bunBundleNotices(): Promise<Notice[]> {
	const { entrypoint, ...options } = config.build.bun;
	const result = await Bun.build({ ...options, entrypoints: [join(root, entrypoint)], target: "bun", metafile: true });
	if (!result.success || !result.metafile) throw new Error("the Bun bundle didn't build");
	// The metafile's paths are from the working folder.
	const dirs = new Set<string>();
	for (const output of Object.values(result.metafile.outputs)) {
		for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
			const found = bytesInOutput > 0 && packageOf(resolve(input));
			if (found) dirs.add(found.dir);
		}
	}
	return [...dirs]
		.map((dir) => packageNotice(dir, MANIFEST.overrides, page))
		.sort((a, b) => a.name.localeCompare(b.name) || (a.version ?? "").localeCompare(b.version ?? ""));
}

if (import.meta.main) {
	const notices = await bunBundleNotices();
	await Bun.write(BUN_NOTICES, `${JSON.stringify(notices, null, "\t")}\n`);
	console.log(`The Bun process's ${notices.length} packages are in ${BUN_NOTICES}.`);
}
