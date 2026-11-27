import { QuickAddModal } from '@ayatodoist/plugin-quick-add-nlp/ui';

/**
 * Shell-level quick add window. The NLP editor and parser live in the
 * quick-add-nlp plugin; the shell only owns when the window is open.
 */
export function QuickAddWindow({
  open,
  initialText,
  defaultProjectId,
  onClose,
}: {
  open: boolean;
  initialText?: string;
  defaultProjectId?: string | null;
  onClose: () => void;
}) {
  return <QuickAddModal open={open} initialText={initialText} defaultProjectId={defaultProjectId} onClose={onClose} />;
}
