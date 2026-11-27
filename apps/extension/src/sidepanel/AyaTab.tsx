/**
 * Tab 2 — streaming Aya workspace: SSE deltas, live tool chips, stop,
 * model switcher, conversations, batch undo and smart page tools.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ayaServer, type AyaConfig, type ChatEvent, type ConversationRow } from '../lib/server';
import { captureVisibleTab, dataUrlToFile, sendToActiveTab } from '../lib/browser';
import type { PendingPrompt } from '../lib/pending';

interface Chip {
  id: number;
  name: string;
  state: 'running' | 'done' | 'fail';
  summary?: string;
}

interface Bubble {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  chips?: Chip[];
  error?: boolean;
}

interface Attachment {
  kind: 'image' | 'file';
  url: string;
  name: string;
  preview?: string;
  text?: string;
}

interface Props {
  pending: PendingPrompt | null;
  onPendingConsumed: () => void;
  onActivity: () => void;
}

function statusIcon(model: { status?: string; enabled?: boolean }): string {
  if (model.enabled === false) return '🔴';
  if (model.status === 'ok') return '🟢';
  if (model.status === 'fail' || model.status === 'error') return '🔴';
  return '⚪';
}

export default function AyaTab({ pending, onPendingConsumed, onActivity }: Props) {
  const [config, setConfig] = useState<AyaConfig | null>(null);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [conversationId, setConversationId] = useState('');
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [input, setInput] = useState('');
  const [modelId, setModelId] = useState('auto');
  const [streaming, setStreaming] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pageContext, setPageContext] = useState<{ title: string; url: string; text: string } | null>(null);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [uploading, setUploading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const models = useMemo(() => {
    const rows = (config?.providers ?? []).flatMap((provider) =>
      provider.models
        .filter((model) => model.enabled !== false)
        .map((model) => ({ ...model, providerName: provider.name })),
    );
    return rows;
  }, [config]);

  const loadMeta = useCallback(async () => {
    try {
      const [cfg, conv] = await Promise.all([ayaServer.ayaConfig(), ayaServer.conversations()]);
      setConfig(cfg);
      setConversations(conv.conversations);
    } catch (err) {
      setError(`تعذر تحميل إعدادات آية: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    if (!pending) return;
    setInput((current) => (current ? `${current}\n${pending.text}` : pending.text));
    if (pending.imageUrl) {
      setAttachment({ kind: 'image', url: pending.imageUrl, name: 'صورة من الصفحة', preview: pending.imageUrl });
    }
    onPendingConsumed();
    composerRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const updateAssistant = (id: number, patch: (bubble: Bubble) => Bubble) => {
    setMessages((prev) => prev.map((bubble) => (bubble.id === id ? patch(bubble) : bubble)));
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && !attachment) || streaming) return;
    const contextParts: string[] = [];
    if (attachment) {
      contextParts.push(
        `${attachment.kind === 'image' ? '🖼️ صورة مرفقة' : '📎 ملف مرفق'}: ${attachment.url}`,
      );
      if (attachment.text) contextParts.push(attachment.text.slice(0, 4000));
    }
    if (pageContext) {
      contextParts.push(`— سياق الصفحة —\n[${pageContext.title}](${pageContext.url})\n${pageContext.text}`);
    }
    const payloadText = [text, ...contextParts].filter(Boolean).join('\n\n');

    const userBubble: Bubble = { id: Date.now(), role: 'user', text: text || '📎 مرفق' };
    const assistantId = Date.now() + 1;
    setMessages((prev) => [...prev, userBubble, { id: assistantId, role: 'assistant', text: '', chips: [] }]);
    setInput('');
    setPageContext(null);
    setAttachment(null);
    setError('');
    setNotice('');
    setBatchId(null);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let chipSeq = 0;

    try {
      await ayaServer.streamChat(
        {
          text: payloadText,
          conversationId: conversationId || undefined,
          modelId: modelId === 'auto' ? undefined : modelId,
        },
        {
          signal: controller.signal,
          onEvent: (event: ChatEvent) => {
            if (event.event === 'meta' && event.data?.conversationId) {
              setConversationId(event.data.conversationId);
            } else if (event.event === 'delta') {
              const chunk = event.data?.text;
              if (typeof chunk === 'string' && chunk) {
                updateAssistant(assistantId, (bubble) => ({ ...bubble, text: bubble.text + chunk }));
              }
            } else if (event.event === 'tool_start') {
              chipSeq += 1;
              const chip: Chip = { id: chipSeq, name: String(event.data?.name ?? 'tool'), state: 'running' };
              updateAssistant(assistantId, (bubble) => ({ ...bubble, chips: [...(bubble.chips ?? []), chip] }));
            } else if (event.event === 'tool_result') {
              const name = String(event.data?.name ?? 'tool');
              updateAssistant(assistantId, (bubble) => {
                const chips = [...(bubble.chips ?? [])];
                for (let index = chips.length - 1; index >= 0; index -= 1) {
                  if (chips[index]!.name === name) {
                    chips[index] = {
                      ...chips[index]!,
                      state: event.data?.ok === false ? 'fail' : 'done',
                      summary: event.data?.summary,
                    };
                    break;
                  }
                }
                return { ...bubble, chips };
              });
            } else if (event.event === 'done') {
              if (event.data?.batchId) setBatchId(event.data.batchId);
              if (event.data?.conversationId) setConversationId(event.data.conversationId);
            } else if (event.event === 'error') {
              updateAssistant(assistantId, (bubble) => ({
                ...bubble,
                text: bubble.text || `خطأ: ${event.data?.message ?? 'غير متوقع'}`,
                error: true,
              }));
            }
          },
        },
      );
      onActivity();
      ayaServer.conversations().then((conv) => setConversations(conv.conversations)).catch(() => {});
    } catch (err) {
      const aborted = controller.signal.aborted;
      updateAssistant(assistantId, (bubble) => ({
        ...bubble,
        text: bubble.text || (aborted ? '⏹ تم إيقاف الرد.' : `تعذر الاتصال: ${err instanceof Error ? err.message : String(err)}`),
        error: !aborted,
      }));
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  const undo = async () => {
    if (!batchId) return;
    setNotice('جارٍ التراجع…');
    try {
      const result = await ayaServer.undo(batchId);
      setNotice(`↩ تم التراجع عن ${result?.undone ?? 0} عملية`);
      setBatchId(null);
      onActivity();
    } catch (err) {
      setNotice(`تعذر التراجع: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const selectConversation = async (id: string) => {
    setConversationId(id);
    setBatchId(null);
    setNotice('');
    if (!id) {
      setMessages([]);
      return;
    }
    try {
      const { messages: rows } = await ayaServer.messages(id);
      const mapped: Bubble[] = rows
        .filter((row) => row.role === 'user' || row.role === 'assistant')
        .map((row, index) => ({
          id: index + 1,
          role: row.role as 'user' | 'assistant',
          text: String(row.content ?? ''),
        }));
      setMessages(mapped);
    } catch (err) {
      setError(`تعذر تحميل المحادثة: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const readPage = async () => {
    const context = await sendToActiveTab<{ text: string; title: string; url: string }>({ type: 'aya-get-page-text' });
    if (!context?.text) {
      setNotice('تعذر قراءة هذه الصفحة (جرّب صفحة عادية بدل صفحة الإعدادات).');
      return;
    }
    setPageContext(context);
    setNotice(`📄 أُرفقت الصفحة (${context.text.length.toLocaleString('ar-EG')} حرف)`);
  };

  const screenshot = async () => {
    setUploading(true);
    try {
      const dataUrl = await captureVisibleTab();
      if (!dataUrl) throw new Error('لم أستطع التقاط الصفحة');
      const file = await dataUrlToFile(dataUrl, 'screenshot.png');
      const upload = await ayaServer.upload(file);
      setAttachment({ kind: 'image', url: upload.absoluteUrl, name: 'لقطة الشاشة', preview: dataUrl });
      setNotice('📸 أُرفقت لقطة الشاشة');
    } catch (err) {
      setNotice(`تعذر الالتقاط: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploading(false);
    }
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const upload = await ayaServer.upload(file);
      setAttachment({
        kind: upload.kind,
        url: upload.absoluteUrl,
        name: file.name,
        preview: upload.kind === 'image' ? upload.absoluteUrl : undefined,
        text: upload.text,
      });
      setNotice(`📎 أُرفق ${file.name}`);
    } catch (err) {
      setNotice(`تعذر الرفع: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <div className="card quick-add-card">
        <div className="aya-toolbar">
          <select className="select" value={conversationId} onChange={(event) => selectConversation(event.target.value)}>
            <option value="">محادثة جديدة</option>
            {conversations.map((conversation) => (
              <option key={conversation.id} value={conversation.id}>
                {conversation.title || 'محادثة'}
              </option>
            ))}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={() => selectConversation('')}>+ جديدة</button>
          <select className="select" value={modelId} onChange={(event) => setModelId(event.target.value)} title="الموديل">
            <option value="auto">تلقائي ⚡</option>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {statusIcon(model)} {model.label || model.modelId}
                {model.latencyMs ? ` · ${model.latencyMs}ms` : ''}
              </option>
            ))}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={loadMeta} title="تحديث الموديلات">⟳</button>
        </div>
        {config && models.length === 0 && (
          <div className="text-xs muted">لا توجد موديلات مضافة — أضف مزوّداً من تطبيق الويب ← الإعدادات ← آية.</div>
        )}
      </div>

      {error && <div className="toast-inline err">{error}</div>}
      {notice && <div className="toast-inline">{notice}</div>}

      <div className="chat-area">
        {messages.length === 0 && (
          <div className="empty-state">
            اسألي آية عن أي حاجة، أو استخدمي «اقرئي الصفحة المفتوحة» وأنا ألخّص أو أستخرج المهام.
          </div>
        )}
        {messages.map((bubble) => (
          <div key={bubble.id} className={`bubble ${bubble.role} ${bubble.error ? 'error' : ''}`}>
            <div className="bubble-role">{bubble.role === 'user' ? 'أنت' : 'آية ✨'}</div>
            {bubble.text || (streaming && bubble.role === 'assistant' ? <span className="spinner" style={{ display: 'inline-block' }} /> : null)}
            {bubble.chips && bubble.chips.length > 0 && (
              <div className="tool-chips" style={{ marginTop: 6 }}>
                {bubble.chips.map((chip) => (
                  <span key={chip.id} className={`tool-chip ${chip.state}`}>
                    {chip.state === 'running' ? '⏳' : chip.state === 'done' ? '✅' : '❌'} {chip.name}
                    {chip.summary ? ` — ${chip.summary}` : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {batchId && (
        <button className="btn btn-purple btn-sm" onClick={undo} style={{ alignSelf: 'flex-start' }}>
          ↩ تراجع عن دفعة آية
        </button>
      )}

      <section className="card composer-card">
        <div className="page-tools">
          <button className="tool-btn" onClick={readPage} disabled={streaming}>📄 اقرئي الصفحة المفتوحة</button>
          <button className="tool-btn" onClick={screenshot} disabled={uploading || streaming}>
            {uploading ? '⏳ جاري الرفع…' : '📸 لقطة شاشة للصفحة'}
          </button>
          <label className="tool-btn" style={{ cursor: 'pointer' }}>
            📎 ملف
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,.txt,.md,.json,.csv,.pdf"
              style={{ display: 'none' }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) uploadFile(file);
                event.target.value = '';
              }}
            />
          </label>
        </div>

        {pageContext && (
          <div className="context-chip">
            <span className="truncate grow">📄 {pageContext.title || pageContext.url}</span>
            <button className="mini-btn" onClick={() => setPageContext(null)} title="إزالة السياق">✕</button>
          </div>
        )}

        {attachment && (
          <div className="attachment-chip">
            {attachment.preview ? (
              <img className="attachment-thumb" src={attachment.preview} alt="" />
            ) : (
              <span>📎</span>
            )}
            <span className="truncate grow">{attachment.name}</span>
            <button className="mini-btn" onClick={() => setAttachment(null)} title="إزالة المرفق">✕</button>
          </div>
        )}

        <div className="composer-row">
          <textarea
            ref={composerRef}
            className="textarea grow"
            rows={2}
            placeholder="اكتبي رسالة لآية… (Ctrl+V للصق صورة، Enter للإرسال)"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            onPaste={(event) => {
              const item = [...(event.clipboardData?.items ?? [])].find((entry) => entry.type.startsWith('image/'));
              const file = item?.getAsFile();
              if (file) {
                event.preventDefault();
                uploadFile(file);
              }
            }}
          />
          {streaming ? (
            <button className="btn btn-ghost" onClick={stop} title="إيقاف">⏹ إيقاف</button>
          ) : (
            <button className="btn btn-primary" onClick={send} disabled={!input.trim() && !attachment}>إرسال</button>
          )}
        </div>
      </section>
    </>
  );
}
