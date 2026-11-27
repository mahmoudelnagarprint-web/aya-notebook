import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AyaAttachment, AyaConversation, AyaModel, AyaPublicConfig } from '@ayatodoist/shared-types';
import { useLanguage } from '@ayatodoist/plugin-sdk/react';
import { Button, Drawer, Icon, Select, TextField, cn } from '@ayatodoist/plugin-sdk/ui';
import { AyaApiError, ayaApi } from '../aya-client';

interface ToolChip {
  name: string;
  state: 'running' | 'ok' | 'failed';
  summary?: string;
}

interface ChatEntry {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  tools: ToolChip[];
  model?: string | null;
  batchId?: string | null;
  attachments?: AyaAttachment[];
}

let counter = 0;
const nextId = () => `local-${Date.now()}-${counter++}`;

function toolLabel(name: string): string {
  const map: Record<string, string> = {
    'task.create': 'إنشاء مهمة',
    'task.update': 'تعديل مهمة',
    'task.complete': 'إكمال مهمة',
    'task.delete': 'حذف مهمة',
    'project.create': 'مشروع جديد',
    'checklist.addItem': 'إضافة بند',
  };
  return map[name] ?? name;
}

/**
 * Aya chat drawer (left side): SSE streaming with live tool chips, stop button,
 * model switcher, conversation switching, image paste/upload and batch undo.
 *
 * Every network call goes through `ayaApi`; if the API is not reachable the
 * drawer says so plainly instead of pretending to be online.
 */
