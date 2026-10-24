import { Button } from '@/components/Button/Button';
import { VisuallyHidden } from '@/components/VisuallyHidden/VisuallyHidden';
import { formatAge, formatAsOf } from '@/lib/format';

import { LoadingStations } from './LoadingStations';
import { ErrorNotice, LocationProblemNotice, StaleNotice } from './Notices';
import styles from './Results.module.css';
import { StationsPanel } from './StationsPanel';
import { announcement, type ResultsView } from './view';

import type { PricesResponse } from '../../../shared/api';
import type { ResultsLayout } from '../search/searchState';
import type { Ref } from 'react';

export interface ResultsProps {
  view: ResultsView;
  fuelName: string;
  radius: number;
  maxRadius: number;
  now: Date;
  /** Focusable (tabIndex -1) so actions that remove their own button can move focus here. */
  headingRef?: Ref<HTMLHeadingElement>;
  onRetry: () => void;
  onRetryLocation: () => void;
  onPickCandidate: (candidate: string) => void;
  /** Move focus to the distance select: the way out of an empty result. */
  onChooseDistance: () => void;
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

export function Results({
  view,
  fuelName,
  radius,
  maxRadius,
  now,
  headingRef,
  onRetry,
  onRetryLocation,
  onPickCandidate,
  onChooseDistance,
  onSearchInstead,
  searchKey,
  refreshed,
  station,
  layout,
  onSelectStation,
  onLayoutChange,
}: ResultsProps) {
  return (
    // No aria-busy: some screen readers hold back live regions inside a busy
    // element, which would swallow "Loading prices..." itself.
    <section className={styles.results} aria-labelledby="results-heading">
      <h2 id="results-heading" className={styles.heading} tabIndex={-1} ref={headingRef}>
        {view.kind === 'results'
          ? `${String(view.stations.length)} ${view.stations.length === 1 ? 'station' : 'stations'} within ${String(radius)} km ${where(view.data)}`
          : 'Prices'}
      </h2>

      {/*
       * Always in the page, so screen readers are already listening when its
       * text changes. Errors are not announced here: they arrive as alerts.
       */}
      <VisuallyHidden role="status">
        {announcement(view, fuelName, {
          refreshedAsOf:
            refreshed && view.kind === 'results' ? formatAsOf(view.data.fetchedAt, now) : undefined,
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

      {(view.kind === 'results' || view.kind === 'empty') && (
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
            No stations sell {fuelName} within {radius} km {where(view.data)}.
          </p>
          {radius < maxRadius ? (
            <Button variant="primary" onClick={onChooseDistance}>
              Choose a larger distance
            </Button>
          ) : (
            <p>Try another fuel, or a different place.</p>
          )}
        </div>
      )}

      {view.kind === 'results' && (
        <StationsPanel
          searchKey={searchKey}
          data={view.data}
          stations={view.stations}
          now={now}
          fuelName={fuelName}
          station={station}
          view={layout}
          onSelect={onSelectStation}
          onViewChange={onLayoutChange}
        />
      )}
    </section>
  );
}
