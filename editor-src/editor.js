// NoteVault rich-text editor (Tiptap / ProseMirror), bundled into public/editor.js.
// Rebuild: see editor-src/README.md
import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Placeholder } from '@tiptap/extensions';
import Image from '@tiptap/extension-image';
import { common, createLowlight } from 'lowlight';

const lowlight = createLowlight(common);

// Tab inserts a real tab (like Notepad) except where Tab has a structural meaning.
const TabKey = Extension.create({
  name: 'tabKey',
  priority: 1,
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const e = this.editor;
        if (e.isActive('listItem') || e.isActive('taskItem') || e.isActive('table')) return false;
        return e.commands.insertContent('\t');
      },
      'Shift-Tab': () => {
        const e = this.editor;
        if (e.isActive('listItem') || e.isActive('taskItem') || e.isActive('table')) return false;
        return true; // don't move focus out of the editor
      },
    };
  },
});

// ---------- plain text -> document (for notes saved before rich text, imports, demo notes) ----------
const CODE_LINE = /^(\t| {2,})\S|[;{}]\s*$|,\s*$|^\s*["{[\]}]|^\s*(\/\/|\/\*|\*\/|#include|import\s|from\s\S+\simport|def\s|function\s|const\s|let\s|var\s|public\s|private\s|class\s|return\s|select\s|from\s|where\s|group by|having\s|order by|curl\s|git\s|get-|test-|list<|database\.|system\.|for\s*\(|if\s*\(|<\/?[a-z][\w-]*[\s>])/i;

function looksLikeCode(text) {
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return false;
  return lines.filter((l) => CODE_LINE.test(l)).length / lines.length >= 0.5;
}

const txt = (t) => (t ? [{ type: 'text', text: t }] : undefined);

export function plainToDoc(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const content = [];
  let i = 0;
  const listRun = (re, make) => {
    const items = [];
    while (i < lines.length && re.test(lines[i])) items.push(make(lines[i++].match(re)));
    return items;
  };
  while (i < lines.length) {
    const line = lines[i];
    // fenced code
    if (/^\s*```/.test(line)) {
      const lang = line.trim().slice(3).trim() || null;
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      content.push({ type: 'codeBlock', attrs: { language: lang }, content: txt(body.join('\n')) });
      continue;
    }
    // run of code-looking lines
    if (CODE_LINE.test(line) && i + 1 < lines.length && CODE_LINE.test(lines[i + 1])) {
      const body = [];
      while (i < lines.length && (CODE_LINE.test(lines[i]) || (lines[i].trim() === '' && i + 1 < lines.length && CODE_LINE.test(lines[i + 1])))) body.push(lines[i++]);
      content.push({ type: 'codeBlock', attrs: { language: null }, content: txt(body.join('\n')) });
      continue;
    }
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      content.push({ type: 'heading', attrs: { level: m[1].length }, content: txt(m[2]) });
      i++;
      continue;
    }
    const TASK = /^\s*[-*+]\s+\[([ xX])\]\s?(.*)$/;
    if (TASK.test(line)) {
      content.push({ type: 'taskList', content: listRun(TASK, (mm) => ({ type: 'taskItem', attrs: { checked: mm[1] !== ' ' }, content: [{ type: 'paragraph', content: txt(mm[2]) }] })) });
      continue;
    }
    const BULLET = /^\s*[-*+•]\s+(.*)$/;
    if (BULLET.test(line)) {
      content.push({ type: 'bulletList', content: listRun(BULLET, (mm) => ({ type: 'listItem', content: [{ type: 'paragraph', content: txt(mm[1]) }] })) });
      continue;
    }
    const NUM = /^\s*\d+[.)]\s+(.*)$/;
    if (NUM.test(line)) {
      content.push({ type: 'orderedList', content: listRun(NUM, (mm) => ({ type: 'listItem', content: [{ type: 'paragraph', content: txt(mm[1]) }] })) });
      continue;
    }
    content.push({ type: 'paragraph', content: txt(line) });
    i++;
  }
  if (!content.length) content.push({ type: 'paragraph' });
  return { type: 'doc', content };
}

// ---------- the editor ----------
const imageFiles = (list) => [...(list || [])].filter((f) => f.type.startsWith('image/'));

export function createEditor(element, { onUpdate, onSelection, onKeyDown, onBlur, placeholder, onImageFiles } = {}) {
  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https' },
      }),
      Highlight,
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false } }),
      CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
      TabKey,
      // Images are stored as files by the app (never as huge base64 inside the note) and can be resized by dragging.
      Image.configure({
        inline: false,
        allowBase64: false,
        resize: { enabled: true, directions: ['left', 'right', 'bottom-left', 'bottom-right'], minWidth: 60, minHeight: 40, alwaysPreserveAspectRatio: true },
      }),
      // Shown only on a completely empty note, so an open note stays clean.
      Placeholder.configure({ placeholder: ({ editor: e }) => (placeholder && e.isEmpty ? placeholder : '') }),
    ],
    editorProps: {
      attributes: { spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' },
      // Lets the app's menus (slash menu) take Enter / arrows / Escape before ProseMirror does.
      handleKeyDown: (view, event) => !!onKeyDown?.(event),
      // Code copied from an IDE or Notepad goes into a code block, keeping indentation.
      handlePaste(view, event) {
        const text = event.clipboardData?.getData('text/plain') || '';
        const html = event.clipboardData?.getData('text/html') || '';
        // A screenshot (Win+Shift+S) or a copied picture: hand the file to the app to store.
        const files = imageFiles(event.clipboardData?.files);
        if (files.length && onImageFiles && (!text.trim() || /^https?:\/\/\S+$/.test(text.trim()) || /<img/i.test(html))) {
          onImageFiles(files, null);
          return true;
        }
        if (editor.isActive('codeBlock') || !looksLikeCode(text)) return false;
        if (html && !/vscode|monaco|<pre|font-family:[^;"]*(consolas|cascadia|courier|monospace|menlo)/i.test(html)) return false;
        editor.chain().focus().insertContent({ type: 'codeBlock', attrs: { language: null }, content: txt(text.replace(/\r\n?/g, '\n').replace(/\n$/, '')) }).run();
        return true;
      },
      // Image files dragged in from Explorer land where they are dropped.
      handleDrop(view, event, slice, moved) {
        const files = imageFiles(event.dataTransfer?.files);
        if (moved || !files.length || !onImageFiles) return false;
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        onImageFiles(files, at ? at.pos : null);
        return true;
      },
      // Ctrl+click opens links.
      handleClick(view, pos, event) {
        const a = event.target.closest?.('a[href]');
        if (a && (event.ctrlKey || event.metaKey)) { window.open(a.href, '_blank'); return true; }
        return false;
      },
    },
    onUpdate: () => onUpdate?.(),
    onSelectionUpdate: () => onSelection?.(),
    onTransaction: () => onSelection?.(),
    onBlur: ({ event }) => onBlur?.(event),
  });

  const api = {
    tiptap: editor,
    getHTML: () => editor.getHTML(),
    getText: () => editor.getText({ blockSeparator: '\n' }),
    isEmpty: () => editor.isEmpty,
    setHTML: (html) => editor.commands.setContent(html, { emitUpdate: false }),
    setPlain: (text) => editor.commands.setContent(plainToDoc(text || ''), { emitUpdate: false }),
    clear: () => editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] }, { emitUpdate: false }),
    focus: (where) => editor.commands.focus(where ?? null),
    isActive: (name, attrs) => editor.isActive(name, attrs),
    can: () => editor.can(),
    chain: () => editor.chain().focus(),
    stats: () => {
      const t = editor.getText({ blockSeparator: '\n' });
      return { chars: t.length, words: (t.match(/\S+/g) || []).length };
    },
    // Select the first case-insensitive match of `term` and scroll to it.
    find(term) {
      const t = term.toLowerCase();
      let hit = null;
      editor.state.doc.descendants((node, pos) => {
        if (hit) return false;
        if (node.isText) {
          const i = node.text.toLowerCase().indexOf(t);
          if (i >= 0) hit = { from: pos + i, to: pos + i + term.length };
        }
        return true;
      });
      if (hit) editor.chain().focus().setTextSelection(hit).scrollIntoView().run();
      return !!hit;
    },
    linkAttrs: () => editor.getAttributes('link'),
    hasFocus: () => editor.view.hasFocus(),
    // Screen rectangle of the current selection (for the floating format bar).
    selectionRect() {
      const { from, to, empty } = editor.state.selection;
      const a = editor.view.coordsAtPos(from), b = editor.view.coordsAtPos(to, -1);
      return { empty, left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) };
    },
    caretRect() {
      const c = editor.view.coordsAtPos(editor.state.selection.from);
      return { left: c.left, top: c.top, bottom: c.bottom };
    },
    // "/query" typed at the start of an ordinary text line -> { query, from, to }
    slashQuery() {
      const { selection } = editor.state;
      if (!selection.empty) return null;
      const $p = selection.$from;
      if (!$p.parent.isTextblock || $p.parent.type.name === 'codeBlock') return null;
      const before = $p.parent.textBetween(0, $p.parentOffset, undefined, '￼');
      const m = before.match(/^\/([\w ]{0,20})$/);
      return m ? { query: m[1], from: $p.start(), to: selection.from } : null;
    },
    deleteRange: (from, to) => editor.chain().focus().deleteRange({ from, to }),
    // images: [{ src, alt }]; pos = drop position, or null for the cursor
    insertImages(images, pos) {
      // Each picture is followed by a fresh line, and the cursor lands there, so you keep typing *below* it.
      const nodes = images.map((i) => ({ type: 'image', attrs: { src: i.src, alt: i.alt || null } }));
      const { from, to } = editor.state.selection;
      editor.chain().focus().insertContentAt(pos ?? { from, to }, [...nodes, { type: 'paragraph' }], { updateSelection: true }).run();
    },
    selectionText() {
      const { from, to } = editor.state.selection;
      return editor.state.doc.textBetween(from, to, '\n');
    },
  };
  return api;
}

export { looksLikeCode };
