import type { Kernel } from '@ayatodoist/core-kernel';
import type { AyaModel } from '@ayatodoist/shared-types';
import type { SqliteAyaStore } from '@ayatodoist/database';
import { cleanApiKey, fetchProviderModels, normalizeBaseUrl, probeModel, redactSecret } from '../../../plugins/plugin-ai-agent/src/aya/providers';

export const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

interface AyaServiceOpts {
  kernel: Kernel;
  adapter: SqliteAyaStore;
  fetchImpl?: typeof fetch;
}

const MASK = /^[•*·\s]+$/;

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export class AyaService {
  private readonly kernel: Kernel;
  private readonly adapter: SqliteAyaStore;
  private readonly fetchImpl?: typeof fetch;

  constructor(opts: AyaServiceOpts) {
    this.kernel = opts.kernel;
    this.adapter = opts.adapter;
    this.fetchImpl = opts.fetchImpl;
  }

  async init(): Promise<void> {
    const providers = this.adapter.listProviders();
    if (!providers.some((provider) => provider.name === 'Google Gemini')) {
      this.adapter.saveProvider({
        id: newId('prv'),
        name: 'Google Gemini',
        baseUrl: DEFAULT_GEMINI_BASE_URL,
        apiKey: '',
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  async addProvider(input: { name: string; baseUrl: string; apiKey: string }): Promise<any> {
    const name = String(input.name ?? '').trim();
    if (!name) throw new Error('Provider name is required');
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    if (!baseUrl) throw new Error('Base URL is required');
    const apiKey = cleanApiKey(input.apiKey);
    const now = new Date().toISOString();

    const existing = this.adapter.listProviders().find((provider) => provider.name === name);
    if (existing) {
      const saved = this.adapter.saveProvider({ ...existing, baseUrl, apiKey, updatedAt: now });
      return saved;
    }
    return this.adapter.saveProvider({
      id: newId('prv'),
      name,
      baseUrl,
      apiKey,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** A blank or masked key means "keep what is stored" — never overwrite with dots. */
  async updateProvider(id: string, patch: { name?: string; baseUrl?: string; apiKey?: string; enabled?: boolean }): Promise<any> {
    const provider = this.adapter.listProviders().find((entry) => entry.id === id);
    if (!provider) throw new Error(`Unknown provider: ${id}`);

    const next = { ...provider };
    if (patch.name !== undefined && patch.name.trim()) next.name = patch.name.trim();
    if (patch.baseUrl !== undefined && patch.baseUrl.trim()) next.baseUrl = normalizeBaseUrl(patch.baseUrl);
    if (patch.enabled !== undefined) next.enabled = patch.enabled;
    if (patch.apiKey !== undefined) {
      const raw = String(patch.apiKey);
      const cleaned = cleanApiKey(raw);
      const masked = MASK.test(raw.trim());
      if (cleaned && !masked) next.apiKey = cleaned;
    }
    next.updatedAt = new Date().toISOString();
    return this.adapter.saveProvider(next);
  }

  async deleteProvider(id: string): Promise<void> {
    this.adapter.deleteProvider(id);
  }

  async addManualModel(providerId: string, opts: { modelId: string; label?: string }): Promise<any> {
    const modelId = String(opts.modelId ?? '').trim();
    if (!modelId) throw new Error('Model id is required');
    const now = new Date().toISOString();
    const model: AyaModel = {
      id: newId('mdl'),
      providerId,
      modelId,
      label: opts.label?.trim() || modelId,
      contextWindow: null,
      vision: false,
      priority: this.adapter.listModels(providerId).length + 1,
      failover: true,
      enabled: true,
      status: 'unknown',
      latencyMs: null,
      lastTestedAt: null,
      createdAt: now,
    };
    return this.adapter.saveModel(model);
  }

  async addModel(providerId: string, modelId: string, label?: string): Promise<any> {
    return this.addManualModel(providerId, { modelId, label });
  }

  async updateModel(id: string, patch: { failover?: boolean; label?: string; priority?: number; enabled?: boolean; vision?: boolean }): Promise<any> {
    const model = this.adapter.listModels().find((entry) => entry.id === id);
    if (!model) throw new Error(`Unknown model: ${id}`);

    const next: AyaModel = { ...model };
    if (patch.failover !== undefined) next.failover = patch.failover;
    if (patch.enabled !== undefined) next.enabled = patch.enabled;
    if (patch.vision !== undefined) next.vision = patch.vision;
    if (patch.priority !== undefined && Number.isFinite(patch.priority)) next.priority = patch.priority;
    if (patch.label !== undefined && patch.label.trim()) next.label = patch.label.trim();
    if (!next.label) next.label = next.modelId;
    return this.adapter.saveModel(next);
  }

  async deleteModel(id: string): Promise<void> {
    this.adapter.deleteModel(id);
  }

  async testModel(id: string): Promise<any> {
    const model = this.adapter.listModels().find((entry) => entry.id === id);
    if (!model) throw new Error(`Unknown model: ${id}`);
    const provider = this.adapter.listProviders().find((entry) => entry.id === model.providerId);
    if (!provider) throw new Error(`Unknown provider for model: ${model.providerId}`);

    const result = await probeModel({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey ?? '',
      modelId: model.modelId,
      fetchImpl: this.fetchImpl,
    });

    const next: AyaModel = {
      ...model,
      status: result.ok ? 'ok' : 'failed',
      latencyMs: result.latencyMs,
      lastTestedAt: new Date().toISOString(),
      lastError: result.error ? redactSecret(result.error, provider.apiKey ?? '').slice(0, 200) : null,
    };
    return this.adapter.saveModel(next);
  }

  /**
   * Imports every model the provider advertises, keeping existing rows (and
   * their probe results) untouched. The returned list is what the settings
   * screen renders immediately after «جلب واختبار».
   */
  async fetchModels(providerId: string): Promise<{ models: any[]; latencyMs: number; probed: number }> {
    const provider = this.adapter.listProviders().find((entry) => entry.id === providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);

    const { models: discovered, latencyMs } = await fetchProviderModels({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey ?? '',
      fetchImpl: this.fetchImpl,
    });

    const existing = this.adapter.listModels(providerId);
    let priority = existing.reduce((max, model) => Math.max(max, Number(model.priority ?? 0)), 0);
    let probed = 0;
    for (const entry of discovered) {
      if (existing.some((model) => model.modelId === entry.modelId)) continue;
      priority += 1;
      this.adapter.saveModel({
        id: `${providerId}_${entry.modelId}`.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 80) + `_${Math.random().toString(36).slice(2, 6)}`,
        providerId,
        modelId: entry.modelId,
        label: entry.label || entry.modelId,
        contextWindow: entry.contextWindow,
        vision: entry.vision,
        priority,
        failover: true,
        enabled: true,
        status: 'unknown',
        latencyMs: null,
        lastTestedAt: null,
        createdAt: new Date().toISOString(),
      });
      probed += 1;
    }

    return { models: this.adapter.listModels(providerId), latencyMs, probed };
  }

  async listProviders(): Promise<any[]> {
    return this.adapter.listProviders();
  }

  async listModels(): Promise<any[]> {
    return this.adapter.listModels();
  }
}
