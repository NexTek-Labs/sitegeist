import { ProvidersModelsTab } from "@mariozechner/pi-web-ui";
import { html, type TemplateResult } from "lit";

/**
 * Settings tab for user-configured LLM servers (Ollama, llama.cpp, vLLM, LM Studio,
 * OpenAI/Anthropic-compatible endpoints).
 *
 * Reuses the custom-provider section of pi-web-ui's ProvidersModelsTab; the cloud-provider
 * API-key section is intentionally omitted because Sitegeist renders that (plus OAuth) in
 * ApiKeysOAuthTab.
 */
export class CustomProvidersTab extends ProvidersModelsTab {
	override getTabName(): string {
		return "Custom Providers";
	}

	override render(): TemplateResult {
		return html`<div class="flex flex-col gap-8">${this.renderCustomProviders()}</div>`;
	}
}

if (!customElements.get("custom-providers-tab")) {
	customElements.define("custom-providers-tab", CustomProvidersTab);
}
