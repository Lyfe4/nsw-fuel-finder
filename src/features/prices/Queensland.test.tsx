import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderApp, results } from '@/features/search/testing';
import { asOfSentence } from '@/lib/sources';
import { expectNoAxeViolations } from '@/lib/testing/axe';
import {
  apiError,
  fakeApi,
  json,
  prices,
  station,
  stationsResponse,
  summary,
} from '@/lib/testing/fakeApi';

import { qldPriceNotices } from '../../../shared/api';
import { FAVOURITES_STORAGE_KEY } from '../favourites/favourites';

/*
 * The page with Queensland's prices in an answer (round 15). The API sends
 * them only once QLD_PUBLIC is on; until then answers look as they always
 * did, and so does the page (the last test here).
 */

// 03:00 UTC on 2 November: 2:00 pm in Sydney (daylight saving), 1:00 pm in Brisbane.
const NSW_AT = '2026-11-02T03:00:00.000Z';
const QLD_AT = '2026-11-02T03:00:00.000Z';
const NOW = new Date('2026-11-02T03:05:00Z');

const tweed = station({
  stationCode: '99001',
  name: 'Border Servo Tweed Heads',
  address: '1 Wharf St, Tweed Heads NSW 2485',
  priceCents: 236.9,
});
const coolangatta = station({
  stationCode: 'qld-61000001',
  name: 'Test Fuel Coolangatta',
  address: '1 Example Ave, Coolangatta QLD 4225',
  priceCents: 239.9,
  distanceKm: 2.2,
});

const both = prices({
  fetchedAt: NSW_AT,
  origin: { latitude: -28.18, longitude: 153.54, label: 'Tweed Heads NSW 2485' },
  stations: [tweed, coolangatta],
  sources: [
    { id: 'nsw', fetchedAt: NSW_AT, stale: false },
    { id: 'qld', fetchedAt: QLD_AT, stale: false },
  ],
  unavailable: [],
  // As the API sends them with any answer that has a Queensland station (round 16).
  notices: qldPriceNotices(2026),
});

describe('asOfSentence', () => {
  it('says each state’s time, in that state’s clock, when both are in the answer', () => {
    expect(asOfSentence(both, 'Unleaded 91', NOW)).toBe(
      'Unleaded 91 prices as of 2:00 pm (NSW) and 1:00 pm (Qld), from FuelCheck and Fuel Prices Qld.',
    );
  });

  it('says Queensland’s time alone, in Brisbane’s clock', () => {
    const qld = prices({
      fetchedAt: QLD_AT,
      sources: [{ id: 'qld', fetchedAt: QLD_AT, stale: false }],
    });
    expect(asOfSentence(qld, 'E10', NOW)).toBe('E10 prices as of 1:00 pm, from Fuel Prices Qld.');
  });

  it('reads an answer from before round 15, with no sources, as NSW', () => {
    const old = prices({ fetchedAt: NSW_AT });
    delete old.sources;
    expect(asOfSentence(old, 'Unleaded 91', NOW)).toBe(
      'Unleaded 91 prices as of 2:00 pm, from FuelCheck.',
    );
  });
});

