// A file whose name starts with SPOILER_ is a spoiler: the chat hides it until a click reveals it. The
// name is all there is to it, so the API keeps it as it was uploaded and bots send spoilers the same way.
const PREFIX = "SPOILER_";
const PREFIXES = new RegExp(`^(?:${PREFIX})+`);

/** Whether a file of that name is a spoiler. */
export function isSpoiler(filename: string): boolean {
	return filename.startsWith(PREFIX);
}

/** The name the chat shows for a file: without the prefix, unless the prefix is all of it. */
export function displayName(filename: string): string {
	return filename.replace(PREFIXES, "") || filename;
}

/** file, as a spoiler or not. A File's name can't change, so it's a new File with the same type, date and
 * content, named with the prefix or without it; file itself when it already is what's asked. */
export function withSpoiler(file: File, spoiler: boolean): File {
	const name = spoiler ? (isSpoiler(file.name) ? file.name : PREFIX + file.name) : displayName(file.name);
	if (name === file.name) return file;
	return new File([file], name, { type: file.type, lastModified: file.lastModified });
}
