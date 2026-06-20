import { useEffect, useRef, useState } from 'react';
import type { SearchResult } from '../../domain/result.js';

export interface UseSelectionState {
  selectedIndex: number;
  selectedResult: SearchResult | null;
  movePrevious: () => void;
  moveNext: () => void;
  setSelectedIndex: (index: number) => void;
}

export function useSelection(results: readonly SearchResult[]): UseSelectionState {
  const [selectedIndex, setSelectedIndexState] = useState(0);
  const selectedUidRef = useRef<string | null>(null);

  useEffect(() => {
    selectedUidRef.current = results[selectedIndex]?.uid ?? null;
  }, [results, selectedIndex]);

  useEffect(() => {
    if (results.length === 0) {
      setSelectedIndexState(0);
      return;
    }

    if (selectedUidRef.current) {
      const nextIndex = results.findIndex((result) => result.uid === selectedUidRef.current);
      if (nextIndex >= 0) {
        setSelectedIndexState(nextIndex);
        return;
      }
    }

    setSelectedIndexState((current: number) => clampIndex(current, results.length));
  }, [results]);

  return {
    selectedIndex,
    selectedResult: results[selectedIndex] ?? null,
    movePrevious: () => setSelectedIndexState((current: number) => clampIndex(current - 1, results.length)),
    moveNext: () => setSelectedIndexState((current: number) => clampIndex(current + 1, results.length)),
    setSelectedIndex: (index) => setSelectedIndexState(clampIndex(index, results.length)),
  };
}

function clampIndex(index: number, size: number): number {
  if (size <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(index, size - 1));
}
