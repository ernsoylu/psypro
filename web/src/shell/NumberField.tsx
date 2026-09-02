/**
 * A numeric text field that lets you finish typing before it is believed.
 *
 * Every numeric input in this app used to be bound straight to the stored
 * number: `value={x.toFixed(2)}` with `onChange={... Number(e.target.value)}`.
 * That re-formats the field on every keystroke, so typing `35` goes
 * `3` → store `3` → field `"3.00"` → the `5` lands after the decimals and the
 * digit the user meant is gone. The same shape eats the decimal point in the
 * `String(value)` fields: `3.` parses to `3`, re-renders as `"3"`, and `3.5`
 * comes out `35`.
 *
 * So the field keeps a **draft string while it has focus**, and that draft — not
 * the store — is what the user sees. The store is written from the draft, and
 * only the store's own formatting comes back once focus leaves. Two rules make
 * that safe:
 *
 * * While focused, nothing external overwrites the text. A drag on the chart
 *   cannot happen without blurring the field first, so this costs nothing.
 * * The value is committed on a short delay (500 ms by default), and
 *   immediately on blur, Enter, or Tab. Half-typed numbers — `""`, `"-"`, `"."`
 *   — are never committed at all, so the chart does not pin a marker at 0 °C
 *   on the way to −5.
 *
 * The delay is not a workaround for the draft: it is what keeps the marker,
 * the derived table and every downstream engine call off the per-keystroke
 * path, which is the same reason the drag path is kept allocation-light.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** How long typing must pause before the value reaches the store. */
export const COMMIT_DELAY_MS = 500;

/**
 * The number a draft string means, or `null` when it does not mean one yet.
 *
 * `Number('')` is `0` and `Number('-')` is `NaN`, and both of those reaching a
 * store are the bug this guard exists for: an empty field is a field being
 * cleared, not a request to move the point to zero.
 */
export function parseDraft(text: string): number | null {
  const trimmed = text.trim();
  // Empty, a lone sign, a lone point, or a sign and a point: still being typed.
  if (/^[+-]?\.?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** What a numeric field needs to render and to report. */
export interface NumberFieldProps {
  /** The stored value, in the document's unit system. */
  value: number;
  /** Writes a new value back. Called on a pause in typing, and on blur. */
  onCommit: (value: number) => void;
  /** How a stored value is shown when the field is not being typed into. */
  format?: (value: number) => string;
  /** Pause before a committed value reaches the store. */
  commitDelayMs?: number;
  /** Class for the input element. */
  className?: string;
  /** Accessible name, when the surrounding label does not supply one. */
  'aria-label'?: string;
  /** Element id, for a `<label for>` that is not an ancestor. */
  id?: string;
  /** Whether the field refuses edits. */
  disabled?: boolean;
}

export function NumberField({
  value,
  onCommit,
  format = String,
  commitDelayMs = COMMIT_DELAY_MS,
  className,
  disabled,
  id,
  'aria-label': ariaLabel,
}: NumberFieldProps) {
  // `null` means "show the stored value"; a string means "the user is typing".
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // A value arriving from elsewhere — a drag, a unit switch, a file open, a
  // different point selected — replaces the text, but never while the user is
  // mid-number in this very field.
  useEffect(() => {
    if (input.current !== null && document.activeElement === input.current) return;
    setDraft(null);
  }, [value]);

  useEffect(() => cancel, [cancel]);

  const commit = useCallback(
    (text: string) => {
      const parsed = parseDraft(text);
      if (parsed !== null && parsed !== value) onCommit(parsed);
    },
    [onCommit, value],
  );

  return (
    <input
      ref={input}
      id={id}
      className={className}
      aria-label={ariaLabel}
      disabled={disabled}
      inputMode="decimal"
      value={draft ?? format(value)}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        cancel();
        if (parseDraft(text) === null) return;
        timer.current = setTimeout(() => {
          timer.current = null;
          commit(text);
        }, commitDelayMs);
      }}
      onBlur={() => {
        cancel();
        if (draft !== null) commit(draft);
        // Back to the store's own formatting, including when the draft was
        // never a number: an abandoned field shows what is actually stored.
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          cancel();
          if (draft !== null) commit(draft);
          setDraft(null);
        } else if (e.key === 'Escape') {
          cancel();
          setDraft(null);
        }
      }}
    />
  );
}
