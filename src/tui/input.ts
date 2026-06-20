export interface EditableInputState {
  value: string;
  cursor: number;
}

const RAW_BACKSPACE_INPUTS = new Set(['\b', '\u007f']);
const RAW_WORD_DELETE_INPUTS = new Set(['\u001b\u007f', '\u001b\b']);
const RAW_FORWARD_DELETE_INPUTS = new Set(['\u001b[3~']);

export interface EditableInputKey {
  input: string;
  key: {
    leftArrow?: boolean;
    rightArrow?: boolean;
    upArrow?: boolean;
    downArrow?: boolean;
    return?: boolean;
    backspace?: boolean;
    delete?: boolean;
    tab?: boolean;
    shift?: boolean;
    ctrl?: boolean;
    meta?: boolean;
    escape?: boolean;
    home?: boolean;
    end?: boolean;
  };
}

export function applyEditableInputEvent(
  state: EditableInputState,
  event: EditableInputKey,
): EditableInputState | null {
  const { value } = state;
  const cursor = clampCursor(state.cursor, value.length);
  const { input, key } = event;

  if (key.upArrow || key.downArrow || key.return || key.tab || key.escape) {
    return null;
  }

  if (key.home || (key.ctrl && input === 'a')) {
    return { value, cursor: 0 };
  }

  if (key.end || (key.ctrl && input === 'e')) {
    return { value, cursor: value.length };
  }

  if (key.leftArrow) {
    return {
      value,
      cursor: key.meta ? previousWordBoundary(value, cursor) : Math.max(0, cursor - 1),
    };
  }

  if (key.rightArrow) {
    return {
      value,
      cursor: key.meta ? nextWordBoundary(value, cursor) : Math.min(value.length, cursor + 1),
    };
  }

  const isRawBackspace = RAW_BACKSPACE_INPUTS.has(input);
  const isRawWordDelete = RAW_WORD_DELETE_INPUTS.has(input);
  const isRawForwardDelete = RAW_FORWARD_DELETE_INPUTS.has(input);
  const isNormalizedDeleteBackspace = key.delete && !key.meta;
  const isDeletePreviousWord = isRawWordDelete || (key.meta && (key.backspace || key.delete || isRawBackspace)) || (key.ctrl && input === 'w');
  const isBackspace = key.backspace || isNormalizedDeleteBackspace || (key.ctrl && input === 'h') || (!key.ctrl && !key.delete && isRawBackspace);
  if (isBackspace || isDeletePreviousWord) {
    if (isDeletePreviousWord) {
      const nextCursor = previousWordBoundary(value, cursor);
      return collapseDeletedGap(value, nextCursor, cursor);
    }

    if (cursor <= 0) {
      return state;
    }

    return {
      value: value.slice(0, cursor - 1) + value.slice(cursor),
      cursor: cursor - 1,
    };
  }

  // Ink reports the common terminal DEL byte (\u007f), which users press as
  // Backspace/Delete on many keyboards, as `key.delete` and strips the raw
  // input to ''. Treat the normalized `key.delete` as deleting the previous
  // character so Backspace works in the TUI. Forward delete remains available
  // via raw escape-sequence callers and Ctrl+D.
  const isForwardDelete = isRawForwardDelete || (key.ctrl && input === 'd');
  if (isForwardDelete) {
    if (cursor >= value.length) {
      return state;
    }

    return {
      value: value.slice(0, cursor) + value.slice(cursor + 1),
      cursor,
    };
  }

  if (key.ctrl && input === 'u') {
    return {
      value: value.slice(cursor),
      cursor: 0,
    };
  }

  if (key.ctrl && input === 'k') {
    return {
      value: value.slice(0, cursor),
      cursor,
    };
  }

  if (key.ctrl || key.meta) {
    return null;
  }

  if (input.length === 0) {
    return state;
  }

  return {
    value: value.slice(0, cursor) + input + value.slice(cursor),
    cursor: cursor + input.length,
  };
}

export function previousWordBoundary(value: string, cursor: number): number {
  let index = clampCursor(cursor, value.length);

  while (index > 0 && isWhitespace(value[index - 1]!)) {
    index -= 1;
  }

  while (index > 0 && !isWhitespace(value[index - 1]!)) {
    index -= 1;
  }

  return index;
}

export function nextWordBoundary(value: string, cursor: number): number {
  let index = clampCursor(cursor, value.length);

  while (index < value.length && isWhitespace(value[index]!)) {
    index += 1;
  }

  while (index < value.length && !isWhitespace(value[index]!)) {
    index += 1;
  }

  return index;
}

export function clampCursor(cursor: number, length: number): number {
  return Math.max(0, Math.min(cursor, length));
}

function collapseDeletedGap(value: string, start: number, end: number): EditableInputState {
  const nextValue = value.slice(0, start) + value.slice(end);

  if (
    start > 0
    && start < nextValue.length
    && isWhitespace(nextValue[start - 1]!)
    && isWhitespace(nextValue[start]!)
  ) {
    return {
      value: nextValue.slice(0, start) + nextValue.slice(start + 1),
      cursor: start,
    };
  }

  return {
    value: nextValue,
    cursor: start,
  };
}

function isWhitespace(character: string): boolean {
  return /\s/.test(character);
}
