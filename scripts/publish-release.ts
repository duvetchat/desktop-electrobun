// Publishes the stable build to the rolling desktop-stable release of duvetchat/releases (#456), where the app's updater
// and duvet.chat/download look. It uses gh with GH_TOKEN, a token that can write to that repository alone. The patch, the
// tarball, the signed manifest and the installer go up first and update.json last, so no client sees a version whose
// files aren't there yet. Older patches stay: a client a few versions behind patches through each of them.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { platformPrefix } from "../src/bun/updates";

const REPO = "duvetchat/releases";
const TAG = "desktop-stable";

const prefix = platformPrefix("stable");
const artifacts = join(import.meta.dir, "..", "artifacts");
const files = readdirSync(artifacts).filter((name) => name.startsWith(`${prefix}-`));
const updateJson = `${prefix}-update.json`;
if (!files.includes(updateJson)) throw new Error(`no ${updateJson} in artifacts/`);
if (!files.includes(`${prefix}-update-signature.json`)) throw new Error("the update isn't signed (scripts/sign-update.ts)");

function gh(args: string[]): void {
	const result = Bun.spawnSync(["gh", ...args], { stdout: "inherit", stderr: "inherit" });
	if (!result.success) throw new Error(`gh ${args.slice(0, 2).join(" ")} failed`);
}

if (!Bun.spawnSync(["gh", "release", "view", TAG, "--repo", REPO]).success) {
	gh(["release", "create", TAG, "--repo", REPO, "--title", "Duvet desktop", "--notes", "The desktop app's current version."]);
}
const first = files.filter((name) => name !== updateJson).map((name) => join(artifacts, name));
gh(["release", "upload", TAG, "--repo", REPO, "--clobber", ...first]);
gh(["release", "upload", TAG, "--repo", REPO, "--clobber", join(artifacts, updateJson)]);
console.log(`published ${files.join(", ")} to ${REPO}@${TAG}`);
