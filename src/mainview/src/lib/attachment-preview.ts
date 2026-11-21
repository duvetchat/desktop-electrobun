// What the attachments list in Settings can preview: a picture in the image viewer the chat uses, and a text file
// (a log, source, JSON, Markdown) in a read-only dialog.

/** Whether the file is a picture: the image viewer shows it. */
export function isImageAttachment(contentType: string): boolean {
	return contentType.toLowerCase().startsWith("image/");
}

// The types that are text without saying "text/": the ones a browser downloads rather than opens.
const TEXT_TYPES = new Set([
	"application/json",
	"application/ld+json",
	"application/xml",
	"application/xhtml+xml",
	"application/javascript",
	"application/x-javascript",
	"application/typescript",
	"application/x-yaml",
	"application/yaml",
	"application/toml",
	"application/sql",
]);

// The names whose text is told by their extension, whatever type the upload gave them.
const TEXT_EXTENSIONS = new Set([
	"txt",
	"md",
	"markdown",
	"mdx",
	"json",
	"jsonl",
	"csv",
	"tsv",
	"log",
	"yml",
	"yaml",
	"toml",
	"xml",
	"html",
	"htm",
	"css",
	"scss",
	"less",
	"js",
	"mjs",
	"cjs",
	"jsx",
	"ts",
	"tsx",
	"svelte",
	"py",
	"rb",
	"go",
	"rs",
	"java",
	"kt",
	"kts",
	"c",
	"h",
	"cpp",
	"hpp",
	"cs",
	"php",
	"sh",
	"bash",
	"zsh",
	"fish",
	"ps1",
	"bat",
	"sql",
	"ini",
	"cfg",
	"conf",
	"env",
]);

/** Whether the file can be read as text: its type says text, or its name has an extension this list knows. A type
 * that names a format the app can't read as text (a PDF, a zip) wins over an extension that looks textual. */
export function isTextAttachment(contentType: string, filename: string): boolean {
	const type = (contentType.split(";")[0] ?? "").trim().toLowerCase();
	if (type.startsWith("text/") || TEXT_TYPES.has(type)) return true;
	// A nameless type leaves it to the name; so does an application/x- one, which is what servers give an obscure file.
	if (
		type &&
		type !== "application/octet-stream" &&
		type !== "binary/octet-stream" &&
		!type.startsWith("application/x-")
	)
		return false;
	const name = filename.toLowerCase();
	const dot = name.lastIndexOf(".");
	return dot > 0 && TEXT_EXTENSIONS.has(name.slice(dot + 1));
}
