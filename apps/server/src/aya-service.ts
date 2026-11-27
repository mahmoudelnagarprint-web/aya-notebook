import type { Kernel } from '@ayatodoist/core-kernel';
import type { AyaModel, AyaSettings } from '@ayatodoist/shared-types';
import type { SqliteAyaStore } from '@ayatodoist/database';
import type { FetchedModel } from '../../../plugins/plugin-ai-agent/src/aya/providers';
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

const HEALTH_CONCURRENCY = 4;
const HEALTH_TICK_MS = 60_000;

export class AyaService {
  private readonly kernel: Kernel;
  private readonly adapter: SqliteAyaStore;
  private readonly fetchImpl?: typeof fetch;
  private healthTimer: ReturnType<typeof setInterval> | null = null;

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

  private async probeAndSave(provider: any, model: AyaModel): Promise<AyaModel> {
    const result = await probeModel({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey ?? '',
      modelId: model.modelId,
      fetchImpl: this.fetchImpl,
    });

    return this.adapter.saveModel({
      ...model,
      status: result.ok ? 'ok' : 'failed',
      latencyMs: result.latencyMs,
      lastTestedAt: new Date().toISOString(),
      // A model that passed is usable again (auto-reactivation); a model that
      // failed is taken out of the failover pool until a later probe recovers it.
      enabled: result.ok,
      lastError: result.error ? redactSecret(result.error, provider.apiKey ?? '').slice(0, 200) : null,
    });
  }

  async testModel(id: string): Promise<any> {
    const model = this.adapter.listModels().find((entry) => entry.id === id);
    if (!model) throw new Error(`Unknown model: ${id}`);
    const provider = this.adapter.listProviders().find((entry) => entry.id === model.providerId);
    if (!provider) throw new Error(`Unknown provider for model: ${model.providerId}`);
    return this.probeAndSave(provider, model);
  }

  /** Probes every model of one provider in controlled batches of 4. */
  async testAllModels(providerId: string): Promise<{ providerId: string; models: AyaModel[]; tested: number; ok: number; failed: number }> {
    const provider = this.adapter.listProviders().find((entry) => entry.id === providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);
    const rows = this.adapter.listModels(providerId);

    let cursor = 0;
    const worker = async () => {
      while (cursor < rows.length) {
        const index = cursor;
        cursor += 1;
        await this.probeAndSave(provider, rows[index]!);
      }
    };
    await Promise.all(Array.from({ length: Math.min(HEALTH_CONCURRENCY, rows.length) }, worker));

    const models = this.adapter.listModels(providerId);
    return {
      providerId,
      models,
      tested: rows.length,
      ok: models.filter((model) => model.status === 'ok').length,
      failed: models.filter((model) => model.status === 'failed').length,
    };
  }

  /**
   * Re-probes the whole catalogue (failed / disabled rows first) and turns any
   * model that answers again straight back on.
   */
  async runHealthCheck(): Promise<{ checked: number; ok: number; failed: number; reEnabled: number; lastCheckAt: string }> {
    const providers = this.adapter.listProviders();
    const byId = new Map(providers.map((provider) => [provider.id, provider]));
    const all = this.adapter.listModels();
    const rows = all
      .filter((model) => byId.has(model.providerId))
      .sort((a, b) => {
        const rank = (model: AyaModel) => (model.status === 'failed' || model.enabled === false ? 0 : 1);
        return rank(a) - rank(b) || a.priority - b.priority;
      });

    let cursor = 0;
    let reEnabled = 0;
    const worker = async () => {
      while (cursor < rows.length) {
        const index = cursor;
        cursor += 1;
        const model = rows[index]!;
        const wasDisabled = model.enabled === false || model.status === 'failed';
        const saved = await this.probeAndSave(byId.get(model.providerId)!, model);
        if (saved.status === 'ok' && wasDisabled) reEnabled += 1;
      }
    };
    await Promise.all(Array.from({ length: Math.min(HEALTH_CONCURRENCY, rows.length) }, worker));

    const current = (this.adapter.getSettings() ?? {}) as Partial<AyaSettings>;
    const lastCheckAt = new Date().toISOString();
    this.adapter.saveSettings({ ...current, healthCheckLastAt: lastCheckAt, updatedAt: lastCheckAt });

    const models = this.adapter.listModels();
    return {
      checked: rows.length,
      ok: models.filter((model) => model.status === 'ok').length,
      failed: models.filter((model) => model.status === 'failed').length,
      reEnabled,
      lastCheckAt,
    };
  }

