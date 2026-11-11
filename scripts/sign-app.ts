// Signs the Windows build with signtool when DUVET_SIGN_ARGS says how: a JSON array of signtool's sign options, such as
// ["/sha1", "<thumbprint>", "/fd", "SHA256", "/tr", "<timestamp server URL>", "/td", "SHA256"] for a certificate in the
// Windows certificate store, or Artifact Signing's /dlib and /dmdf. Without it the build isn't signed.
//
// Hutch runs this file once the app is built (postBuild), before it hashes the app and packs it into the archive the
// installer unpacks, so what gets installed is what was signed. It signs every executable and library there, the
// uninstaller Hutch leaves without an extension included, but those already signed by someone Windows trusts. bun.exe
// comes signed by Bun's publisher, but that signature is gone once Hutch writes the app's icon into it, so bun.exe gets
// ours. scripts/sign-installer.ts signs the installer.
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";

export function signingArgs(): string[] | undefined {
	const value = process.env.DUVET_SIGN_ARGS;
	if (process.env.ELECTROBUN_OS !== "win" || !value) return undefined;
	const args: unknown = JSON.parse(value);
	if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) {
		throw new Error("DUVET_SIGN_ARGS must be a JSON array of strings");
	}
	return args;
}

// The newest Windows SDK's, unless SIGNTOOL names one.
function signtool(): string {
	if (process.env.SIGNTOOL) return process.env.SIGNTOOL;
	const kits = "C:\\Program Files (x86)\\Windows Kits\\10\\bin";
	const newest = (existsSync(kits) ? readdirSync(kits) : [])
		.filter((version) => existsSync(join(kits, version, "x64", "signtool.exe")))
		.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
		.at(-1);
	if (!newest) throw new Error(`no signtool.exe in ${kits}: install the Windows SDK, or set SIGNTOOL`);
	return join(kits, newest, "x64", "signtool.exe");
}

// Hutch 0.29.0 writes the app's icon into bun.exe by rewriting it without its signature, but leaves the header's entry
// for the signature (the security directory), which then points into the file's last section: signtool refuses such a
// file as a bad executable (0x800700C1). An entry that doesn't end where the file does is forgotten before signing.
export function forgetStaleSignature(path: string): void {
	const header = Buffer.alloc(4096);
	const fd = openSync(path, "r+");
	try {
		readSync(fd, header, 0, header.length, 0);
		const optionalHeader = header.readUInt32LE(0x3c) + 24;
		// The fifth data directory: 112 bytes into a PE32+ optional header, 96 into a PE32 one.
		const entry = optionalHeader + (header.readUInt16LE(optionalHeader) === 0x20b ? 112 : 96) + 4 * 8;
		if (entry + 8 > header.length) throw new Error(`${path}: its PE header is past the first 4 KiB`);
		const offset = header.readUInt32LE(entry);
		if (offset === 0 || offset + header.readUInt32LE(entry + 4) === statSync(path).size) return;
		writeSync(fd, Buffer.alloc(8), 0, 8, entry);
		console.log(`[sign] ${path}: forgot a signature entry that no longer ends the file`);
	} finally {
		closeSync(fd);
	}
}

// Signs the files whose signature Windows doesn't trust, or that have none.
export function sign(args: string[], files: string[]): void {
	const tool = signtool();
	const unsigned = files.filter((file) => Bun.spawnSync([tool, "verify", "/pa", "/q", file]).exitCode !== 0);
	if (unsigned.length === 0) return;
	unsigned.forEach(forgetStaleSignature);
	const { exitCode } = Bun.spawnSync([tool, "sign", ...args, ...unsigned], { stdout: "inherit", stderr: "inherit" });
	if (exitCode !== 0) throw new Error(`signtool sign exited with ${exitCode}`);
}

export default async function signApp(): Promise<void> {
	const args = signingArgs();
	if (!args) {
		if (process.env.ELECTROBUN_OS === "win") console.warn("[sign] DUVET_SIGN_ARGS isn't set: the build isn't signed");
		return;
	}
	const dir = process.env.ELECTROBUN_BUILD_DIR!;
	const executables: string[] = [];
	// By their first bytes, as the uninstaller has no extension.
	for (const file of new Bun.Glob("**/*").scanSync({ cwd: dir, dot: true })) {
		const head = await Bun.file(join(dir, file)).slice(0, 2).bytes();
		if (head[0] === 0x4d && head[1] === 0x5a) executables.push(join(dir, file));
	}
	sign(args, executables);
}
