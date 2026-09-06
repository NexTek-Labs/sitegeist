import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { McpServerEntry } from "@mariozechner/pi-web-ui";

/**
 * Structurally matches the client the host passes in (e.g. `McpHttpClient`).
 * Kept opaque here so the module stays free of pi-agent-core runtime imports and
 * no credential ever leaks into the results.
 */
export interface McpClientLike {
	config: unknown;
}

/** Dependencies injected so this module can be tested without a live MCP server. */
export interface McpLoadDeps {
	createClient(config: { name: string; url: string; headers?: Record<string, string> }): McpClientLike;
	createTools(client: McpClientLike, options?: { namePrefix?: string }): Promise<AgentTool[]>;
}

/** Per-server load outcome. Never carries a header value. */
export interface McpServerLoadResult {
	id: string;
	name: string;
	state: "connected" | "error" | "disabled";
	toolCount: number;
	message?: string;
}

/**
 * Load the tools of every MCP server. Disabled entries are skipped without a
 * client; enabled entries load concurrently and each failure is contained to its
 * own result. `tools` and `results` are in `entries` order.
 */
export async function loadMcpTools(
	entries: McpServerEntry[],
	deps: McpLoadDeps,
): Promise<{ tools: AgentTool[]; results: McpServerLoadResult[] }> {
	const loaded = await Promise.all(entries.map((entry) => loadEntry(entry, deps)));
	return {
		tools: loaded.flatMap(({ tools }) => tools),
		results: loaded.map(({ result }) => result),
	};
}

async function loadEntry(
	entry: McpServerEntry,
	deps: McpLoadDeps,
): Promise<{ tools: AgentTool[]; result: McpServerLoadResult }> {
	if (!entry.enabled) {
		return {
			tools: [],
			result: { id: entry.id, name: entry.name, state: "disabled", toolCount: 0 },
		};
	}
	try {
		const client = deps.createClient({ name: entry.name, url: entry.url, headers: entry.headers });
		const tools = await deps.createTools(client, entry.namePrefix ? { namePrefix: entry.namePrefix } : undefined);
		return {
			tools,
			result: { id: entry.id, name: entry.name, state: "connected", toolCount: tools.length },
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			tools: [],
			result: { id: entry.id, name: entry.name, state: "error", toolCount: 0, message },
		};
	}
}

/**
 * One short line for the header bar: connected/enabled counts and total tools,
 * plus a `failed:` list when any server errored. Empty for no results.
 */
export function describeMcpLoad(results: McpServerLoadResult[]): string {
	if (results.length === 0) {
		return "";
	}
	const connected = results.filter((r) => r.state === "connected").length;
	const enabled = results.filter((r) => r.state !== "disabled").length;
	const totalTools = results.reduce((sum, r) => sum + r.toolCount, 0);
	const failed = results.filter((r) => r.state === "error").map((r) => r.name);

	let text = `MCP ${connected}/${enabled} · ${totalTools} tools`;
	if (failed.length > 0) {
		text += ` · failed: ${failed.join(", ")}`;
	}
	return text;
}
