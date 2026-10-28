import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  announced,
  openSearch,
  renderApp,
  results,
  stationNames,
  stationRow,
} from '@/features/search/testing';
import { expectNoAxeViolations } from '@/lib/testing/axe';
import { fakeApi, json, prices, station } from '@/lib/testing/fakeApi';

/** Five stations around Erina: three brands, one price a month old. */
const FIVE = [
  station({
    stationCode: '1',
    name: 'Shell Erina',
    brand: 'Shell',
    priceCents: 199.9,
    distanceKm: 3.1,
  }),
  station({ stationCode: '2', name: 'BP Erina', brand: 'BP', priceCents: 203.9, distanceKm: 0.8 }),
  station({
    stationCode: '3',
    name: 'BP Terrigal',
    brand: 'BP',
    priceCents: 205.9,
    distanceKm: 4.4,
  }),
  station({
    stationCode: '4',
    name: 'Metro Wamberal',
    brand: 'Metro Fuel',
    priceCents: 207.9,
    distanceKm: 2.0,
    priceUpdatedAt: '2026-09-20T00:00:00Z',
  }),
  station({
    stationCode: '5',
    name: 'Shell Green Point',
    brand: 'Shell',
    priceCents: 211.9,
    distanceKm: 1.5,
  }),
];

function setup(url = '/?query=Erina') {
  const api = fakeApi({ location: () => json(prices({ stations: FIVE })) });
  return { api, ...renderApp(url) };
}

const names = (label = 'Stations, cheapest first') =>
  stationNames(screen.getByRole('list', { name: label }));

const openFilters = async (user: ReturnType<typeof setup>['user']) => {
  await user.click(screen.getByText('Filters'));
};

describe('the price summary', () => {
  it('is one sentence for screen readers, and a few words on screen', async () => {
    setup();
    await screen.findByRole('list', { name: 'Stations, cheapest first' });
    // (199.9 + 203.9 + 205.9 + 207.9 + 211.9) / 5 = 205.9; 6.0 cents on 50 L is $3.00.
    const sentence =
      'Cheapest 199.9, average 205.9 cents a litre. Filling 50 litres at the cheapest saves $3.00 on the average.';
    // Screen readers get it as one run of plain text, not split at each bold number.
    const spoken = within(results()).getByText(sentence, { selector: 'span' });
    expect(spoken.childElementCount).toBe(0);
    // On screen, just the saving, beside the heading; hidden from them, who have the sentence.
    const shown = spoken.previousElementSibling;
    expect(shown).toHaveAttribute('aria-hidden', 'true');
    expect(shown?.textContent).toBe('save $3.00 on 50 L');
  });

  it('leaves out a saving too small to matter', async () => {
    fakeApi({
      location: () =>
        json(
          prices({
            stations: [
              station({ priceCents: 200 }),
              station({ stationCode: '2', priceCents: 200.4 }),
            ],
          }),
        ),
    });
    renderApp('/?query=Erina');
    await screen.findByRole('list', { name: 'Stations, cheapest first' });
    expect(
      within(results()).getByText('Cheapest 200.0, average 200.2 cents a litre.', {
        selector: 'span',
      }),
    ).toBeInTheDocument();
  });

  it('is not there for a single station: nothing to compare', async () => {
    fakeApi({ location: () => json(prices({ stations: [station()] })) });
    renderApp('/?query=Erina');
    await screen.findByRole('list', { name: 'Stations, cheapest first' });
    expect(within(results()).queryByText(/average/)).not.toBeInTheDocument();
  });
});

describe('sorting', () => {
  it('orders the list nearest first, in the URL, without a new history entry', async () => {
    const { user, container } = setup();
    await screen.findByRole('list', { name: 'Stations, cheapest first' });
    const length = window.history.length;

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'Nearest');
    expect(names('Stations, nearest first')).toEqual([
      'BP Erina',
      'Shell Green Point',
      'Metro Wamberal',
      'Shell Erina',
      'BP Terrigal',
    ]);
    expect(window.location.search).toBe('?fuel=U91&query=Erina&sort=distance');
    expect(window.history.length).toBe(length);
    // The cheapest is still named as the cheapest, wherever it now sits.
    expect(announced()).toContain('Cheapest Unleaded 91 is 199.9 cents a litre at Shell Erina.');
    await expectNoAxeViolations(container);
  });

  it('opens sorted from a shared link', async () => {
    setup('/?query=Erina&sort=distance');
    await screen.findByRole('list', { name: 'Stations, nearest first' });
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveValue('distance');
  });
});

