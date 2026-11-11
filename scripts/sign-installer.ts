// Hutch runs this file last (postPackage). By then a release build has its installer, <App>-Setup[-<channel>].exe with
// the app's icon, next to the archive it unpacks, and has zipped the two into the artifacts: this signs the installer
// and puts the signed one in that zip, when DUVET_SIGN_ARGS says how (scripts/sign-app.ts). A dev build has none.
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { sign, signingArgs } from "./sign-app";

// The zip's entry for the installer is its file name (Hutch's Compress-Archive).
const replaceZipEntry = `Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::Open($env:SIGN_ZIP, 'Update')
try {
	$old = @($zip.Entries | Where-Object { $_.FullName -eq $env:SIGN_ENTRY })
	if ($old.Count -ne 1) { throw "$env:SIGN_ZIP has $($old.Count) entries named $env:SIGN_ENTRY" }
	$old[0].Delete()
	[void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $env:SIGN_EXE, $env:SIGN_ENTRY)
} finally {
	$zip.Dispose()
}`;

export default function signInstaller(): void {
	const args = signingArgs();
	if (!args || process.env.ELECTROBUN_BUILD_ENV === "dev") return;
	const buildDir = process.env.ELECTROBUN_BUILD_DIR!;
	const artifactDir = process.env.ELECTROBUN_ARTIFACT_DIR!;
	const setup = onlyOne(buildDir, /-Setup(-[a-z]+)?\.exe$/);
	const zip = onlyOne(artifactDir, /-Setup(-[a-z]+)?\.zip$/);
	sign(args, [join(buildDir, setup)]);
	const { exitCode } = Bun.spawnSync(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", replaceZipEntry], {
		env: { ...process.env, SIGN_ZIP: join(artifactDir, zip), SIGN_EXE: join(buildDir, setup), SIGN_ENTRY: setup },
		stdout: "inherit",
		stderr: "inherit",
	});
	if (exitCode !== 0) throw new Error(`couldn't put the signed installer in ${zip}`);
}

function onlyOne(dir: string, name: RegExp): string {
	const found = readdirSync(dir).filter((file) => name.test(file));
	if (found.length !== 1) throw new Error(`expected one file like ${name} in ${dir}, found ${found.length}`);
	return found[0];
}
