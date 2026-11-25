// The types of duvet_e2e_wasm.js, the core's glue as wasm-bindgen made it (native/core/SOURCE.json keeps its hash): its
// release carries the glue without them, and the type check would read the generated JavaScript instead. Written by
// hand to what the glue exports, of which lib/e2e/web/worker.ts uses part; a new version of the core checks them again.

/** The core over one open database. */
export class WasmCore {
	private constructor();
	free(): void;
	/** Closes the database. */
	close(): void;
	/** Runs one JSON command and returns its JSON reply. */
	handle(command: string): string;
	/**
	 * Opens the database `config_json` names (`{"path"}`) with its raw 32-byte key, or makes it. Throws the core's error
	 * reply, a JSON string: `storage` until install_opfs succeeded in this instance, and `bad_command` for a path SQLite
	 * never keeps in OPFS (empty, `:memory:` or a `file:` URI).
	 */
	static open(config_json: string, db_key: Uint8Array): WasmCore;
}

/**
 * Makes OPFS, through SQLite's opfs-sahpool VFS, the place of every database opened after it: only a dedicated worker
 * has OPFS's synchronous access handles. Rejects with the core's error reply, a JSON string.
 */
export function install_opfs(): Promise<void>;

/** The instance's exports, as init gives them: those the worker reads. */
export interface InitOutput {
	readonly memory: WebAssembly.Memory;
	readonly __wbindgen_malloc: (size: number, align: number) => number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export function initSync(module: { module: BufferSource | WebAssembly.Module }): InitOutput;

/** Fetches and instantiates the module, once: given its URL, else the one beside the glue. */
export default function __wbg_init(module_or_path?: {
	module_or_path: InitInput | Promise<InitInput>;
}): Promise<InitOutput>;