  /**
   * Background loop: every minute, run a health check when the configured
   * interval has elapsed. `unref` keeps the timer from holding the process open.
   */
  startHealthChecks(): void {
    this.stopHealthChecks();
    const tick = async () => {
      try {
        const settings = (this.adapter.getSettings() ?? {}) as Partial<AyaSettings>;
        if (settings.healthCheckEnabled === false) return;
        const minutes = Number(settings.healthCheckMinutes) || 15;
        const last = settings.healthCheckLastAt ? Date.parse(String(settings.healthCheckLastAt)) : 0;
        if (Number.isFinite(last) && last > 0 && Date.now() - last < minutes * 60_000) return;
        await this.runHealthCheck();
      } catch {
        /* a background probe must never crash the server */
      }
    };
    this.healthTimer = setInterval(() => void tick(), HEALTH_TICK_MS);
    (this.healthTimer as unknown as { unref?: () => void })?.unref?.();
  }

  stopHealthChecks(): void {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
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

    const probed = this.saveDiscoveredModels(providerId, discovered);
    return { models: this.adapter.listModels(providerId), latencyMs, probed };
  }

  /** Discovers the catalogue without saving anything, for the model picker. */
  async previewModels(providerId: string): Promise<{
    providerId: string;
    models: Array<FetchedModel & { exists: boolean }>;
    latencyMs: number;
  }> {
    const provider = this.adapter.listProviders().find((entry) => entry.id === providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);

    const { models: discovered, latencyMs } = await fetchProviderModels({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey ?? '',
      fetchImpl: this.fetchImpl,
    });
    const existing = new Set(this.adapter.listModels(providerId).map((model) => model.modelId));
    return {
      providerId,
      models: discovered.map((entry) => ({ ...entry, exists: existing.has(entry.modelId) })),
      latencyMs,
    };
  }

  /** Saves only the models the picker selected. */
  async addModels(providerId: string, entries: FetchedModel[]): Promise<{ providerId: string; added: number; models: any[] }> {
    const provider = this.adapter.listProviders().find((entry) => entry.id === providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);
    const added = this.saveDiscoveredModels(providerId, Array.isArray(entries) ? entries : []);
    return { providerId, added, models: this.adapter.listModels(providerId) };
  }

  /** Deletes every failed or disabled model of one provider in a single call. */
  async deleteFailedModels(providerId: string): Promise<{ providerId: string; deleted: number; models: any[] }> {
    const provider = this.adapter.listProviders().find((entry) => entry.id === providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);
    const broken = this.adapter.listModels(providerId).filter((model) => model.status === 'failed' || model.enabled === false);
    for (const model of broken) this.adapter.deleteModel(model.id);
    return { providerId, deleted: broken.length, models: this.adapter.listModels(providerId) };
  }

  private saveDiscoveredModels(providerId: string, entries: FetchedModel[]): number {
    const existing = this.adapter.listModels(providerId);
    const known = new Set(existing.map((model) => model.modelId));
    let priority = existing.reduce((max, model) => Math.max(max, Number(model.priority ?? 0)), 0);
    let added = 0;
    for (const entry of entries) {
      const modelId = String(entry?.modelId ?? '').trim();
      if (!modelId || known.has(modelId)) continue;
      known.add(modelId);
      priority += 1;
      this.adapter.saveModel({
        id: `${providerId}_${modelId}`.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 80) + `_${Math.random().toString(36).slice(2, 6)}`,
        providerId,
        modelId,
        label: entry.label || modelId,
        contextWindow: entry.contextWindow ?? null,
        vision: Boolean(entry.vision),
        priority,
        failover: true,
        enabled: true,
        status: 'unknown',
        latencyMs: null,
        lastTestedAt: null,
        createdAt: new Date().toISOString(),
      });
      added += 1;
    }
    return added;
  }

  async listProviders(): Promise<any[]> {
    return this.adapter.listProviders();
  }

  async listModels(): Promise<any[]> {
    return this.adapter.listModels();
  }
}
