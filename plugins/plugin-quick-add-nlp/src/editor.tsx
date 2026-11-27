import { useEffect, useRef } from 'react';
import { Extension } from '@tiptap/core';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { NlpSpan } from './parser';

export interface NlpDecorationStore {
  spans: NlpSpan[];
  onEscape?: (span: NlpSpan) => void;
}

/**
 * Inline highlighting of parsed tokens + click-to-escape.
 *
 * The store is read through a function: Tiptap deep-merges extension options,
 * so a plain object passed via `configure()` is a detached copy and would never
 * see later updates.
 */
export const NlpHighlight = Extension.create<{ readStore: () => NlpDecorationStore }>({
  name: 'nlpHighlight',
  addOptions() {
    return { readStore: () => ({ spans: [] }) };
  },
  addProseMirrorPlugins() {
    const readStore = this.options.readStore;
    return [
      new Plugin({
        key: new PluginKey('nlpHighlight'),
        props: {
          decorations(state) {
            const store = readStore();
            if (!store.spans.length) return null;
            const positions: number[] = [];
            state.doc.descendants((node, pos) => {
              if (node.isText && node.text) {
                for (let index = 0; index < node.text.length; index += 1) positions.push(pos + index);
              }
              return true;
            });
            const decorations: Decoration[] = [];
            for (const span of store.spans) {
              if (span.type === 'priority' && span.active === false) continue;
              const start = positions[span.start];
              const end = positions[span.end - 1];
              if (start === undefined || end === undefined) continue;
              decorations.push(
                Decoration.inline(start, end + 1, {
                  class: 'nlp-pill',
                  'data-nlp-type': span.type,
                  'data-nlp-value': span.value,
                }),
              );
            }
            return decorations.length ? DecorationSet.create(state.doc, decorations) : null;
          },
          handleClick(view, pos) {
            const store = readStore();
            const offset = Math.max(0, pos - 1);
            const span = store.spans.find(
              (candidate) => offset >= candidate.start && offset <= candidate.end && candidate.type !== 'priority',
            );
            if (!span || !store.onEscape) return false;
            store.onEscape(span);
            return true;
          },
        },
      }),
    ];
  },
});

export interface QuickAddEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onEscapePress: () => void;
  spans: NlpSpan[];
  onEscapeSpan: (span: NlpSpan) => void;
  placeholder: string;
  autoFocus?: boolean;
}

export function QuickAddEditor({ value, onChange, onSubmit, onEscapePress, spans, onEscapeSpan, placeholder, autoFocus }: QuickAddEditorProps) {
  const storeRef = useRef<NlpDecorationStore>({ spans: [] });
  const submitRef = useRef(onSubmit);
  const escapeRef = useRef(onEscapePress);
  submitRef.current = onSubmit;
  escapeRef.current = onEscapePress;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        bold: false,
        italic: false,
        strike: false,
        dropcursor: false,
        gapcursor: false,
      }),
      NlpHighlight.configure({ readStore: () => storeRef.current }),
    ],
    editorProps: {
      attributes: {
        class: 'quick-add-editor focus:outline-none',
        'aria-label': placeholder,
        'data-placeholder': placeholder,
      },
      handleKeyDown(view, event) {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          submitRef.current();
          return true;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          escapeRef.current();
          return true;
        }
        return false;
      },
    },
    content: value,
    onUpdate({ editor: instance }) {
      onChange(instance.getText());
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (editor.getText() !== value && value === '') editor.commands.clearContent();
  }, [editor, value]);

  useEffect(() => {
    storeRef.current.spans = spans;
    storeRef.current.onEscape = onEscapeSpan;
    if (editor && !editor.isDestroyed) {
      editor.view.dispatch(editor.state.tr.setMeta('nlp-refresh', Date.now()));
    }
  }, [editor, spans, onEscapeSpan]);

  useEffect(() => {
    if (autoFocus && editor) {
      const timer = window.setTimeout(() => editor.commands.focus('end'), 40);
      return () => window.clearTimeout(timer);
    }
  }, [autoFocus, editor]);

  return <EditorContent editor={editor} />;
}

export type { Editor };
