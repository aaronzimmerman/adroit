import { createContext, useContext } from 'react';
import type { ChangeOutcome, LedgerView } from '@adroit/shared';

export interface Ledger {
  view: LedgerView;
  /** Make a place current in both panels. */
  travel: (place: string) => void;
  /** Report a landed change: the view reloads and the user sees what happened. */
  landed: (outcome: ChangeOutcome) => void;
}

export const LedgerContext = createContext<Ledger | null>(null);

export function useLedger(): Ledger {
  const ctx = useContext(LedgerContext);
  if (!ctx) throw new Error('useLedger outside a LedgerContext');
  return ctx;
}

/** A place's label, or its path when the view does not hold it. */
export const labelOf = (view: LedgerView, place: string): string => view.places[place]?.label ?? (place || 'ledger');
