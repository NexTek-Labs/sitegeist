/**
 * Contract tests for src/mcp/load-mcp-tools.ts, written BEFORE the implementation
 * (test-first for the credentials/egress risk zone, sitegeist-nex docs/WORKFLOW.md).
 *
 * They define:
 *   loadMcpTools(entries, deps) → { tools, results }
 *     - disabled entries are skipped without creating a client
 *     - each enabled entry gets exactly one client built from { name, url, headers } — nothing else,
 *       headers passed through untouched, and only ever that entry's own url
 *     - tools come back in entry order, each server's tools created with its namePrefix
 *     - one failing server does not prevent the others from loading (failure isolation)
 *     - results carry state connected | error | disabled per server, and never a header value
 *   describeMcpLoad(results) → one short line for the header bar, never a header value
 *
 * Run: ../pi-mono/node_modules/.bin/vitest --run --root . test/mcp
 */
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { McpServerEntry } from "@mariozechner/pi-web-ui";
import { describe, expect, it } from "vitest";
import {
	describeMcpLoad,
	loadMcpTools,
	type McpClientLike,
	type McpLoadDeps,
	type McpServerLoadResult,
} from "../../src/mcp/load-mcp-tools.ts";

const SECRET = "Bearer sk-live-THIS-MUST-NEVER-BE-SHOWN";

function entry(overrides: Partial<McpServerEntry> = {}): McpServerEntry {
	return {
		id: "id-gbrain",
		name: "gbrain",
		url: "http://127.0.0.1:8795/mcp",
		headers: { Authorization: SECRET },
		enabled: true,
		namePrefix: "gbrain_",
		...overrides,
	};
}

function tool(name: string): AgentTool {
	return {
		name,
		label: name,
		description: "",
		parameters: { type: "object", properties: {} } as AgentTool["parameters"],
		execute: async () => ({ content: [], details: undefined }),
	};
}

interface Recorded {
	clients: Array<{ config: unknown }>;
	toolCalls: Array<{ client: McpClientLike; namePrefix: string | undefined }>;
}

/** Fake deps: records every client construction and createTools call; `failFor` makes createTools throw for that server name. */
function fakeDeps(toolsByServer: Record<string, string[]>, failFor: string[] = []): McpLoadDeps & Recorded {
	const recorded: Recorded = { clients: [], toolCalls: [] };
	return {
		...recorded,
		createClient(config) {
			recorded.clients.push({ config });
			const client: McpClientLike = { config };
			return client;
		},
		async createTools(client, options) {
			recorded.toolCalls.push({ client, namePrefix: options?.namePrefix });
			const name = (client.config as { name: string }).name;
			if (failFor.includes(name)) {
				throw new Error(`MCP initialize failed: HTTP 401 Unauthorized`);
			}
			return (toolsByServer[name] ?? []).map((t) => tool(`${options?.namePrefix ?? ""}${t}`));
		},
	};
}

describe("loadMcpTools", () => {
	it("builds one client per enabled entry from exactly { name, url, headers }, headers untouched", async () => {
		const deps = fakeDeps({ gbrain: ["get_page"] });
		const server = entry();
		await loadMcpTools([server], deps);
		expect(deps.clients).toHaveLength(1);
		expect(deps.clients[0].config).toEqual({ name: "gbrain", url: "http://127.0.0.1:8795/mcp", headers: { Authorization: SECRET } });
	});

	it("skips disabled entries without creating a client and reports them as disabled", async () => {
		const deps = fakeDeps({ gbrain: ["get_page"] });
		const { tools, results } = await loadMcpTools([entry({ enabled: false })], deps);
		expect(deps.clients).toHaveLength(0);
		expect(tools).toEqual([]);
		expect(results).toEqual([{ id: "id-gbrain", name: "gbrain", state: "disabled", toolCount: 0 }]);
	});

	it("passes each server's namePrefix to createTools and concatenates tools in entry order", async () => {
		const deps = fakeDeps({ gbrain: ["get_page", "search"], honcho: ["chat"] });
		const { tools } = await loadMcpTools(
			[entry(), entry({ id: "id-honcho", name: "honcho", url: "http://127.0.0.1:8790/", headers: undefined, namePrefix: "honcho_" })],
			deps,
		);
		expect(tools.map((t) => t.name)).toEqual(["gbrain_get_page", "gbrain_search", "honcho_chat"]);
		expect(deps.toolCalls.map((c) => c.namePrefix)).toEqual(["gbrain_", "honcho_"]);
	});

	it("passes no prefix when the entry has none", async () => {
		const deps = fakeDeps({ gbrain: ["get_page"] });
		const { tools } = await loadMcpTools([entry({ namePrefix: undefined })], deps);
		expect(tools.map((t) => t.name)).toEqual(["get_page"]);
		expect(deps.toolCalls[0].namePrefix).toBeUndefined();
	});

	it("isolates a failing server: the others still load, the failure is reported, nothing throws", async () => {
		const deps = fakeDeps({ gbrain: ["get_page"], honcho: ["chat"] }, ["gbrain"]);
		const { tools, results } = await loadMcpTools(
			[entry(), entry({ id: "id-honcho", name: "honcho", url: "http://127.0.0.1:8790/", namePrefix: "honcho_" })],
			deps,
		);
		expect(tools.map((t) => t.name)).toEqual(["honcho_chat"]);
		expect(results).toEqual([
			{ id: "id-gbrain", name: "gbrain", state: "error", toolCount: 0, message: "MCP initialize failed: HTTP 401 Unauthorized" },
			{ id: "id-honcho", name: "honcho", state: "connected", toolCount: 1 },
		]);
	});

	it("never puts a header value into results", async () => {
		const deps = fakeDeps({ gbrain: ["get_page"] }, ["gbrain"]);
		const { results } = await loadMcpTools([entry()], deps);
		expect(JSON.stringify(results)).not.toContain("sk-live");
		expect(JSON.stringify(results)).not.toContain("Bearer");
	});

	it("returns empty tools and results for no entries", async () => {
		const deps = fakeDeps({});
		expect(await loadMcpTools([], deps)).toEqual({ tools: [], results: [] });
		expect(deps.clients).toHaveLength(0);
	});
});

describe("describeMcpLoad", () => {
	const results: McpServerLoadResult[] = [
		{ id: "a", name: "gbrain", state: "connected", toolCount: 92 },
		{ id: "b", name: "honcho", state: "error", toolCount: 0, message: "MCP initialize failed: HTTP 401 Unauthorized" },
		{ id: "c", name: "old", state: "disabled", toolCount: 0 },
	];

	it("counts connected servers over enabled ones and sums tools", () => {
		const text = describeMcpLoad(results);
		expect(text).toContain("1/2");
		expect(text).toContain("92");
	});

	it("is empty when nothing is configured", () => {
		expect(describeMcpLoad([])).toBe("");
	});

	it("names failed servers so the header tooltip can show them, without any header value", () => {
		const text = describeMcpLoad(results);
		expect(text).toContain("honcho");
		expect(text).not.toContain("Bearer");
	});
});
