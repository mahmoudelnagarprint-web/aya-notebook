import type { AyaAttachment, AyaInboxItem } from '@ayatodoist/shared-types';

/**
 * Telegram bridge — clean `fetch` long polling, zero heavy dependencies.
 *
 * Inbound text / photos / voice notes go through the exact same AyaBrain as the
 * web chat (same persona, 72+ tools, memory, failover). It works identically
 * locally and on a 24/7 server: only a bot token and chat ids are needed.
 */

export interface TelegramChannelConfig {
  botToken: string;
  allowedChatIds: string;
  proactive: boolean;
}

export interface TelegramInbound {
  chatId: string;
  text: string;
  attachments?: AyaAttachment[];
  imageDataUrls?: Record<string, string>;
}

export interface TelegramBridgeDeps {
  onMessage: (input: TelegramInbound) => Promise<string>;
  fetchImpl?: typeof fetch;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  chat: { id: number | string };
  text?: string;
  caption?: string;
  photo?: Array<{ file_id: string; file_size?: number }>;
  voice?: { file_id: string; mime_type?: string };
  audio?: { file_id: string; mime_type?: string; file_name?: string };
  document?: { file_id: string; mime_type?: string; file_name?: string };
}

const API = 'https://api.telegram.org';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TelegramBridge {
  private running = false;
  private abort: AbortController | null = null;
  private offset = 0;
  private knownChats = new Set<string>();
  private startedAt: string | null = null;
  lastError: string | null = null;
  lastUpdateAt: string | null = null;
  config: TelegramChannelConfig = { botToken: '', allowedChatIds: '', proactive: false };

  constructor(private readonly deps: TelegramBridgeDeps) {}

  configure(config: Record<string, unknown>): void {
    const previousToken = this.config.botToken;
    this.config = {
      botToken: String(config.botToken ?? '').trim(),
      allowedChatIds: String(config.allowedChatIds ?? '').trim(),
      proactive: config.proactive === true || config.proactive === 'true',
    };
    if (previousToken && previousToken !== this.config.botToken) this.stop();
  }

  private get fetchImpl(): typeof fetch {
    return this.deps.fetchImpl ?? fetch;
  }

  allowed(chatId: string): boolean {
    const list = this.config.allowedChatIds
      .split(/[,\s]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (list.length === 0) return true;
    return list.includes(chatId);
  }

  get polling(): boolean {
    return this.running;
  }

  async start(): Promise<{ running: boolean; error?: string }> {
    if (!this.config.botToken) return { running: false, error: 'Bot token is required' };
    if (this.running) return { running: true };
    this.running = true;
    this.startedAt = new Date().toISOString();
    this.abort = new AbortController();
    this.lastError = null;
    void this.loop();
    return { running: true };
  }

  stop(): void {
    this.running = false;
    this.abort?.abort();
    this.abort = null;
  }

  status(): Record<string, unknown> {
    return {
      configured: Boolean(this.config.botToken),
      running: this.running,
      polling: this.running,
      proactive: this.config.proactive,
      allowedChatIds: this.config.allowedChatIds,
      knownChats: [...this.knownChats],
      startedAt: this.startedAt,
      lastUpdateAt: this.lastUpdateAt,
      lastError: this.lastError,
      mode: 'long-polling',
    };
  }

  private async loop(): Promise<void> {
    const token = this.config.botToken;
    while (this.running) {
      try {
        const response = await this.fetchImpl(`${API}/bot${token}/getUpdates?timeout=25&offset=${this.offset}`, {
          signal: this.abort?.signal,
        });
        const payload = (await response.json()) as { ok?: boolean; description?: string; result?: TelegramUpdate[] };
        if (!payload.ok) throw new Error(payload.description ?? 'Telegram rejected getUpdates');
        for (const update of payload.result ?? []) {
          this.offset = update.update_id + 1;
          await this.handleUpdate(update);
        }
        if ((payload.result ?? []).length === 0) await wait(400);
      } catch (error) {
        if (!this.running) break;
        this.lastError = (error as Error).message;
        await wait(5_000);
      }
    }
  }

  /** Public so webhooks / tests can feed a raw Telegram update directly. */
  async handleUpdate(update: TelegramUpdate): Promise<string | null> {
    const message = update.message ?? update.channel_post;
    if (!message) return null;
    const chatId = String(message.chat.id);
    if (!this.allowed(chatId)) return null;
    this.knownChats.add(chatId);
    this.lastUpdateAt = new Date().toISOString();

    const attachments: AyaAttachment[] = [];
    const imageDataUrls: Record<string, string> = {};
    let text = message.text ?? message.caption ?? '';

    const photo = message.photo?.at(-1);
    if (photo) {
      const image = await this.download(photo.file_id);
      if (image) {
        const filename = `tg_${photo.file_id}.jpg`;
        attachments.push({ kind: 'image', name: filename, mime: 'image/jpeg', filename, size: image.length });
        imageDataUrls[filename] = `data:image/jpeg;base64,${Buffer.from(image).toString('base64')}`;
      }
      if (!text) text = '[صورة]';
    }

    const audio = message.voice ?? message.audio;
    if (audio) {
      attachments.push({
        kind: 'file',
        name: message.audio?.file_name ?? 'voice-note.ogg',
        mime: audio.mime_type ?? 'audio/ogg',
        text: '[رسالة صوتية — المستخدم بعت صوت. اطلبي منه يكتب النقطة المهمة لو محتاجة تفاصيل.]',
      });
      if (!text) text = '[رسالة صوتية]';
    }

    if (message.document) {
      attachments.push({
        kind: 'file',
        name: message.document.file_name ?? 'document',
        mime: message.document.mime_type ?? 'application/octet-stream',
      });
      if (!text) text = `[ملف: ${message.document.file_name ?? 'document'}]`;
    }

    if (!text.trim() && attachments.length === 0) return null;
    const reply = await this.deps.onMessage({ chatId, text, attachments, imageDataUrls });
    if (reply) await this.sendMessage(chatId, reply);
    return reply;
  }

  private async download(fileId: string): Promise<Uint8Array | null> {
    try {
      const token = this.config.botToken;
      const info = (await (await this.fetchImpl(`${API}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`)).json()) as {
        ok?: boolean;
        result?: { file_path?: string };
      };
      const filePath = info.result?.file_path;
      if (!info.ok || !filePath) return null;
      const response = await this.fetchImpl(`https://api.telegram.org/file/bot${token}/${filePath}`);
      if (!response.ok) return null;
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      this.lastError = `media download: ${(error as Error).message}`;
      return null;
    }
  }

  async sendMessage(chatId: string, text: string): Promise<boolean> {
    if (!this.config.botToken) return false;
    try {
      const response = await this.fetchImpl(`${API}/bot${this.config.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
      });
      return response.ok;
    } catch (error) {
      this.lastError = (error as Error).message;
      return false;
    }
  }

  /** Pushes proactive «رسائل آية» cards to Telegram when enabled. */
  async sendProactive(items: AyaInboxItem[]): Promise<number> {
    if (!this.config.proactive || !this.config.botToken) return 0;
    const targets = [...this.knownChats];
    for (const entry of this.config.allowedChatIds.split(/[,\s]+/).filter(Boolean)) targets.push(entry);
    const unique = [...new Set(targets)];
    if (unique.length === 0) return 0;
    let sent = 0;
    for (const item of items) {
      const text = `✨ آية — ${item.title}\n${item.body}`;
      for (const chatId of unique) {
        if (await this.sendMessage(chatId, text)) sent += 1;
      }
    }
    return sent;
  }
}
