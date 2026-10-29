import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useLayoutEffect, useRef } from 'react';

import { Button } from '@/components/Button/Button';
import { Icon } from '@/components/Icon/Icon';
import { Back } from '@/components/Icon/icons';
import { VisuallyHidden } from '@/components/VisuallyHidden/VisuallyHidden';
import { LoadingStations } from '@/features/prices/LoadingStations';
import { ApiRequestError, fetchHistory } from '@/lib/api';

import styles from './LazyHistoryView.module.css';

import type { FuelTypeCode } from '../../../shared/fuelTypes';

/*
 * The way into a station's price history. The data is fetched here, at once,
 * while the chart's code downloads in parallel (HistoryView is its own
 * chunk, with its own bundle budget).
 */
const HistoryView = lazy(() =>
  import('./HistoryView').then((module) => ({ default: module.HistoryView })),
);

export interface LazyHistoryViewProps {
  code: string;
  fuel: FuelTypeCode;
  fuelName: string;
  now: Date;
  onClose: () => void;
}

/**
 * A view over the results, opened from a station's name: its own heading,
 * a way back, and the history. Focus goes to the heading when it opens, since
 * the link that opened it is no longer on screen.
 */
export function LazyHistoryView({ code, fuel, fuelName, now, onClose }: LazyHistoryViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const history = useQuery({
    queryKey: ['history', code, fuel],
    queryFn: ({ signal }) => fetchHistory(code, fuel, signal),
    // History changes once a day.
    staleTime: 10 * 60_000,
  });

  useLayoutEffect(() => {
    headingRef.current?.focus();
  }, [code]);

  const name = history.data?.station.name;
  const notListed = history.error instanceof ApiRequestError && history.error.status === 404;

  return (
    <section className={styles.section} aria-labelledby="history-heading">
      <Button variant="quiet" className={styles.back} onClick={onClose}>
        <Icon icon={Back} />
        Back to results
      </Button>
      {/* The station's name on screen; "Price history:" before it for screen readers. */}
      <h2 id="history-heading" className={styles.heading} tabIndex={-1} ref={headingRef}>
        {name ? (
          <>
            <VisuallyHidden>Price history:</VisuallyHidden> {name}
          </>
        ) : (
          'Price history'
        )}
      </h2>
      {history.isPending && <LoadingStations />}
      {history.isError && (
        <p role="alert" className={styles.problem}>
          {notListed
            ? 'FuelCheck no longer lists this station, so it has no prices to show.'
            : 'The price history couldn’t be loaded. Check your connection and try again.'}
        </p>
      )}
      {history.data && (
        <Suspense fallback={<LoadingStations />}>
          <HistoryView data={history.data} fuelName={fuelName} now={now} />
        </Suspense>
      )}
    </section>
  );
}
