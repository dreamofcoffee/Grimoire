import '@/providers';

import { EditorState } from '@codemirror/state';

import { InlineEditModal } from '@/features/inline-edit/ui/InlineEditModal';
import * as editorUtils from '@/utils/editor';

test.each([
  { change: { from: 0, insert: 'NEW ' }, expected: 'NEW prefix REPLACEMENT suffix', decision: 'accept' },
  { change: { from: 8, to: 9, insert: '!' }, expected: 'prefix T!RGET suffix', decision: 'reject' },
  { change: { from: 0, to: 20, insert: 'short' }, expected: 'short', decision: 'reject' },
  { change: { from: 0, insert: 'NEW\n' }, expected: 'NEW\nprefix REPLACEMENT suffix', decision: 'accept', beforeDiff: true },
  { change: { from: 8, to: 9, insert: '!' }, expected: 'prefix T!RGET suffix', decision: 'reject', beforeDiff: true },
  { change: { from: 7, insert: 'ADDED ' }, expected: 'prefix ADDED REPLACEMENT suffix', decision: 'accept' },
  { change: { from: 13, insert: ' ADDED' }, expected: 'prefix REPLACEMENT ADDED suffix', decision: 'accept' },
])('applies only to a valid mapped range: $expected', async ({ change, expected, decision, beforeDiff }) => {
  const ownerDocument = { addEventListener: jest.fn(), removeEventListener: jest.fn() };
  const editorView = {
    state: EditorState.create({ doc: 'prefix TARGET suffix' }),
    dom: { ownerDocument, addEventListener: jest.fn(), removeEventListener: jest.fn() },
    dispatch(transaction: any) { this.state = this.state.update(transaction).state; },
  };
  const editor = {
    getCursor: (side: string) => ({ line: 0, ch: side === 'from' ? 7 : 13 }),
    getSelection: () => 'TARGET',
    replaceRange: jest.fn((text, from, to) => {
      const doc = editorView.state.doc;
      editorView.dispatch({ changes: {
        from: doc.line(from.line + 1).from + from.ch,
        to: doc.line(to.line + 1).from + to.ch,
        insert: text,
      } });
    }),
  };
  const plugin = {
    getApplicationRuntimeOrNull: () => null,
    settings: { hiddenProviderCommands: {} },
  };
  const app = { vault: { getFiles: () => [], getAllLoadedFiles: () => [] } };
  const spy = jest.spyOn(editorUtils, 'getEditorView').mockReturnValue(editorView as never);
  const modal = new InlineEditModal(app as never, plugin as never, editor as never,
    { editor } as never, { mode: 'selection', selectedText: 'TARGET' }, 'note.md');
  try {
    const completed = modal.openAndWait();
    const controller = (modal as any).controller;
    if (beforeDiff) editorView.dispatch({ changes: change });
    controller.editedText = 'REPLACEMENT';
    controller.showDiffInPlace();
    if (!beforeDiff) editorView.dispatch({ changes: change });
    controller.accept();
    controller.accept();
    await expect(completed).resolves.toMatchObject({ decision });
    expect(editorView.state.doc.toString()).toBe(expected);
  } finally {
    (modal as any).controller?.reject();
    spy.mockRestore();
  }
});