export function AyaChatDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const language = useLanguage();
  const [config, setConfig] = useState<AyaPublicConfig | null>(null);
  const [conversations, setConversations] = useState<AyaConversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [modelId, setModelId] = useState('auto');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<AyaAttachment[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const models = useMemo(() => {
    if (!config) return [] as Array<AyaModel & { providerName: string }>;
    return config.providers.flatMap((provider) =>
      provider.models.map((model) => ({ ...model, providerName: provider.name })),
    );
  }, [config]);

  const loadConfig = useCallback(async () => {
    try {
      const next = await ayaApi.config();
      setConfig(next);
      setError(null);
    } catch (cause) {
      setConfig(null);
      setError(cause instanceof AyaApiError ? cause.message : (cause as Error).message);
    }
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const result = await ayaApi.conversations();
      setConversations(result.conversations);
    } catch {
      /* the banner already explains the outage */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadConfig();
    void loadConversations();
  }, [open, loadConfig, loadConversations]);

  useEffect(() => {
    if (!open || !conversationId) return;
    let cancelled = false;
    ayaApi
      .messages(conversationId)
      .then((result) => {
        if (cancelled) return;
        setMessages(
          result.messages.map((message) => ({
            id: message.id,
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: message.content,
            tools: message.toolCalls.map((tool) => ({ name: tool.name, state: 'ok' as const })),
            model: message.model,
            batchId: message.batchId,
            attachments: message.attachments,
          })),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, conversationId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setStreaming(true);
    setError(null);
    const userEntry: ChatEntry = { id: nextId(), role: 'user', content: text, tools: [], attachments };
    const assistantEntry: ChatEntry = { id: nextId(), role: 'assistant', content: '', tools: [] };
    setMessages((current) => [...current, userEntry, assistantEntry]);
    setInput('');
    const sentAttachments = attachments;
    setAttachments([]);
    const controller = new AbortController();
    abortRef.current = controller;

    const patchAssistant = (patch: (entry: ChatEntry) => ChatEntry) =>
      setMessages((current) =>
        current.map((entry) => (entry.id === assistantEntry.id ? patch(entry) : entry)),
      );

    try {
      let resolvedConversation = conversationId;
      await ayaApi.chatStream(
        {
          conversationId,
          text,
          language,
          modelId: modelId === 'auto' ? null : modelId,
          attachments: sentAttachments,
        },
        {
          signal: controller.signal,
          onMeta: (meta) => {
            if (meta.conversationId) {
              resolvedConversation = meta.conversationId;
              setConversationId(meta.conversationId);
            }
            patchAssistant((entry) => ({ ...entry, model: meta.model }));
          },
          onToolStart: (tool) =>
            patchAssistant((entry) => ({ ...entry, tools: [...entry.tools, { name: tool.name, state: 'running' }] })),
          onToolResult: (tool) =>
            patchAssistant((entry) => ({
              ...entry,
              tools: entry.tools.map((chip) =>
                chip.name === tool.name && chip.state === 'running'
                  ? { ...chip, state: tool.ok ? 'ok' : 'failed', summary: tool.summary }
                  : chip,
              ),
            })),
          onDelta: (chunk) => patchAssistant((entry) => ({ ...entry, content: entry.content + chunk })),
          onDone: (done) => {
            patchAssistant((entry) => ({ ...entry, batchId: done.batchId, model: done.model ?? entry.model }));
            if (resolvedConversation) void loadConversations();
          },
        },
      );
    } catch (cause) {
      if ((cause as Error).name === 'AbortError') {
        patchAssistant((entry) => ({ ...entry, content: entry.content || 'توقّف الرد بناءً على طلبك.' }));
      } else {
        const message = cause instanceof AyaApiError ? cause.message : (cause as Error).message;
        patchAssistant((entry) => ({ ...entry, role: 'error', content: message }));
        setError(message);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const uploadFile = async (file: File | null | undefined) => {
    if (!file) return;
    try {
      const uploaded = await ayaApi.upload(file);
      setAttachments((current) => [
        ...current,
        {
          kind: uploaded.kind,
          name: uploaded.filename,
          mime: uploaded.content_type,
          filename: uploaded.filename,
          url: uploaded.url,
          size: uploaded.size,
          text: uploaded.text,
        },
      ]);
    } catch (cause) {
      setError(cause instanceof AyaApiError ? cause.message : (cause as Error).message);
    }
  };

  const newConversation = () => {
    setConversationId(null);
    setMessages([]);
    setError(null);
  };

  const undoBatch = async (batchId: string) => {
    try {
      await ayaApi.undoBatch(batchId);
      setMessages((current) =>
        current.map((entry) => (entry.batchId === batchId ? { ...entry, batchId: null } : entry)),
      );
    } catch (cause) {
      setError(cause instanceof AyaApiError ? cause.message : (cause as Error).message);
    }
  };

  const offline = Boolean(error) && !config;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={language === 'ar' ? 'آية' : 'Aya'}
      subtitle={language === 'ar' ? 'وكيلتك الذكية — تعمل على مهامك مباشرة' : 'Your agent — works directly on your tasks'}
      icon="sparkles"
      width={440}
    >
      <div className="flex items-center gap-1.5 border-b border-[#eef2f7] bg-slate-50/80 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/60">
        <Select
          value={conversationId ?? ''}
          onChange={(event) => setConversationId(event.target.value || null)}
          aria-label={language === 'ar' ? 'المحادثات' : 'Conversations'}
          className="h-8 flex-1 text-[11.5px]"
        >
          <option value="">{language === 'ar' ? 'محادثة جديدة' : 'New conversation'}</option>
          {conversations.map((conversation) => (
            <option key={conversation.id} value={conversation.id}>
              {conversation.title || conversation.id.slice(0, 8)}
            </option>
          ))}
        </Select>
        <Button variant="soft" icon="plus" className="h-8 px-2 text-[11px]" onClick={newConversation}>
          {language === 'ar' ? 'جديدة' : 'New'}
        </Button>
      </div>

      <div className="flex items-center gap-2 border-b border-[#eef2f7] px-3 py-2 dark:border-slate-800">
        <span className={cn('flex h-2 w-2 rounded-full', offline ? 'bg-rose-500' : streaming ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500')} />
        <Select
          value={modelId}
          onChange={(event) => setModelId(event.target.value)}
          aria-label={language === 'ar' ? 'النموذج' : 'Model'}
          className="h-8 flex-1 text-[11.5px]"
        >
          <option value="auto">{language === 'ar' ? 'تلقائي — أفضل نموذج متاح' : 'Auto — best available model'}</option>
          {models.map((model) => (
            <option key={model.id} value={model.modelId}>
              {model.status === 'failed' ? '🔴' : '🟢'} {model.label} · {model.providerName}
              {model.latencyMs ? ` · ${model.latencyMs}ms` : ''}
            </option>
          ))}
        </Select>
      </div>

      {offline ? (
        <div className="m-3 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11.5px] leading-6 text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
          <p className="mb-1 flex items-center gap-1.5 font-bold">
            <Icon name="alert" size={13} />
            {language === 'ar' ? 'آية غير متصلة بالخادم' : 'Aya cannot reach the server'}
          </p>
          <p className="text-amber-700/90 dark:text-amber-200/80">
            {language === 'ar'
              ? 'شغّلي الخادم بالأمر bun run dev:server على المنفذ 8787، ثم أضيفي مزوّدًا من الإعدادات ← آية.'
              : 'Start the server with bun run dev:server on port 8787, then add a provider in Settings → Aya.'}
          </p>
          <button type="button" onClick={() => void loadConfig()} className="mt-2 rounded-[6px] bg-amber-600 px-2 py-1 text-[11px] font-semibold text-white">
            {language === 'ar' ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </div>
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50 text-violet-500 dark:bg-violet-500/15 dark:text-violet-300">
              <Icon name="sparkles" size={22} />
            </span>
            <p className="text-[13px] font-bold text-slate-700 dark:text-slate-200">{language === 'ar' ? 'كيف أقدر أساعدك؟' : 'How can I help?'}</p>
            <p className="text-[11.5px] leading-6 text-slate-500 dark:text-slate-400">
              {language === 'ar'
                ? 'اطلبي إنشاء مهام، ترتيب اليوم، تلخيص مشروع، أو قراءة صورة — كل أدوات التطبيق متاحة لي.'
                : 'Ask me to create tasks, plan your day, summarize a project, or read an image — every app tool is available.'}
            </p>
          </div>
        ) : null}

        {messages.map((entry) => (
          <div key={entry.id} className={cn('flex', entry.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[86%] rounded-[12px] px-3 py-2 text-[12.5px] leading-6',
                entry.role === 'user'
                  ? 'bg-[#1e78ff] text-white'
                  : entry.role === 'error'
                    ? 'border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-200'
                    : 'border border-[#e2e8f0] bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
              )}
            >
              {entry.content ? <p className="whitespace-pre-wrap">{entry.content}</p> : null}
              {entry.tools.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {entry.tools.map((tool, index) => (
                    <span
                      key={`${tool.name}-${index}`}
                      title={tool.summary}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                        tool.state === 'running'
                          ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300'
                          : tool.state === 'ok'
                            ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300'
                            : 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
                      )}
                    >
                      {tool.state === 'running' ? '⏳' : tool.state === 'ok' ? '✅' : '⚠️'} {toolLabel(tool.name)}
                    </span>
                  ))}
                </div>
              ) : null}
              {entry.model ? <p className="mt-1 text-[9.5px] opacity-60">{entry.model}</p> : null}
              {entry.batchId ? (
                <button
                  type="button"
                  onClick={() => void undoBatch(entry.batchId!)}
                  className="mt-1.5 inline-flex items-center gap-1 rounded-[6px] border border-current/20 px-1.5 py-0.5 text-[10px] font-semibold opacity-80 hover:opacity-100"
                >
                  <Icon name="undo" size={10} />
                  {language === 'ar' ? 'تراجع عن كل تغييرات هذه الجولة' : 'Undo this turn'}
                </button>
              ) : null}
              {entry.attachments && entry.attachments.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {entry.attachments.map((attachment) => (
                    <span key={attachment.name} className="rounded bg-black/10 px-1.5 py-0.5 text-[10px]">
                      {attachment.kind === 'image' ? '🖼️' : '📄'} {attachment.name}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {attachments.length > 0 ? (
        <div className="flex flex-wrap gap-1 border-t border-[#eef2f7] px-3 py-2 dark:border-slate-800">
          {attachments.map((attachment) => (
            <span key={attachment.name} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <Icon name={attachment.kind === 'image' ? 'image' : 'clipboard'} size={10} />
              {attachment.name}
              <button
                type="button"
                aria-label="إزالة المرفق"
                onClick={() => setAttachments((current) => current.filter((item) => item.name !== attachment.name))}
                className="text-slate-400 hover:text-rose-500"
              >
                <Icon name="close" size={9} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div
        className="border-t border-[#eef2f7] px-3 py-2.5 dark:border-slate-800"
        onPaste={(event) => {
          const image = Array.from(event.clipboardData.files).find((file) => file.type.startsWith('image/'));
          if (image) {
            event.preventDefault();
            void uploadFile(image);
          }
        }}
      >
        {error && !offline ? <p className="mb-1.5 text-[10.5px] text-rose-500">{error}</p> : null}
        <div className="flex items-end gap-1.5">
          <button
            type="button"
            aria-label={language === 'ar' ? 'إرفاق ملف' : 'Attach a file'}
            onClick={() => fileRef.current?.click()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
          >
            <Icon name="image" size={17} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf,.txt,.md,.json,.csv"
            className="hidden"
            onChange={(event) => {
              void uploadFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <TextField
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder={language === 'ar' ? 'اكتبي لآية… (Ctrl+V للصق صورة)' : 'Message Aya… (Ctrl+V to paste an image)'}
            className="min-w-0 flex-1"
            aria-label={language === 'ar' ? 'رسالة آية' : 'Message Aya'}
          />
          {streaming ? (
            <Button variant="danger" icon="close" className="h-9" onClick={() => abortRef.current?.abort()}>
              {language === 'ar' ? 'إيقاف' : 'Stop'}
            </Button>
          ) : (
            <Button variant="primary" icon="send" className="h-9" disabled={!input.trim()} onClick={() => void send()}>
              {language === 'ar' ? 'إرسال' : 'Send'}
            </Button>
          )}
        </div>
      </div>
    </Drawer>
  );
}
