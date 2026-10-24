import { useLayoutEffect, useRef, type RefObject } from 'react';

/** How many cards, from the top, a reorder animates: enough to fill any screen. */
const ANIMATED_CARDS = 40;
const DURATION_MS = 220;

/**
 * When the list is re-sorted or re-filtered, slides each card from where it
 * was to where it now is ("FLIP": measure first, change, measure last, then
 * animate the difference as a transform), so the eye can follow it.
 *
 * Only when `arrangement` (the sort and filters) changes: a data refresh,
 * "Show more" or a selection never moves anything. The DOM itself changes at
 * once, as usual; only the cards' pixels catch up, by transform, so nothing
 * around them moves (no layout shift) and nothing waits on the animation.
 *
 * View Transitions were tried first and dropped (docs/decisions.md): they
 * apply the change a frame late, so a ticked checkbox read as unticked for a
 * frame, and their overlay swallowed a second click made during one.
 *
 * Positions are measured against the list itself, so scrolling the page or a
 * change above the list is not mistaken for a move.
 */
export function useReorderAnimation(
  listRef: RefObject<HTMLOListElement | null>,
  arrangement: string,
  reducedMotion: boolean,
): void {
  const positions = useRef(new Map<string, number>());
  const lastArrangement = useRef(arrangement);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const top = list.getBoundingClientRect().top;
    const cards = [...list.querySelectorAll<HTMLElement>(':scope > li[data-station]')].slice(
      0,
      ANIMATED_CARDS,
    );
    const now = new Map<string, number>();
    for (const card of cards) {
      now.set(card.dataset.station ?? '', card.getBoundingClientRect().top - top);
    }

    const rearranged = lastArrangement.current !== arrangement;
    lastArrangement.current = arrangement;
    if (rearranged && !reducedMotion && typeof Element.prototype.animate === 'function') {
      for (const card of cards) {
        const before = positions.current.get(card.dataset.station ?? '');
        const after = now.get(card.dataset.station ?? '');
        if (before === undefined || after === undefined || before === after) continue;
        card.animate(
          [{ transform: `translateY(${String(before - after)}px)` }, { transform: 'none' }],
          { duration: DURATION_MS, easing: 'ease-out' },
        );
      }
    }
    positions.current = now;
  });
}
