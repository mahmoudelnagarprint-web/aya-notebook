import type { PluginDescriptor } from '@ayatodoist/core-kernel';

export {
  parseQuickAdd,
  parseDatePhrase,
  parseRecurrencePhrase,
  parseTimeOnly,
  emptyContext,
  type ParsedTask,
  type NlpContext,
  type NlpSpan,
  type NlpReminder,
} from './parser';

export const quickAddNlpPlugin: PluginDescriptor = {
  id: 'quick-add-nlp',
  name: 'Quick add NLP',
  nameAr: 'الإضافة السريعة',
  version: '0.1.0',
  description: 'Zero-network Arabic + English natural-language quick add.',
  descriptionAr: 'إضافة سريعة بالعربية والإنجليزية بدون إنترنت.',
  capabilities: ['Arabic dates & times', 'Priority / project / label pills', 'Recurrence, deadlines, durations'],
  defaultEnabled: true,
  commands: [],
};

export function quickAddNlpLabel(_label: any): void {}
export function quickAddNlpInput(_input: any): void {}
export function quickAddNlpCtx(_ctx: any): void {}
