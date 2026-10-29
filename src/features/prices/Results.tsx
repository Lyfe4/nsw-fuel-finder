import { useRef } from 'react';

import { Button } from '@/components/Button/Button';
import { VisuallyHidden } from '@/components/VisuallyHidden/VisuallyHidden';
import { ViewSwitch } from '@/features/map/ViewSwitch';
import { formatAge, formatAsOf } from '@/lib/format';
import {
  asOfSentence,
  hasQldStation,
  qldDataNotice,
  qldNoticeYear,
  SOURCE_NAMES,
} from '@/lib/sources';
import { useMediaQuery, WIDE_SCREEN } from '@/lib/useMediaQuery';

import { LoadingStations } from './LoadingStations';
import { ErrorNotice, LocationProblemNotice, StaleNotice, UnavailableNotice } from './Notices';
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

/**
 * The heading, in two parts: what is shown ("19 stations") and the rest of
 * the sentence ("within 5 km of postcode 2250"), which is visually hidden.
 * The folded search line already shows the place and the distance on a
 * phone, so on screen the count is enough; the heading's name stays whole.
 */
function heading(
  view: Extract<ResultsView, { data: PricesResponse }>,
  radius: number,
): { shown: string; rest: string } {
  const rest = `within ${String(radius)} km ${where(view.data)}`;
  switch (view.kind) {
    case 'results': {
      const count = view.stations.length;
      const stations = view.total === 1 ? 'station' : 'stations';
      return {
        shown: view.filtered
          ? `${String(count)} of ${String(view.total)} ${stations}`
          : `${String(count)} ${stations}`,
        rest,
      };
    }
    case 'no-match':
      return { shown: `0 of ${String(view.total)} stations`, rest };
    case 'nearest':
      return { shown: `Nearest stations, ${distanceRange(view.stations)} away`, rest: '' };
    case 'empty':
      return { shown: 'Prices', rest: '' };
  }
}

/** The shown part, then the rest for screen readers (the space outside it: see DirectionsLink). */
function HeadingText({ shown, rest }: { shown: string; rest: string }) {
  if (!rest) return shown;
  return (
    <>
      {shown} <VisuallyHidden>{rest}</VisuallyHidden>
    </>
  );
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
  const wide = useMediaQuery(WIDE_SCREEN);
  const mapButtonRef = useRef<HTMLButtonElement>(null);
  /*
   * List or Map, on a phone: first in the toolbar's one row, with Sort and
   * Filters. The nearest-stations view has no toolbar (nothing to sort or
   * filter), so there the switch stands alone.
   */
  const hasList = view.kind === 'results' || view.kind === 'nearest';
  const viewSwitch =
    !wide && hasList ? (
      <ViewSwitch view={layout} onChange={onLayoutChange} mapButtonRef={mapButtonRef} />
    ) : null;

  const top = (
    <div className={styles.top}>
      <h2 id="results-heading" className={styles.heading} tabIndex={-1} ref={headingRef}>
        {'data' in view ? <HeadingText {...heading(view, radius)} /> : 'Prices'}
      </h2>
      {view.kind === 'results' && <PriceSummaryLine stations={view.stations} />}
    </div>
  );
  const stale = 'data' in view && <SourceNotices data={view.data} now={now} />;
  const nearest = view.kind === 'nearest' && (
    <p className={styles.nearest}>
      None sell {fuelName} within {radius} km {where(view.data)}, so these are the nearest{' '}
      {view.stations.length} that do, nearest first.
    </p>
  );
  const toolbar =
    view.kind === 'results' || view.kind === 'no-match' ? (
      <ResultsTools {...tools} now={now} viewSwitch={viewSwitch} />
    ) : (
      view.kind === 'nearest' && viewSwitch
    );
  /*
   * Beside the map (wide screens, with a list), the heading, the saving and
   * the toolbar head the list's own column, so the map's column starts at
   * the top of the docket rather than under them, beside an empty space.
   */
  const inListColumn = wide && hasList;
  const header = (
    <>
      {top}
      {stale}
      {nearest}
      {toolbar}
    </>
  );

  return (
    // No aria-busy: some screen readers hold back live regions inside a busy
    // element, which would swallow "Loading prices..." itself.
    <section className={styles.results} aria-labelledby="results-heading">
      {!inListColumn && top}

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

      {view.kind === 'locating' && (
        <p className={[styles.message, styles.reserved].filter(Boolean).join(' ')}>
          Finding your location…
        </p>
      )}

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

      {!inListColumn && stale}

      {view.kind === 'empty' && (
        <div className={styles.empty}>
          <p>
            No stations sell {fuelName} within {NEAREST_MAX_KM} km {where(view.data)}.
          </p>
          <p>Try another fuel, or a different place.</p>
        </div>
      )}

      {!inListColumn && nearest}
      {!inListColumn && toolbar}

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
          mapButtonRef={mapButtonRef}
          listHeader={inListColumn ? header : null}
        />
      )}

      {/* When the prices are from: after the list, where it does not push the prices down. */}
      {'data' in view && <p className={styles.asOf}>{asOfSentence(view.data, fuelName, now)}</p>}
      {/* Queensland's licence (clause 4.3): its notice wherever its prices are shown. */}
      {'data' in view && hasQldStation([...view.data.stations, ...view.data.nearest]) && (
        <p className={styles.asOf}>
          {qldDataNotice(qldNoticeYear(view.data))} Queensland prices may not be republished.
        </p>
      )}
    </section>
  );
}

/**
 * Old prices, said per source (round 15), and a source that could not be
 * read. Answers from before round 15 have neither list: NSW, as before.
 */
function SourceNotices({ data, now }: { data: PricesResponse; now: Date }) {
  const stale = data.sources ? data.sources.filter((s) => s.stale) : [];
  return (
    <>
      {!data.sources && data.stale && <StaleNotice age={formatAge(data.fetchedAt, now)} />}
      {stale.map((source) => (
        <StaleNotice
          key={source.id}
          age={formatAge(source.fetchedAt, now)}
          source={SOURCE_NAMES[source.id]}
        />
      ))}
      {data.unavailable && data.unavailable.length > 0 && (
        <UnavailableNotice sources={data.unavailable.map((id) => SOURCE_NAMES[id])} />
      )}
    </>
  );
}