describe('filters', () => {
  it('are closed by default, and say what is in force', async () => {
    setup();
    await screen.findByRole('list', { name: 'Stations, cheapest first' });
    expect(screen.getByText('Filters').closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText('Filters').closest('summary')).toHaveTextContent(/^Filters$/);
  });

  it('filter by brand, with counts, kept in the URL; the heading and status say how many', async () => {
    const { user, container } = setup();
    await screen.findByRole('list', { name: 'Stations, cheapest first' });
    await openFilters(user);

    const brands = screen.getByRole('group', { name: 'Brands' });
    expect(
      within(brands)
        .getAllByRole('checkbox')
        .map((box) => box.parentElement?.textContent),
    ).toEqual(['BP (2)', 'Shell (2)', 'Metro Fuel (1)']);
    await expectNoAxeViolations(container);

    await user.click(within(brands).getByRole('checkbox', { name: 'BP (2)' }));
    expect(names()).toEqual(['BP Erina', 'BP Terrigal']);
    expect(window.location.search).toBe('?fuel=U91&query=Erina&brand=BP');
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: '2 of 5 stations within 5 km of Erina NSW 2250',
      }),
    ).toBeInTheDocument();
    expect(announced()).toMatch(/^2 of 5 stations match your filters\./);
    expect(screen.getByText('Filters').closest('summary')).toHaveTextContent('Filters: BP');
    // Focus stays on the checkbox: nothing it did made it go away.
    expect(within(brands).getByRole('checkbox', { name: 'BP (2)' })).toHaveFocus();

    await user.click(within(brands).getByRole('checkbox', { name: 'Shell (2)' }));
    expect(names()).toEqual(['Shell Erina', 'BP Erina', 'BP Terrigal', 'Shell Green Point']);
    expect(screen.getByText('Filters').closest('summary')).toHaveTextContent(
      'Filters: BP and Shell',
    );
  });

  it('hide prices not updated for a fortnight, counting them first', async () => {
    const { user } = setup();
    await screen.findByRole('list', { name: 'Stations, cheapest first' });
    await openFilters(user);
    const hide = screen.getByRole('checkbox', {
      name: 'Hide prices not updated for 14 days or more (1)',
    });
    await user.click(hide);
    expect(names()).not.toContain('Metro Wamberal');
    expect(window.location.search).toBe('?fuel=U91&query=Erina&old=hide');
    // The brand counts are of what is left: Metro's only station was the old one.
    expect(screen.queryByRole('checkbox', { name: /^Metro Fuel/ })).not.toBeInTheDocument();
    expect(screen.getByText('Filters').closest('summary')).toHaveTextContent(
      'Filters: all brands, recent prices only',
    );
  });

  it('when they leave nothing, say so and offer to clear them, moving focus first', async () => {
    const { user, container } = setup('/?query=Erina&brand=Caltex');
    expect(
      await within(results()).findByText('None of the 5 stations match your filters.', {
        selector: 'p',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: '0 of 5 stations within 5 km of Erina NSW 2250',
      }),
    ).toBeInTheDocument();
    expect(announced()).toBe('None of the 5 stations match your filters.');
    await expectNoAxeViolations(container);

    const [clear] = within(results())
      .getAllByRole('button', { name: 'Clear filters' })
      .filter((button) => !button.closest('details'));
    if (!clear) throw new Error('no Clear filters button');
    await user.click(clear);
    expect(screen.getByRole('heading', { level: 2 })).toHaveFocus();
    expect(names()).toHaveLength(5);
    expect(window.location.search).toBe('?fuel=U91&query=Erina');
  });

  it('a chosen brand not in these results is still listed, at 0, so it can be unticked', async () => {
    const { user } = setup('/?query=Erina&brand=Caltex&brand=BP');
    await screen.findByRole('list', { name: 'Stations, cheapest first' });
    await openFilters(user);
    const caltex = screen.getByRole('checkbox', { name: 'Caltex (0)' });
    expect(caltex).toBeChecked();
    await user.click(caltex);
    expect(window.location.search).toBe('?fuel=U91&query=Erina&brand=BP');
  });

  it('are kept for the next search, like the fuel', async () => {
    const { user } = setup('/?query=Erina&brand=BP&sort=distance');
    await screen.findByRole('list', { name: 'Stations, nearest first' });
    await openSearch(user);
    const box = screen.getByRole('combobox', { name: /suburb or postcode/i });
    await user.clear(box);
    await user.type(box, 'Terrigal{Enter}');
    expect(window.location.search).toBe('?fuel=U91&query=Terrigal&sort=distance&brand=BP');
  });

  it('Clear filters in the panel keeps focus where it is', async () => {
    const { user } = setup('/?query=Erina&brand=BP&old=hide');
    await screen.findByRole('list', { name: 'Stations, cheapest first' });
    await openFilters(user);
    const clear = within(screen.getByText('Filters').closest('details') as HTMLElement).getByRole(
      'button',
      { name: 'Clear filters' },
    );
    await user.click(clear);
    expect(clear).toHaveFocus();
    expect(window.location.search).toBe('?fuel=U91&query=Erina');
    // Pressed again with nothing to clear, it does nothing, and is still there.
    await user.click(clear);
    expect(clear).toHaveFocus();
  });
});

