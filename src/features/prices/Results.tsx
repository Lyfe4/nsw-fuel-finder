import { Button } from '@/components/Button/Button';
import { VisuallyHidden } from '@/components/VisuallyHidden/VisuallyHidden';
import { formatAge, formatAsOf } from '@/lib/format';

import { LoadingStations } from './LoadingStations';
import { ErrorNotice, LocationProblemNotice, StaleNotice } from './Notices';
import { PriceSummaryLine } from './PriceSummaryLine';
import styles from './Results.module.css';
import { ResultsTools, type ResultsToolsProps } from './ResultsTools';
import { StationsPanel } from './StationsPanel';
import { announcement, distanceRange, type ResultsView } from './view';
import { NEAREST_MAX_KM, type PricesResponse } from '../../../shared/api';

import type { ResultsLayout } from '../search/searchState';
import type { Ref } from 'react';

export interface ResultsProps {
  view: ResultsView;
  fuelName: string;
  radius: number;
  now: Date;
  /** Focusable (tabIndex -1) so actions that remove their own button can move focus here. */
  headingRef?: Ref<HTMLHeadingElement>;
  onRetry: () => void;
  onRetryLocation: () => void;
  onPickCandidate: (candidate: string) => void;
  /** Move focus to the suburb box: the way out of most problems. */
  onSearchInstead: () => void;
  /** Identifies the search, so a new one starts the list from the top. */
  searchKey: string;
  /** Set when the same search was just answered from a newer snapshot. */
  refreshed: boolean;
  /** The selected station's code and a phone's list/map choice, from the URL. */
  station: string | null;
  layout: ResultsLayout;
  onSelectStation: (station: string | null, layout?: ResultsLayout) => void;
  onLayoutChange: (layout: ResultsLayout) => void;
  /** Sort and filters, from the URL, and every station found (for the counts). */
  tools: Omit<ResultsToolsProps, 'now'>;
  /** "Clear filters" when they hide every station: the button goes, so this moves focus too. */
  onClearFilters: () => void;
}

/**
 * "of Erina NSW 2250", "of postcode 2880", "of you". A postcode searched on
 * its own comes back labelled with just its four digits, which read as a
 * distance or a count without the word.
 */
export function where(data: PricesResponse): string {
  const label = data.origin.label;
  if (!label) return 'of you';
  return /^\d{4}$/.test(label) ? `of postcode ${label}` : `of ${label}`;
}

function heading(view: Extract<ResultsView, { data: PricesResponse }>, radius: number): string {
  const within = (count: string) => `${count} within ${String(radius)} km ${where(view.data)}`;
  switch (view.kind) {
    case 'results': {
      const count = view.stations.length;
      const stations = view.total === 1 ? 'station' : 'stations';
      return within(
        view.filtered
          ? `${String(count)} of ${String(view.total)} ${stations}`
          : `${String(count)} ${stations}`,
      );
    }
    case 'no-match':
      return within(`0 of ${String(view.total)} stations`);
    case 'nearest':
      return `Nearest stations, ${distanceRange(view.stations)} away`;
    case 'empty':
      return 'Prices';
  }
}

export function Results({
  view,
  fuelName,
  radius,
  now,
  headingRef,
  onRetry,
  onRetryLocation,
  onPickCandidate,
  onSearchInstead,
  searchKey,
  refreshed,
  station,
  layout,
  onSelectStation,
  onLayoutChange,
  tools,
  onClearFilters,
}: ResultsProps) {
  return (
    // No aria-busy: some screen readers hold back live regions inside a busy
    // element, which would swallow "Loading prices..." itself.
    <section className={styles.results} aria-labelledby="results-heading">
      <h2 id="results-heading" className={styles.heading} tabIndex={-1} ref={headingRef}>
        {'data' in view ? heading(view, radius) : 'Prices'}
      </h2>

      {/*
       * Always in the page, so screen readers are already listening when its
       * text changes. Errors are not announced here: they arrive as alerts.
       */}
      <VisuallyHidden role="status">
        {announcement(view, fuelName, {
          refreshedAsOf:
            refreshed && view.kind === 'results' ? formatAsOf(view.data.fetchedAt, now) : undefined,
          radius,
          sort: tools.sort,
        })}
      </VisuallyHidden>

      {view.kind === 'idle' && (
        <p className={styles.message}>
          Choose your fuel, then search a suburb or postcode, or use your location.
        </p>
      )}

      {view.kind === 'locating' && <p className={styles.message}>Finding your location…</p>}

      {view.kind === 'loading' && <LoadingStations />}

      {view.kind === 'location-problem' && (
        <LocationProblemNotice
          problem={view.problem}
          onRetry={onRetryLocation}
          onSearchInstead={onSearchInstead}
        />
      )}

      {view.kind === 'error' && (
        <ErrorNotice
          error={view.error}
          onRetry={onRetry}
          onPick={onPickCandidate}
          onSearchInstead={onSearchInstead}
        />
      )}

      {'data' in view && (
        <>
          <p className={styles.asOf}>
            {fuelName} · prices as of {formatAsOf(view.data.fetchedAt, now)}
          </p>
          {view.data.stale && <StaleNotice age={formatAge(view.data.fetchedAt, now)} />}
        </>
      )}

      {view.kind === 'empty' && (
        <div className={styles.empty}>
          <p>
            No stations sell {fuelName} within {NEAREST_MAX_KM} km {where(view.data)}.
          </p>
          <p>Try another fuel, or a different place.</p>
        </div>
      )}

      {view.kind === 'nearest' && (
        <p className={styles.nearest}>
          None sell {fuelName} within {radius} km {where(view.data)}, so these are the nearest{' '}
          {view.stations.length} that do, nearest first.
        </p>
      )}

      {view.kind === 'results' && <PriceSummaryLine stations={view.stations} />}

      {(view.kind === 'results' || view.kind === 'no-match') && (
        <ResultsTools {...tools} now={now} />
      )}

      {view.kind === 'no-match' && (
        <div className={styles.empty}>
          <p>None of the {view.total} stations match your filters.</p>
          <Button variant="primary" onClick={onClearFilters}>
            Clear filters
          </Button>
        </div>
      )}

      {(view.kind === 'results' || view.kind === 'nearest') && (
        <StationsPanel
          searchKey={searchKey}
          data={view.data}
          stations={view.stations}
          now={now}
          fuelName={fuelName}
          listLabel={
            view.kind === 'nearest' || tools.sort === 'distance'
              ? 'Stations, nearest first'
              : 'Stations, cheapest first'
          }
          arrangement={`${tools.sort}|${tools.brands.join(',')}|${String(tools.hideOld)}`}
          station={station}
          view={layout}
          onSelect={onSelectStation}
          onViewChange={onLayoutChange}
        />
      )}
    </section>
  );
}
