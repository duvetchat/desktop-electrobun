// Signs the stable build's update for the app's updater (#456, src/bun/update-manifest.ts), in the release workflow. It
// reads the update.json and the tarball Electrobun built into artifacts/, hashes the tar inside the zstd (the bytes the
// updater extracts) and writes <prefix>-update-signature.json beside them. The key is DESKTOP_UPDATE_SIGNING_KEY, an
// Ed25519 private key (PKCS #8) in base64.
import { join } from "node:path";
import { signManifest } from "../src/bun/update-manifest";
import { platformPrefix } from "../src/bun/updates";

const key = process.env.DESKTOP_UPDATE_SIGNING_KEY?.trim();
if (!key) throw new Error("DESKTOP_UPDATE_SIGNING_KEY isn't set");

const prefix = platformPrefix("stable");
const artifacts = join(import.meta.dir, "..", "artifacts");
const update: unknown = await Bun.file(join(artifacts, `${prefix}-update.json`)).json();
if (typeof update !== "object" || update === null) throw new Error("update.json isn't an object");
const { version, hash } = update as { version?: unknown; hash?: unknown };
if (typeof version !== "string" || typeof hash !== "string") throw new Error("update.json has no version or hash");

const tar = Bun.zstdDecompressSync(await Bun.file(join(artifacts, `${prefix}-Duvet.tar.zst`)).bytes());
const tarSha256 = new Bun.CryptoHasher("sha256").update(tar).digest("hex");
const manifest = await signManifest(new Uint8Array(Buffer.from(key, "base64")), { version, hash, tarSha256 });
await Bun.write(join(artifacts, `${prefix}-update-signature.json`), JSON.stringify(manifest));
console.log(`signed ${version} (${hash}), its tar ${tarSha256}`);
