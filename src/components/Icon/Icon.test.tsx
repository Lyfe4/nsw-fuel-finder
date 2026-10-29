import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderApp, stationRow } from '@/features/search/testing';
import { fakeApi } from '@/lib/testing/fakeApi';

/*
 * Text characters used as icons (arrows, stars, crosses, triangles) are
 * drawn by iOS as coloured emoji. Every icon is the icon set's SVG instead,
 * hidden from assistive technology, with the control's name in words.
 */
const GLYPHS = /[↗↖↘↙→←↑↓☆★×✕✖▸▹▶▾▼▴▲⌄⌃✓✔]/u;

describe('icons', () => {
  it('are never text characters, in the search line, a station card or a price history', async () => {
    fakeApi();
    const { user } = renderApp('/?query=Erina');
    await screen.findByRole('list', { name: 'Stations, cheapest first' });
    await user.click(stationRow('Ampol Foodary Erina'));
    expect(document.body.textContent).not.toMatch(GLYPHS);

    await user.click(screen.getByRole('link', { name: /^Price history/ }));
    await screen.findByRole('slider');
    expect(document.body.textContent).not.toMatch(GLYPHS);
  });

  it('are hidden from assistive technology and never take focus', async () => {
    fakeApi();
    const { user } = renderApp('/?query=Erina');
    await screen.findByRole('list', { name: 'Stations, cheapest first' });
    await user.click(stationRow('Ampol Foodary Erina'));
    const icons = document.querySelectorAll('svg.tabler-icon');
    expect(icons.length).toBeGreaterThan(3);
    for (const icon of icons) {
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      expect(icon).toHaveAttribute('focusable', 'false');
      expect(icon).toHaveAttribute('stroke', 'currentColor');
    }
  });

  it('the card: Directions and Favourite keep their words, Close is the icon alone, named', async () => {
    fakeApi();
    const { user } = renderApp('/?query=Erina');
    await screen.findByRole('list', { name: 'Stations, cheapest first' });
    await user.click(stationRow('Ampol Foodary Erina'));
    const card = document.getElementById('card-1');
    if (!card) throw new Error('no card');
    const inCard = within(card);

    expect(inCard.getByRole('link', { name: /^Directions to Ampol Foodary Erina/ })).toBeVisible();
    const close = inCard.getByRole('button', { name: 'Close, Ampol Foodary Erina' });
    expect(close).toHaveAttribute('title', 'Close');
    expect(close.querySelector('svg')).toHaveClass('tabler-icon-x');

    // Favourite: an outline star, filled once saved (and aria-pressed says so).
    const favourite = inCard.getByRole('button', { name: 'Favourite, Ampol Foodary Erina' });
    expect(favourite).toHaveAttribute('aria-pressed', 'false');
    expect(favourite.querySelector('svg')).toHaveClass('tabler-icon-star');
    await user.click(favourite);
    expect(favourite).toHaveAttribute('aria-pressed', 'true');
    expect(favourite.querySelector('svg')).toHaveClass('tabler-icon-star-filled');
  });
});
