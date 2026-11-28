// Puts in their places the core's artifacts the desktop carries (PLAN-E2E-CLIENTES.md, its section on the core's
// artifacts): the files of the release artifacts-<commit> of duvetchat/e2e, which the core's artifacts.yml built from
// that commit of its main. It downloads them with gh into ~/.cache/duvet-core/<commit>/; checks each against the
// release's SHA256SUMS before any goes anywhere; and writes native/core/SOURCE.json, the commit and each file's
// SHA-256, which src/bun/core-artifacts.test.ts checks.
//
//   bun scripts/core-artifacts.ts <commit>
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const REPOSITORY = "duvetchat/e2e";

/** Each release file the desktop carries, by its name in the release, and where it goes in this repository. */
export const CARRIED: Record<string, string> = {
	"duvet_e2e_ffi.dll": "native/core/win-x64/duvet_e2e_ffi.dll",
	"libduvet_e2e_ffi.so": "native/core/linux-x64/libduvet_e2e_ffi.so",
	"macos-arm64-libduvet_e2e_ffi.dylib": "native/core/macos-arm64/libduvet_e2e_ffi.dylib",
	"duvet_e2e_wasm.js": "src/mainview/src/lib/e2e/wasm/duvet_e2e_wasm.js",
	"duvet_e2e_wasm_bg.wasm": "src/mainview/src/lib/e2e/wasm/duvet_e2e_wasm_bg.wasm",
};

/** A file's SHA-256 in hex, once SHA256SUMS (sha256sum's output) gives its name that hash; else it throws. */
export function checkSums(sums: string, name: string, bytes: Uint8Array): string {
	const listed = sums
		.split("\n")
		.map((line) => line.match(/^([0-9a-f]{64}) [ *](.+)$/))
		.find((match) => match?.[2] === name)?.[1];
	if (!listed) throw new Error(`SHA256SUMS doesn't list ${name}`);
	const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
	if (hash !== listed) throw new Error(`${name} has the SHA-256 ${hash}, where SHA256SUMS says ${listed}`);
	return hash;
}

/** gh's output; its errors go to this process's stderr. */
function gh(...args: string[]): string {
	const run = Bun.spawnSync(["gh", ...args], { stderr: "inherit" });
	if (run.exitCode !== 0) throw new Error(`gh ${args.slice(0, 2).join(" ")} failed`);
	return run.stdout.toString();
}

async function main(commit: string | undefined) {
	if (!commit || !/^[0-9a-f]{7,40}$/.test(commit)) throw new Error("usage: bun scripts/core-artifacts.ts <commit>");
	const short = commit.slice(0, 7);
	const tag = `artifacts-${short}`;
	// The whole commit the release was built from: a short one can grow ambiguous.
	const built = gh(
		"release",
		"view",
		tag,
		"--repo",
		REPOSITORY,
		"--json",
		"targetCommitish",
		"--jq",
		".targetCommitish",
	).trim();
	if (!/^[0-9a-f]{40}$/.test(built) || !built.startsWith(commit)) throw new Error(`${tag} was built from ${built}`);

	const cache = join(homedir(), ".cache", "duvet-core", short);
	mkdirSync(cache, { recursive: true });
	const patterns = ["SHA256SUMS", ...Object.keys(CARRIED)].flatMap((name) => ["--pattern", name]);
	gh("release", "download", tag, "--repo", REPOSITORY, "--dir", cache, "--clobber", ...patterns);

	// Every file checked before any is written: a bad one leaves the repository as it was.
	const sums = await Bun.file(join(cache, "SHA256SUMS")).text();
	const downloaded = await Promise.all(
		Object.entries(CARRIED).map(async ([name, path]) => {
			const bytes = await Bun.file(join(cache, name)).bytes();
			return { path, bytes, sha256: checkSums(sums, name, bytes) };
		}),
	);
	const root = join(import.meta.dir, "..");
	const files: Record<string, string> = {};
	for (const { path, bytes, sha256 } of downloaded) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		await Bun.write(join(root, path), bytes);
		files[path] = sha256;
	}
	const source = { repository: REPOSITORY, commit: built, files };
	await Bun.write(join(root, "native/core/SOURCE.json"), `${JSON.stringify(source, null, "\t")}\n`);
	console.log(`The core's artifacts of ${built} are in place.`);
}

if (import.meta.main) await main(process.argv[2]);
