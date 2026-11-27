/**
 * Native Side Panel app.
 * Mirrors the same floating-drawer logic but docked inside Chrome/Edge's side panel.
 */

import { useEffect, useRef, useState } from 'react';
import { ayaServer } from '../lib/server';

export default function SidePanel() {
  const [config, setConfig] = useState<any>(null);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [chips, setChips] = useState<Array<{ name: string; state: 'running' | 'done' | 'fail' }>>([]);
  const [modelId, setModelId] = useState('auto');
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const send = async () => {
    const text = composerRef.current?.value.trim();
    if (!text && !pendingFile) return;
    setStreaming(true);
    setStreamText('⏳ جاري التفكير…');
    setChips([]);
    const payload: any = {
      conversationId: null,
      text,
      language: 'ar',
      modelId,
      attachments: pendingFile ? [{ kind: 'image', file: pendingFile }] : [],
    };
    composerRef.current!.value = '';
    setPendingFile(null);

    composerRef.current!.value = '';
    setPendingFile(null);

    const stream = ayaServer.chatStream(payload);
    const reader = stream.getReader();
    setChips([]);
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const { event, data } = value;
          if (event === 'delta' && data?.text) {
            setStreamText((prev) => prev + data.text);
          } else if (event === 'tool_start') {
            setChips((prev) => [...prev, { name: data.name, state: 'running' }]);
          } else if (event === 'tool_result') {
            setChips((prev) => prev.map((c) => c.name === data.name ? { ...c, state: data.ok ? 'done' : 'fail' } : c));
          } else if (event === 'done') {
            setStreamText((prev) => prev + (data?.text || ''));
          } else if (event === 'error') {
            setStreamText(`خطأ: ${data?.message || 'غير متوقع'}`);
          }
        }
      } catch (err) {
        setStreamText(`اتصال فشل: ${err}`);
      } finally {
        setStreaming(false);
      }
    })();
  };

  const attachFile = (file: File) => setPendingFile(file);

  return (
    <div style={{ width: 420, maxWidth: '100vw', background: '#242424', color: '#fbfbfb', fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Tahoma, sans-serif', display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #323232', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: 'linear-gradient(135deg,#de4c4a,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 11 }}>آ</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>بار آية · اللوحة الجانبية</div>
            <div style={{ fontSize: 10, color: config?.baseUrl ? '#8b5cf6' : '#ff8a82' }}>
              {config?.baseUrl || 'غير مضبوط'} {config?.token ? '· مع token' : ''}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <span style={{ fontSize: 10, color: '#9a9a9a' }}>الموديل:</span>
          <select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            style={{ background: '#1e1e1e', color: '#fbfbfb', border: '1px solid #323232', borderRadius: 8, padding: '3px 6px', fontSize: 11 }}
          >
            <option value="auto">تلقائي</option>
            <option value="models/gemini-3-flash-preview">Gemini Flash</option>
            <option value="ddd/zai-org/GLM-5.3-Flash">GLM-5.3 Flash</option>
          </select>
        </div>
      </div>

      {/* Stream area */}
      <div style={{ padding: '10px 12px', flex: 1, overflow: 'auto', fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {streamText || <span style={{ color: '#9a9a9a' }}>_bar docked,ready for Alt+A in any tab.</span>}
      </div>

      {/* Chips */}
      {chips.length > 0 && (
        <div style={{ padding: '0 12px 8px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {chips.map((c) => (
            <span key={c.name} style={{ padding: '2px 8px', borderRadius: 8, fontSize: 11, background: c.state === 'running' ? 'rgba(222,76,74,0.15)' : c.state === 'done' ? 'rgba(139,92,246,0.18)' : 'rgba(222,76,74,0.15)', border: '1px solid ' + (c.state === 'running' ? '#8b5cf6' : c.state === 'done' ? '#8b5cf6' : '#de4c4a'), color: c.state === 'running' ? '#8b5cf6' : c.state === 'done' ? '#c7b3ff' : '#ff8a82' }}>
              {c.state === 'running' ? '⏳' : c.state === 'done' ? '✅' : '❌'} {c.name}
            </span>
          ))}
        </div>
      )}

      {/* Composer */}
      <div style={{ padding: '8px 12px 10px', borderTop: '1px solid #323232', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <textarea
            ref={composerRef}
            placeholder="اكتبي رسالة لآية… (أو أرفعي صورة)"
            style={{ width: '100%', background: '#1e1e1e', color: '#fbfbfb', border: '1px solid #323232', borderRadius: 9, padding: '7px 9px', fontSize: 12, resize: 'none', minHeight: 40 }}
            rows={2}
          />
        </div>
        <button
          style={streaming ? { opacity: .5 } : { background: '#de4c4a', color: '#fff', border: 'none', borderRadius: 10, padding: '7px 12px', fontSize: 12, fontWeight: 600, cursor: streaming ? 'not-allowed' : 'pointer' }}
          onClick={send}
          disabled={streaming}
        >
          {streaming ? 'جاري…' : 'إرسال'}
        </button>
        <button
          style={{ background: '#3a3a3a', color: '#fbfbfb', border: 'none', borderRadius: 10, padding: '7px 9px', fontSize: 14, cursor: 'pointer' }}
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/png,image/jpeg,image/webp,image/gif';
            input.click();
            input.addEventListener('change', async () => {
              const file = input.files?.[0];
              if (file) attachFile(file);
            });
          }}
        >
          🖼️
        </button>
      </div>
    </div>
  );
}
