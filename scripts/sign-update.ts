// Signs the stable build's update for the app's updater (#456, src/bun/update-manifest.ts), in the release workflow. It
// reads the update.json and the tarball Electrobun built into artifacts/, and checks they're the build package.json
// names: the tar's own Resources/version.json, which the app reads as its own once it runs, must have update.json's
// version and hash (or the app would take the same update for new at each check), the stable channel, and the release's
// base URL. Then it hashes the tar inside the zstd (the bytes the updater extracts) and writes
// <prefix>-update-signature.json beside them. The key is DESKTOP_UPDATE_SIGNING_KEY, an Ed25519 private key (PKCS #8) in
// base64.
import { join } from "node:path";
import config from "../electrobun.config";
import pkg from "../package.json";
import { signManifest } from "../src/bun/update-manifest";
import { platformPrefix } from "../src/bun/updates";

const key = process.env.DESKTOP_UPDATE_SIGNING_KEY?.trim();
if (!key) throw new Error("DESKTOP_UPDATE_SIGNING_KEY isn't set");

/** A JSON file's fields as strings, or undefined for any that isn't one. */
function strings(json: unknown, ...fields: string[]): (string | undefined)[] {
	return fields.map((field) => {
		const value: unknown = typeof json === "object" && json !== null ? Reflect.get(json, field) : undefined;
		return typeof value === "string" ? value : undefined;
	});
}

const prefix = platformPrefix("stable");
const artifacts = join(import.meta.dir, "..", "artifacts");
const [version, hash] = strings(await Bun.file(join(artifacts, `${prefix}-update.json`)).json(), "version", "hash");
if (!version || !hash) throw new Error("update.json has no version or hash");
if (version !== pkg.version) throw new Error(`update.json says ${version}, package.json ${pkg.version}`);

const tar = Bun.zstdDecompressSync(await Bun.file(join(artifacts, `${prefix}-Duvet.tar.zst`)).bytes());
const own = [...(await new Bun.Archive(tar).files())].find(([path]) => path.endsWith("Resources/version.json"))?.[1];
if (!own) throw new Error("the tar has no Resources/version.json");
const inside = strings(JSON.parse(await own.text()), "version", "hash", "channel", "baseUrl");
const expected = [version, hash, "stable", config.release.baseUrl];
if (inside.some((value, i) => value !== expected[i])) {
	throw new Error(`the tar's version.json says ${JSON.stringify(inside)}, update.json and the config ${JSON.stringify(expected)}`);
}

const tarSha256 = new Bun.CryptoHasher("sha256").update(tar).digest("hex");
const manifest = await signManifest(new Uint8Array(Buffer.from(key, "base64")), {
	platform: prefix,
	version,
	hash,
	tarSha256,
});
await Bun.write(join(artifacts, `${prefix}-update-signature.json`), JSON.stringify(manifest));
console.log(`signed ${prefix} ${version} (${hash}), its tar ${tarSha256}`);
