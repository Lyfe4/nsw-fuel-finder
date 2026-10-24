import { Button } from '@/components/Button/Button';
import { VisuallyHidden } from '@/components/VisuallyHidden/VisuallyHidden';
import { formatAge, formatAsOf } from '@/lib/format';

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
  onWiden: () => void;
  /** Move focus to the suburb box: the way out of most problems. */
  onSearchInstead: () => void;
  /** The selected station's code and a phone's list/map choice, from the URL. */
  station: string | null;
  layout: ResultsLayout;
  onSelectStation: (station: string | null, layout?: ResultsLayout) => void;
  onLayoutChange: (layout: ResultsLayout) => void;
}

function where(data: PricesResponse): string {
  return data.origin.label ? `of ${data.origin.label}` : 'of you';
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
  onWiden,
  onSearchInstead,
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
      <VisuallyHidden role="status">{announcement(view, fuelName)}</VisuallyHidden>

      {view.kind === 'idle' && (
        <p className={styles.message}>
          Choose your fuel, then search a suburb or postcode, or use your location.
        </p>
      )}

      {view.kind === 'locating' && <p className={styles.message}>Finding your location…</p>}

      {view.kind === 'loading' && <p className={styles.message}>Loading prices…</p>}

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
          {radius < maxRadius && (
            <Button variant="primary" onClick={onWiden}>
              Search within {maxRadius} km
            </Button>
          )}
        </div>
      )}

      {view.kind === 'results' && (
        <StationsPanel
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