describe('results with Queensland in them', () => {
  it('lists both states, with Queensland’s licence notice and its source on the card', async () => {
    fakeApi({ location: () => json(both) });
    const { container } = renderApp('/?query=Tweed%20Heads');
    const list = await screen.findByRole('list', { name: 'Stations, cheapest first' });
    expect(within(list).getByText('Test Fuel Coolangatta')).toBeInTheDocument();
    // The notices the API sent, word for word (licence clauses 4.2 and 2.3).
    const [copyNotice] = qldPriceNotices(2026);
    expect(within(results()).getByText(copyNotice ?? '')).toBeVisible();
    expect(within(results()).getByText('Queensland prices may not be republished.')).toBeVisible();
    // Each Queensland row says so in the list, before it is opened (clause 4.4).
    const qldRow = within(list).getByRole('button', { name: /Test Fuel Coolangatta/ });
    expect(qldRow).toHaveTextContent('Qld');
    expect(qldRow).toHaveAccessibleName(/price from Fuel Prices Qld/);
    expect(
      within(list).getByRole('button', { name: /Border Servo Tweed Heads/ }),
    ).not.toHaveTextContent('Qld');
    await expectNoAxeViolations(container);

    // Opened, a Queensland station's card says where its price is from (licence clause 4.4).
    await userEvent.click(within(list).getByRole('button', { name: /Test Fuel Coolangatta/ }));
    expect(await screen.findByText(/Price from Fuel Prices Qld/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /Border Servo Tweed Heads/ }));
    expect(await screen.findByText(/1 Wharf St/)).toBeVisible();
    expect(screen.queryByText(/Price from Fuel Prices Qld/)).not.toBeInTheDocument();
  });

  it('says which source is out of date, and which could not be read', async () => {
    fakeApi({
      location: () =>
        json({
          ...both,
          stale: true,
          sources: [
            { id: 'nsw', fetchedAt: NSW_AT, stale: false },
            { id: 'qld', fetchedAt: '2026-11-02T01:00:00.000Z', stale: true },
          ],
        }),
    });
    renderApp('/?query=Tweed%20Heads');
    expect(
      await within(results()).findByText(/Our last update from Fuel Prices Qld was/),
    ).toBeVisible();
    expect(within(results()).queryByText(/Our last update from FuelCheck/)).not.toBeInTheDocument();
  });

  it('says when one source could not be read', async () => {
    fakeApi({
      location: () =>
        json({ ...both, stations: [tweed], sources: [both.sources?.[0]], unavailable: ['qld'] }),
    });
    renderApp('/?query=Tweed%20Heads');
    expect(
      await within(results()).findByText(/Stations from Fuel Prices Qld may be missing/),
    ).toBeVisible();
  });

  it('does not add a second coverage sentence to one the API already gives', async () => {
    fakeApi({
      location: () =>
        apiError(
          400,
          'bad_request',
          'Enter a suburb name or a four-digit postcode. Fuel Finder covers NSW, the ACT and Queensland.',
        ),
    });
    renderApp('/?query=x');
    expect(
      await screen.findByText(
        'Enter a suburb name or a four-digit postcode. Fuel Finder covers NSW, the ACT and Queensland.',
      ),
    ).toBeVisible();
  });
});

describe('results without Queensland (QLD_PUBLIC off, as in production now)', () => {
  it('look as they always did: FuelCheck only, no Queensland notice', async () => {
    fakeApi({ location: () => json(prices({ stations: [tweed] })) });
    renderApp('/?query=Tweed%20Heads');
    expect(await within(results()).findByText(/from FuelCheck\.$/)).toBeVisible();
    expect(within(results()).queryByText(/State of Queensland/)).not.toBeInTheDocument();
    expect(within(results()).queryByText(/Fuel Prices Qld/)).not.toBeInTheDocument();
  });
});

describe('a Queensland favourite (round 16)', () => {
  const store = (favourites: { code: string; name: string }[]) => {
    window.localStorage.setItem(FAVOURITES_STORAGE_KEY, JSON.stringify(favourites));
  };

  it('says where its price is from, with the licence notices the API sent', async () => {
    store([
      { code: 'qld-61000001', name: 'Test Fuel Coolangatta' },
      { code: '99001', name: 'Border Servo Tweed Heads' },
    ]);
    fakeApi({
      stations: () =>
        json({
          ...stationsResponse([summary(coolangatta), summary(tweed)]),
          notices: qldPriceNotices(2026),
        }),
    });
    const { container } = renderApp('/');
    const list = await screen.findByRole('list', { name: 'Favourites, Unleaded 91' });
    await within(list).findByText(/239\.9/);
    const rows = within(list).getAllByRole('listitem');
    const qld = rows.find((row) => row.textContent.includes('Coolangatta'));
    const nsw = rows.find((row) => row.textContent.includes('Tweed Heads'));
    expect(qld).toHaveTextContent('from Fuel Prices Qld');
    expect(nsw).not.toHaveTextContent('Fuel Prices Qld');
    expect(screen.getByText('Queensland prices may not be republished.')).toBeVisible();
    await expectNoAxeViolations(container);
  });

  it('says Queensland is unavailable, not that the station is gone, when its source is', async () => {
    store([{ code: 'qld-61000001', name: 'Test Fuel Coolangatta' }]);
    fakeApi({
      stations: () => json({ ...stationsResponse([], ['qld-61000001']), unavailable: ['qld'] }),
    });
    renderApp('/');
    expect(
      await screen.findByText('Fuel Prices Qld prices are unavailable right now.'),
    ).toBeVisible();
    expect(screen.queryByText(/no longer lists/)).not.toBeInTheDocument();
  });
});
