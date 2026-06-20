import { describe, expect, it } from 'vitest';
import { applyEditableInputEvent, nextWordBoundary, previousWordBoundary } from './input.js';

describe('word boundaries', () => {
  it('finds the previous word boundary', () => {
    expect(previousWordBoundary('voyage embeddings here', 18)).toBe(7);
  });

  it('finds the next word boundary', () => {
    expect(nextWordBoundary('voyage embeddings here', 0)).toBe(6);
    expect(nextWordBoundary('voyage embeddings here', 7)).toBe(17);
  });
});

describe('applyEditableInputEvent', () => {
  it('inserts text at the cursor', () => {
    expect(applyEditableInputEvent(
      { value: 'voyage embd', cursor: 10 },
      { input: 'e', key: {} },
    )).toEqual({ value: 'voyage embed', cursor: 11 });
  });

  it('deletes the previous word on meta-backspace', () => {
    expect(applyEditableInputEvent(
      { value: 'voyage embeddings here', cursor: 17 },
      { input: '', key: { backspace: true, meta: true } },
    )).toEqual({ value: 'voyage here', cursor: 7 });
  });

  it('deletes to the start on ctrl+u', () => {
    expect(applyEditableInputEvent(
      { value: 'voyage embeddings', cursor: 7 },
      { input: 'u', key: { ctrl: true } },
    )).toEqual({ value: 'embeddings', cursor: 0 });
  });

  it('moves by word on meta arrows', () => {
    expect(applyEditableInputEvent(
      { value: 'voyage embeddings here', cursor: 17 },
      { input: '', key: { leftArrow: true, meta: true } },
    )).toEqual({ value: 'voyage embeddings here', cursor: 7 });
  });

  it('treats ctrl+h as backspace for terminals that send DEL that way', () => {
    expect(applyEditableInputEvent(
      { value: 'voyage', cursor: 6 },
      { input: 'h', key: { ctrl: true } },
    )).toEqual({ value: 'voyag', cursor: 5 });
  });

  it('treats ctrl+d as forward delete for terminals that send it that way', () => {
    expect(applyEditableInputEvent(
      { value: 'voyage', cursor: 2 },
      { input: 'd', key: { ctrl: true } },
    )).toEqual({ value: 'voage', cursor: 2 });
  });

  it('treats Ink normalized delete as backspace because common terminal backspace sends DEL', () => {
    expect(applyEditableInputEvent(
      { value: 'voyage', cursor: 6 },
      { input: '', key: { delete: true } },
    )).toEqual({ value: 'voyag', cursor: 5 });
  });

  it('deletes spaces with Ink normalized delete/backspace', () => {
    expect(applyEditableInputEvent(
      { value: 'voyage ', cursor: 7 },
      { input: '', key: { delete: true } },
    )).toEqual({ value: 'voyage', cursor: 6 });
  });

  it('treats option+delete as delete-previous-word when reported as meta+delete', () => {
    expect(applyEditableInputEvent(
      { value: 'voyage embeddings here', cursor: 17 },
      { input: '', key: { meta: true, delete: true } },
    )).toEqual({ value: 'voyage here', cursor: 7 });
  });

  it('treats option+delete as delete-previous-word when reported as meta+raw-backspace', () => {
    expect(applyEditableInputEvent(
      { value: 'voyage embeddings here', cursor: 17 },
      { input: '\u007f', key: { meta: true } },
    )).toEqual({ value: 'voyage here', cursor: 7 });
  });

  it('treats option+delete as delete-previous-word when reported as raw escape+backspace', () => {
    expect(applyEditableInputEvent(
      { value: 'voyage embeddings here', cursor: 17 },
      { input: '\u001b\u007f', key: {} },
    )).toEqual({ value: 'voyage here', cursor: 7 });
  });

  it('treats delete key as forward delete when reported as raw escape sequence', () => {
    expect(applyEditableInputEvent(
      { value: 'voyage', cursor: 2 },
      { input: '\u001b[3~', key: {} },
    )).toEqual({ value: 'voage', cursor: 2 });
  });
});
