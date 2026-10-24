import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectNoAxeViolations } from '@/lib/testing/axe';
import { apiError, fakeApi, json, prices, suggestions } from '@/lib/testing/fakeApi';

import { announced, placeInput, renderApp, results } from './testing';

describe('searching by suburb or postcode', () => {
  it('starts with a prompt and no requests, and passes axe', async () => {
    const api = fakeApi();
    const { container } = renderApp();

    expect(within(results()).getByText(/choose your fuel, then search/i)).toBeInTheDocument();
    expect(api.fetch).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('searches typed text on Enter, announces loading then the result', async () => {
    let respond: (() => void) | undefined;
    const api = fakeApi({
      location: () =>
        new Promise((resolve) => {
          respond = () => resolve(json(prices()));
        }),
    });
    const { user, container } = renderApp();

    await user.type(placeInput(), 'Erina{Enter}');
    await waitFor(() => {
      expect(announced()).toBe('Loading prices…');
    });
    // Station-shaped placeholders on screen, hidden from screen readers (the status says it).
    expect(within(results()).getByTestId('loading-stations')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    act(() => respond?.());

    expect(
      await screen.findByRole('heading', { name: '2 stations within 5 km of Erina NSW 2250' }),
    ).toBeInTheDocument();
    expect(announced()).toBe(
      '2 stations found. Cheapest Unleaded 91 is 229.9 cents a litre at Ampol Foodary Erina.',
    );
    expect(api.calls('location')).toEqual([{ query: 'Erina', fuel: 'U91', radius: '5' }]);
    expect(window.location.search).toBe('?fuel=U91&query=Erina');
    // Focus stays where the user was typing.
    expect(placeInput()).toHaveFocus();
    await expectNoAxeViolations(container);
  });

  it('lists stations cheapest first, each headed by its name', async () => {
    fakeApi();
    renderApp('/?query=Erina');

    const list = await screen.findByRole('list', { name: 'Stations, cheapest first' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => within(item).getByRole('heading').textContent)).toEqual([
      'Ampol Foodary Erina',
      'Metro Petroleum West Gosford',
    ]);
    // The price reads as words, not as "¢/L".
    expect(within(list).getAllByText('cents a litre')).toHaveLength(2);
    // The fixture's snapshot is 2:30 pm on 23 Oct; any later day adds the date.
    expect(
      within(results()).getByText(/^Unleaded 91 · prices as of (\w+, \d+ \w+, )?2:30 pm$/),
    ).toBeInTheDocument();
  });

  it('offers suggestions as an accessible combobox, and searches the one chosen', async () => {
    const api = fakeApi({
      places: (params) =>
        json(
          suggestions(params.get('query') ?? '', [
            'Kingswood (Bega Valley) NSW 2550',
            'Kingswood (Penrith) NSW 2747',
            'Kingswood (Tamworth Regional) NSW 2340',
          ]),
        ),
    });
    const { user, container } = renderApp();

    await user.type(placeInput(), 'kings');
    const listbox = screen.getByRole('listbox');
    await waitFor(() => {
      expect(within(listbox).getAllByRole('option')).toHaveLength(3);
    });
    expect(placeInput()).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByText('3 suggestions. Use up and down arrows to choose.'),
    ).toBeInTheDocument();
    await expectNoAxeViolations(container);

    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(placeInput()).toHaveAttribute(
      'aria-activedescendant',
      within(listbox).getByRole('option', { name: 'Kingswood (Penrith) NSW 2747' }).id,
    );
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(api.calls('location')).toEqual([
        { query: 'Kingswood (Penrith) NSW 2747', fuel: 'U91', radius: '5' },
      ]);
    });
    expect(placeInput()).toHaveValue('Kingswood (Penrith) NSW 2747');
    // Suggestions are asked for once typing settles, not per keystroke.
    expect(api.calls('places').length).toBeLessThan(3);
  });

  it('closes the suggestions when typed text is submitted with Enter', async () => {
    fakeApi({
      places: (params) =>
        json(suggestions(params.get('query') ?? '', ['Erina NSW 2250', 'Erina Heights NSW 2260'])),
    });
    const { user } = renderApp();

    await user.type(placeInput(), 'erina');
    const listbox = screen.getByRole('listbox');
    await waitFor(() => {
      expect(within(listbox).getAllByRole('option')).toHaveLength(2);
    });
    await user.keyboard('{Enter}');

    expect(placeInput()).toHaveAttribute('aria-expanded', 'false');
    expect(within(listbox).queryAllByRole('option')).toHaveLength(0);
    expect(window.location.search).toBe('?fuel=U91&query=erina');
  });

  /*
   * Kept as the WAI-ARIA combobox pattern has it (and as a native search box
   * behaves): Escape closes the list, and only a second Escape clears the
   * text. Someone pressing Escape to get the list out of the way keeps what
   * they typed.
   */
  it('Escape closes the suggestions first, keeping the text, then clears it', async () => {
    fakeApi({
      places: (params) =>
        json(suggestions(params.get('query') ?? '', ['Erina NSW 2250', 'Erina Heights NSW 2260'])),
    });
    const { user } = renderApp();

    await user.type(placeInput(), 'erina');
    const listbox = screen.getByRole('listbox');
    await waitFor(() => {
      expect(within(listbox).getAllByRole('option')).toHaveLength(2);
    });

    await user.keyboard('{Escape}');
    expect(placeInput()).toHaveAttribute('aria-expanded', 'false');
    expect(placeInput()).toHaveValue('erina');

    await user.keyboard('{Escape}');
    expect(placeInput()).toHaveValue('');
    expect(placeInput()).toHaveFocus();
  });

  it('asks for suggestions only from two characters', async () => {
    const api = fakeApi();
    const { user } = renderApp();
    await user.type(placeInput(), 'b');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(api.calls('places')).toEqual([]);
  });

  it('changes fuel without a new history entry, and searches again', async () => {
    const api = fakeApi();
    const { user } = renderApp('/?query=Erina');
    await screen.findByRole('list', { name: 'Stations, cheapest first' });
    const historyLength = window.history.length;

    await user.selectOptions(screen.getByRole('combobox', { name: 'Fuel' }), 'Diesel');

    await waitFor(() => {
      expect(api.calls('location').at(-1)).toEqual({ query: 'Erina', fuel: 'DL', radius: '5' });
    });
    expect(window.location.search).toBe('?fuel=DL&query=Erina');
    expect(window.history.length).toBe(historyLength);
  });

  it('follows Back to the previous search, input included', async () => {
    fakeApi();
    const { user } = renderApp('/?query=Erina');
    await screen.findByRole('list', { name: 'Stations, cheapest first' });

    await user.clear(placeInput());
    await user.type(placeInput(), '2250{Enter}');
    await waitFor(() => {
      expect(window.location.search).toBe('?fuel=U91&query=2250');
    });

    act(() => {
      window.history.replaceState(null, '', '/?fuel=U91&query=Erina');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(placeInput()).toHaveValue('Erina');
  });

  it('says what to do when Search is pressed with nothing typed', async () => {
    const api = fakeApi();
    const { user } = renderApp();
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a suburb or postcode, or use your location.',
    );
    expect(api.calls('location')).toEqual([]);
  });

  it('can be used with the keyboard alone, in a sensible order', async () => {
    fakeApi();
    const { user } = renderApp();

    await user.tab();
    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('combobox', { name: 'Fuel' })).toHaveFocus();
    await user.tab();
    expect(placeInput()).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Search' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Use my location' })).toHaveFocus();
  });

  it('turns an API refusal into a message, not a crash', async () => {
    fakeApi({ location: () => apiError(400, 'bad_request', 'Enter a NSW suburb name.') });
    const { user } = renderApp();
    await user.type(placeInput(), 'Erina{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a NSW suburb name.');
  });

  it('shows prices it already has when a background refresh fails', async () => {
    let fail = false;
    fakeApi({
      location: () => (fail ? apiError(503, 'snapshot_unavailable', 'x') : json(prices())),
    });
    renderApp('/?query=Erina');
    await screen.findByRole('list', { name: 'Stations, cheapest first' });

    fail = true;
    act(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole('list', { name: 'Stations, cheapest first' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
