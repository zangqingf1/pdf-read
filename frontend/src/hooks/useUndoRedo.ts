import { useRef, useState, useCallback } from 'react';
import type { ParagraphData } from '../components/review/EditableParagraph';

// ── Types ───────────────────────────────────────────────────────────

interface UndoableSnapshot {
  paragraphs: ParagraphData[];
  dirtyIndices: number[];
}

const DEFAULT_MAX_HISTORY = 50;

// ── Hook ────────────────────────────────────────────────────────────

export function useUndoRedo(maxHistory: number = DEFAULT_MAX_HISTORY) {
  const pastRef = useRef<UndoableSnapshot[]>([]);
  const presentRef = useRef<UndoableSnapshot | null>(null);
  const futureRef = useRef<UndoableSnapshot[]>([]);

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const updateFlags = useCallback(() => {
    setCanUndo(pastRef.current.length > 0);
    setCanRedo(futureRef.current.length > 0);
  }, []);

  /**
   * Save a snapshot as the new present state. Called AFTER state changes.
   * Deduplicates: if the new snapshot is structurally identical to current
   * present, the call is silently ignored.
   */
  const pushSnapshot = useCallback(
    (paragraphs: ParagraphData[], dirtySet: Set<number>) => {
      const dirtyArr = Array.from(dirtySet).sort();

      // Build a quick fingerprint — avoid pushing a duplicate present
      if (presentRef.current) {
        const p = presentRef.current;
        const sameDirty =
          p.dirtyIndices.length === dirtyArr.length &&
          p.dirtyIndices.every((v, i) => v === dirtyArr[i]);
        if (sameDirty && p.paragraphs.length === paragraphs.length) {
          const allSame = p.paragraphs.every(
            (pp, i) =>
              pp.index === paragraphs[i].index &&
              pp.text_en === paragraphs[i].text_en &&
              pp.page_number === paragraphs[i].page_number,
          );
          if (allSame) return; // identical to current present — skip
        }
      }

      const snapshot: UndoableSnapshot = {
        paragraphs: paragraphs.map((p) => ({ ...p })), // shallow-clone each paragraph
        dirtyIndices: dirtyArr,
      };

      // Archive previous present → past
      if (presentRef.current) {
        pastRef.current.push(presentRef.current);
        if (pastRef.current.length > maxHistory) {
          pastRef.current.shift(); // drop oldest
        }
      }

      presentRef.current = snapshot;
      futureRef.current = []; // new action invalidates redo stack
      updateFlags();
    },
    [maxHistory, updateFlags],
  );

  /** Navigate back one step. Returns the restored snapshot, or null. */
  const undo = useCallback((): UndoableSnapshot | null => {
    if (pastRef.current.length === 0) return null;

    // Move present → future
    if (presentRef.current) {
      futureRef.current.push(presentRef.current);
    }

    // Pop past → present
    const prev = pastRef.current.pop()!;
    presentRef.current = prev;
    updateFlags();
    return prev;
  }, [updateFlags]);

  /** Navigate forward one step. Returns the restored snapshot, or null. */
  const redo = useCallback((): UndoableSnapshot | null => {
    if (futureRef.current.length === 0) return null;

    // Move present → past
    if (presentRef.current) {
      pastRef.current.push(presentRef.current);
    }

    // Pop future → present
    const next = futureRef.current.pop()!;
    presentRef.current = next;
    updateFlags();
    return next;
  }, [updateFlags]);

  /** Reset all history (e.g., after save, on unmount). */
  const clearHistory = useCallback(() => {
    pastRef.current = [];
    presentRef.current = null;
    futureRef.current = [];
    updateFlags();
  }, [updateFlags]);

  return { pushSnapshot, undo, redo, canUndo, canRedo, clearHistory };
}
