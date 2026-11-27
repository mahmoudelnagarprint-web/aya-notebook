import type { AyaAttachment, AyaInboxItem } from '@ayatodoist/shared-types';

/**
 * WhatsApp bridge — dual mode, cleanly pluggable.
 *
 * Mode A (cloud): official WhatsApp Cloud API + webhook verification, ready for
 * online deployment.
 * Mode B (qr): a local direct bridge. Baileys is optional; if it is not
 * installed the status endpoint says exactly how to add it and the server keeps
 * running untouched.
 */

export type WhatsAppMode = 'cloud' | 'qr';

export interface WhatsAppChannelConfig {
  mode: WhatsAppMode;
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  proactive: boolean;
}

export interface WhatsAppInbound {
  externalId: string;
  text: string;
  attachments?: AyaAttachment[];
}

export interface WhatsAppBridgeDeps {
  onMessage: (input: { channel: 'whatsapp'; externalId: string; text: string; attachments?: AyaAttachment[] }) => Promise<string>;
  fetchImpl?: typeof fetch;
}

const GRAPH = 'https://graph.facebook.com/v21.0';

type DynamicImport = (specifier: string) => Promise<unknown>;

export class WhatsAppBridge {
  config: WhatsAppChannelConfig = {
    mode: 'cloud',
    phoneNumberId: '',
    accessToken: '',
    verifyToken: '',
    proactive: false,
  };
  lastError: string | null = null;
  lastInboundAt: string | null = null;
  enabled = false;

  constructor(private readonly deps: WhatsAppBridgeDeps) {}

  configure(config: Record<string, unknown>, enabled = false): void {
    this.enabled = enabled;
    this.config = {
      mode: config.mode === 'qr' ? 'qr' : 'cloud',
      phoneNumberId: String(config.phoneNumberId ?? '').trim(),
      accessToken: String(config.accessToken ?? '').trim(),
      verifyToken: String(config.verifyToken ?? '').trim(),
      proactive: config.proactive === true || config.proactive === 'true',
    };
  }

  private get fetchImpl(): typeof fetch {
    return this.deps.fetchImpl ?? fetch;
  }

  /** GET /api/aya/webhooks/whatsapp — Meta verification handshake. */
  verify(query: Record<string, string | undefined>): { ok: boolean; challenge?: string; reason?: string } {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];
    if (mode !== 'subscribe') return { ok: false, reason: 'Unsupported mode' };
    if (!this.config.verifyToken || token !== this.config.verifyToken) return { ok: false, reason: 'Verify token mismatch' };
    return { ok: true, challenge };
  }

  /** POST /api/aya/webhooks/whatsapp — inbound Cloud API events. */
  async handleWebhook(body: unknown): Promise<{ handled: number; replies: number }> {
    const entries = (body as { entry?: Array<{ changes?: Array<{ value?: { messages?: Array<Record<string, unknown>> } }> }> })?.entry ?? [];
    let handled = 0;
    let replies = 0;
    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        for (const message of change.value?.messages ?? []) {
          const from = String(message.from ?? '');
          if (!from) continue;
          const type = String(message.type ?? 'text');
          let text = '';
          const attachments: AyaAttachment[] = [];
          if (type === 'text') {
            text = String((message.text as { body?: string } | undefined)?.body ?? '');
          } else if (type === 'image') {
            const image = message.image as { caption?: string; mime_type?: string } | undefined;
            text = image?.caption ?? '[صورة]';
            attachments.push({ kind: 'image', name: 'whatsapp-image', mime: image?.mime_type ?? 'image/jpeg' });
          } else if (type === 'audio') {
            text = '[رسالة صوتية]';
            attachments.push({ kind: 'file', name: 'whatsapp-voice.ogg', mime: 'audio/ogg' });
          } else if (type === 'document') {
            const doc = message.document as { filename?: string; mime_type?: string } | undefined;
            text = `[ملف: ${doc?.filename ?? 'document'}]`;
            attachments.push({ kind: 'file', name: doc?.filename ?? 'document', mime: doc?.mime_type ?? 'application/octet-stream' });
          } else {
            continue;
          }
          handled += 1;
          this.lastInboundAt = new Date().toISOString();
          try {
            const reply = await this.deps.onMessage({ channel: 'whatsapp', externalId: from, text, attachments });
            if (reply && (await this.send(from, reply))) replies += 1;
          } catch (error) {
            this.lastError = (error as Error).message;
          }
        }
      }
    }
    return { handled, replies };
  }

  async send(to: string, text: string): Promise<boolean> {
    if (!this.config.phoneNumberId || !this.config.accessToken) return false;
    try {
      const response = await this.fetchImpl(`${GRAPH}/${this.config.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.accessToken}` },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text.slice(0, 4000) } }),
      });
      if (!response.ok) {
        this.lastError = `WhatsApp send failed (${response.status})`;
        return false;
      }
      return true;
    } catch (error) {
      this.lastError = (error as Error).message;
      return false;
    }
  }

  async sendProactive(items: AyaInboxItem[]): Promise<void> {
    void items;
    // Cloud API needs a recipient; proactive WhatsApp pushes are opt-in per chat
    // and intentionally left to the outbound API to avoid unsolicited messages.
  }

  async status(): Promise<Record<string, unknown>> {
    if (this.config.mode === 'cloud') {
      return {
        mode: 'cloud',
        status: this.enabled ? (this.config.phoneNumberId && this.config.accessToken ? 'configured' : 'incomplete') : 'disabled',
        webhook: '/api/aya/webhooks/whatsapp',
        lastError: this.lastError,
        lastInboundAt: this.lastInboundAt,
      };
    }
    const baileys = await this.tryLoadBaileys();
    return {
      mode: 'qr',
      status: baileys ? 'available' : 'setup_required',
      qr: null,
      note: baileys
        ? 'Baileys متاح — امسحي كود QR من طرف العميل المحلي (Bridge محلي نظيف).'
        : 'للتشغيل المحلي المباشر: bun add @whiskeysockets/baileys ثم أعيدي تشغيل الخادم. مفيش أي تأثير على باقي النظام دلوقتي.',
      lastError: this.lastError,
    };
  }

  private async tryLoadBaileys(): Promise<boolean> {
    try {
      // Dynamic specifier keeps the optional dependency out of the static graph,
      // so an absent package can never break the build or boot.
      const dynamicImport = new Function('specifier', 'return import(specifier)') as DynamicImport;
      await dynamicImport('@whiskeysockets/baileys');
      return true;
    } catch {
      return false;
    }
  }
}