describe('each station', () => {
  it('says how its price moved today, in its card, in words as well as an arrow', async () => {
    fakeApi({
      location: () =>
        json(
          prices({
            stations: [
              station({ stationCode: '1', name: 'Cheaper', changeCents: -2 }),
              station({ stationCode: '2', name: 'Dearer', changeCents: 4.5 }),
              station({ stationCode: '3', name: 'Same', changeCents: 0 }),
              station({ stationCode: '4', name: 'New', changeCents: null }),
            ],
          }),
        ),
    });
    const { user, container } = renderApp('/?query=Erina');
    await screen.findByRole('list', { name: 'Stations, cheapest first' });
    // The row is kept to name, price, distance and age; the move is in the card.
    const item = (name: string) => stationRow(name).closest('li') as HTMLElement;
    // Opening one closes the last, so open each in turn and read its card.
    const open = async (name: string) => {
      await user.click(stationRow(name));
      return within(item(name));
    };
    expect(within(item('Cheaper')).queryByText(/today/)).not.toBeInTheDocument();

    const cheaper = await open('Cheaper');
    expect(cheaper.getByText('↓ 2.0 today')).toHaveAttribute('aria-hidden', 'true');
    expect(cheaper.getByText('down 2.0 cents a litre since yesterday')).toBeInTheDocument();
    await expectNoAxeViolations(container);
    expect((await open('Dearer')).getByText('up 4.5 cents a litre since yesterday')).toBeVisible();
    expect((await open('Same')).queryByText(/today|since yesterday/)).not.toBeInTheDocument();
    expect((await open('New')).queryByText(/today|since yesterday/)).not.toBeInTheDocument();
  });

  it('has directions in its card, in the maps app, in a new tab, named for the station', async () => {
    const { user } = setup();
    await screen.findByRole('list', { name: 'Stations, cheapest first' });
    expect(screen.queryByRole('link', { name: /^Directions/ })).not.toBeInTheDocument();
    await user.click(stationRow('Shell Erina'));
    const link = screen.getByRole('link', {
      name: 'Directions to Shell Erina, opens in a new tab',
    });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link.getAttribute('href')).toBe(
      `https://www.google.com/maps/dir/?api=1&destination=${String(FIVE[0]?.latitude)},${String(FIVE[0]?.longitude)}&travelmode=driving`,
    );
  });
});
