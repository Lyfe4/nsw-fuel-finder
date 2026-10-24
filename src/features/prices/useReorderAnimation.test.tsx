import { render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useReorderAnimation } from './useReorderAnimation';

/** A list whose cards are 100px tall, in the order given. jsdom has no layout, so it is faked. */
function Cards({
  codes,
  arrangement,
  reducedMotion = false,
}: {
  codes: string[];
  arrangement: string;
  reducedMotion?: boolean;
}) {
  const ref = useRef<HTMLOListElement>(null);
  useReorderAnimation(ref, arrangement, reducedMotion);
  return (
    <ol ref={ref}>
      {codes.map((code) => (
        <li key={code} data-station={code}>
          {code}
        </li>
      ))}
    </ol>
  );
}

const animate = vi.fn();

beforeEach(() => {
  Element.prototype.animate = animate;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(
    this: Element,
  ) {
    const index =
      this.tagName === 'LI' ? [...(this.parentElement?.children ?? [])].indexOf(this) : 0;
    return { top: index * 100 } as DOMRect;
  });
});

afterEach(() => {
  animate.mockReset();
  vi.restoreAllMocks();
});

const moves = () =>
  animate.mock.calls.map(([frames]) => (frames as Keyframe[])[0]?.transform as string);

describe('cards sliding to their new places', () => {
  it('slides each card that moved from its old place when the sort changes', () => {
    const { rerender } = render(<Cards codes={['a', 'b', 'c']} arrangement="price" />);
    rerender(<Cards codes={['c', 'a', 'b']} arrangement="distance" />);
    // c was 200px lower; a and b were 100px higher.
    expect(moves()).toEqual(['translateY(200px)', 'translateY(-100px)', 'translateY(-100px)']);
  });

  it('does nothing when the same arrangement re-renders (a refresh, Show more)', () => {
    const { rerender } = render(<Cards codes={['a', 'b']} arrangement="price" />);
    rerender(<Cards codes={['b', 'a']} arrangement="price" />);
    expect(animate).not.toHaveBeenCalled();
  });

  it('does nothing with reduced motion', () => {
    const { rerender } = render(<Cards codes={['a', 'b']} arrangement="price" reducedMotion />);
    rerender(<Cards codes={['b', 'a']} arrangement="distance" reducedMotion />);
    expect(animate).not.toHaveBeenCalled();
  });

  it('leaves new cards to their own entrance', () => {
    const { rerender } = render(<Cards codes={['a']} arrangement="BP" />);
    rerender(<Cards codes={['b', 'a']} arrangement="" />);
    expect(moves()).toEqual(['translateY(-100px)']);
  });
});
