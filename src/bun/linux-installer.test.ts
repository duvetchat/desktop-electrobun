import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import config from "../../electrobun.config";

// Electrobun's CLI tars a Linux build with the system's tar (`tar -cf`, its createTar), in the environment it loaded the
// config in, and its self-extractor, the installer, unpacks that tar: it takes long paths written as PAX, and refuses
// GNU tar's long-name entries (TarUnsupportedFileType), which left a Linux install with nothing installed (#590). The
// build's paths pass GNU's 100 characters: a canary's own assets do.
test.skipIf(process.platform !== "linux")(
	"a Linux build's tar names its long paths as Electrobun's installer reads them",
	() => {
		const dir = mkdtempSync(join(tmpdir(), "duvet-tar-"));
		const bundle = `${config.app.name}-canary`;
		const assets = join(dir, bundle, "Resources", "app", "views", "mainview", "_app", "immutable", "assets");
		mkdirSync(assets, { recursive: true });
		const font = "fira-mono-700-cyrillic-ext.DM8N8UCP.woff2";
		writeFileSync(join(assets, font), "font");
		const made = Bun.spawnSync(["sh", "-c", `tar -cf "${bundle}.tar" "${bundle}"`], {
			cwd: dir,
			env: { ...process.env, COPYFILE_DISABLE: "1" },
		});
		expect(made.success).toBe(true);
		const tar = Bun.file(join(dir, `${bundle}.tar`));
		const path = `${bundle}/Resources/app/views/mainview/_app/immutable/assets/${font}`;
		expect(path.length).toBeGreaterThan(100);
		return tar.text().then((text) => {
			expect({ gnuLongNames: text.includes("././@LongLink"), path: text.includes(path) }).toEqual({
				gnuLongNames: false,
				path: true,
			});
		});
	},
);
