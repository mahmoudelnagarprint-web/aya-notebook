import { useLanguage } from '@ayatodoist/plugin-sdk/react';
import { Icon, Modal } from '@ayatodoist/plugin-sdk/ui';

const SHORTCUTS = [
  { keys: ['Ctrl', 'K'], ar: 'لوحة الأوامر', en: 'Command palette' },
  { keys: ['Q'], ar: 'إضافة مهمة سريعة', en: 'Quick add task' },
  { keys: ['?'], ar: 'اختصارات لوحة المفاتيح', en: 'Keyboard shortcuts' },
  { keys: ['Enter'], ar: 'حفظ / إضافة في الحقول', en: 'Save / add inside fields' },
  { keys: ['Esc'], ar: 'إغلاق النوافذ', en: 'Close overlays' },
  { keys: ['Ctrl', 'V'], ar: 'لصق صورة في محادثة آية', en: 'Paste an image into Aya chat' },
];

export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const language = useLanguage();
  return (
    <Modal open={open} onClose={onClose} title={language === 'ar' ? 'اختصارات لوحة المفاتيح' : 'Keyboard shortcuts'} icon="keyboard" width={480}>
      <ul className="divide-y divide-[#eef2f7] dark:divide-slate-800">
        {SHORTCUTS.map((shortcut) => (
          <li key={shortcut.ar} className="flex items-center justify-between gap-3 py-2.5">
            <span className="flex items-center gap-2 text-[12.5px] text-slate-600 dark:text-slate-300">
              <Icon name="keyboard" size={14} className="text-slate-400" />
              {language === 'ar' ? shortcut.ar : shortcut.en}
            </span>
            <span className="flex items-center gap-1">
              {shortcut.keys.map((key) => (
                <kbd key={key} className="rounded-[5px] border border-[#e2e8f0] bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {key}
                </kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
