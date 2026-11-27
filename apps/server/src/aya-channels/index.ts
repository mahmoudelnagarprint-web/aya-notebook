import type { AyaAttachment, AyaChannelId, AyaChannelRecord, AyaInboxItem, AyaPersistenceAdapter } from '@ayatodoist/shared-types';
import { TelegramBridge } from './telegram';
import { WhatsAppBridge } from './whatsapp';

export { TelegramBridge } from './telegram';
export { WhatsAppBridge } from './whatsapp';

export interface ChannelMessageInput {
  channel: AyaChannelId;
  externalId: string;
  text: string;
  attachments?: AyaAttachment[];
  imageDataUrls?: Record<string, string>;
}

export interface AyaChannelHubDeps {
  adapter: AyaPersistenceAdapter;
  onMessage: (input: ChannelMessageInput) => Promise<string>;
  fetchImpl?: typeof fetch;
}

function now(): string {
  return new Date().toISOString();
}

/** Config + lifecycle for every external bridge, controlled from Settings → Aya → القنوات. */
export class AyaChannelHub {
  readonly telegram: TelegramBridge;
  readonly whatsapp: WhatsAppBridge;

  constructor(private readonly deps: AyaChannelHubDeps) {
    this.telegram = new TelegramBridge({
      fetchImpl: deps.fetchImpl,
      onMessage: (input) =>
        deps.onMessage({
          channel: 'telegram',
          externalId: input.chatId,
          text: input.text,
          attachments: input.attachments,
          imageDataUrls: input.imageDataUrls,
        }),
    });
    this.whatsapp = new WhatsAppBridge({
      fetchImpl: deps.fetchImpl,
      onMessage: (input) =>
        deps.onMessage({
          channel: 'whatsapp',
          externalId: input.externalId,
          text: input.text,
          attachments: input.attachments,
        }),
    });
  }

  async load(): Promise<void> {
    const channels = await this.deps.adapter.listChannels();
    for (const channel of channels) {
      if (channel.id === 'telegram') {
        this.telegram.configure(channel.config);
        if (channel.enabled && this.telegram.config.botToken) await this.telegram.start();
      } else if (channel.id === 'whatsapp') {
        this.whatsapp.configure(channel.config, channel.enabled);
      }
    }
  }

  async list(): Promise<AyaChannelRecord[]> {
    return this.deps.adapter.listChannels();
  }

  async update(id: AyaChannelId, patch: { enabled?: boolean; config?: Record<string, unknown> }): Promise<AyaChannelRecord> {
    const channels = await this.deps.adapter.listChannels();
    const existing =
      channels.find((channel) => channel.id === id) ??
      ({ id, enabled: false, config: {}, updatedAt: now() } as AyaChannelRecord);
    const record: AyaChannelRecord = {
      ...existing,
      enabled: patch.enabled ?? existing.enabled,
      config: { ...existing.config, ...(patch.config ?? {}) } as Record<string, string | number | boolean>,
      updatedAt: now(),
    };
    await this.deps.adapter.saveChannel(record);
    if (id === 'telegram') {
      this.telegram.configure(record.config);
      if (record.enabled && this.telegram.config.botToken) await this.telegram.start();
      else this.telegram.stop();
    } else {
      this.whatsapp.configure(record.config, record.enabled);
    }
    return record;
  }

  async pushProactive(items: AyaInboxItem[]): Promise<{ telegram: number }> {
    const telegram = await this.telegram.sendProactive(items);
    await this.whatsapp.sendProactive(items);
    return { telegram };
  }

  async statuses(): Promise<Record<string, unknown>> {
    return {
      telegram: this.telegram.status(),
      whatsapp: await this.whatsapp.status(),
    };
  }
}
