import { FavouriteButton } from '@/features/favourites/FavouriteButton';
import { DirectionsLink } from '@/features/prices/DirectionsLink';
import { formatAge, formatPrice } from '@/lib/format';

import { HistoryChart } from './HistoryChart';
import styles from './HistoryView.module.css';
import { coverageText, formatDay, gaps, summarise, summaryText } from './summary';
import { FUEL_TYPES } from '../../../shared/fuelTypes';

import type { HistoryResponse } from '../../../shared/api';

/** Fewer days than this and the chart has too little to show; the words and table do the job. */
const MIN_DAYS_FOR_CHART = 3;

/**
 * Everything about one station's price history, for one fuel. Only ever
 * loaded through LazyHistoryView: the chart and table are code nobody needs
 * until they open a station's history.
 */
export function HistoryView({
  data,
  fuelName,
  now,
}: {
  data: HistoryResponse;
  fuelName: string;
  now: Date;
}) {
  const { station, days, sources } = data;
  const price = station.prices[data.fuelType];
  const summary = summarise(days);
  const gapList = gaps(days);

  return (
    <div className={styles.view}>
      <div className={styles.station}>
        <p className={styles.address}>
          {station.brand} · {station.address}
        </p>
        <p className={styles.now}>
          {price ? (
            <>
              <span className={styles.amount}>{formatPrice(price.priceCents)}</span> cents a litre
              now, updated {formatAge(price.updatedAt, now)}
            </>
          ) : (
            `Does not sell ${fuelName} now.`
          )}
        </p>
        <div className={styles.actions}>
          <DirectionsLink station={station} />
          <FavouriteButton code={station.stationCode} name={station.name} />
        </div>
      </div>

      <AllFuels data={data} now={now} />

      {summary ? (
        <p className={styles.summary}>{summaryText(summary)}</p>
      ) : (
        <p className={styles.summary}>
          No {fuelName} price history for this station yet. We add a day every morning.
        </p>
      )}

      {days.length >= MIN_DAYS_FOR_CHART ? (
        <HistoryChart key={data.fuelType} days={days} fuelName={fuelName} />
      ) : (
        days.length > 0 && (
          <p className={styles.short}>
            Only {days.length} {days.length === 1 ? 'day' : 'days'} so far, so no chart yet.
          </p>
        )
      )}

      {days.length > 0 && (
        <details className={styles.tableWrap}>
          <summary className={styles.tableSummary}>Daily prices as a table</summary>
          <table className={styles.table}>
            <caption className={styles.caption}>
              {fuelName} at {station.name}, cents a litre, newest first
            </caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Low</th>
                <th scope="col">High</th>
                <th scope="col">Last</th>
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map(([day, low, high, last]) => (
                <tr key={day}>
                  <th scope="row">{formatDay(day)}</th>
                  <td>{formatPrice(low)}</td>
                  <td>{formatPrice(high)}</td>
                  <td>{formatPrice(last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      <p className={styles.credit}>
        {coverageText(sources, gapList)}{' '}
        {sources.some((source) => source.kind === 'fuelcheck-monthly') && (
          <>
            Published history from{' '}
            <a href="https://data.nsw.gov.au/data/dataset/fuel-check">
              NSW FuelCheck price history
            </a>{' '}
            (NSW Fair Trading), used under{' '}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA</a>; daily low, high
            and last worked out by us and shared under the same licence.
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Every fuel the station sells, from the same snapshot the search uses (it
 * comes with the history, so this costs no request of any kind). Up to seven
 * rows, in the fuel picker's order; the one the chart is for says so in words.
 */
function AllFuels({ data, now }: { data: HistoryResponse; now: Date }) {
  const sold = FUEL_TYPES.flatMap(({ code, name }) => {
    const price = data.station.prices[code];
    return price ? [{ code, name, ...price }] : [];
  });
  if (sold.length === 0) return null;
  return (
    <table className={styles.table}>
      <caption className={styles.caption}>Every fuel here now, cents a litre</caption>
      <thead>
        <tr>
          <th scope="col">Fuel</th>
          <th scope="col">Price</th>
          <th scope="col">Updated</th>
        </tr>
      </thead>
      <tbody>
        {sold.map(({ code, name, priceCents, updatedAt }) => (
          <tr key={code}>
            <th scope="row">
              {name}
              {code === data.fuelType && <span className={styles.charted}> (chart below)</span>}
            </th>
            <td>{formatPrice(priceCents)}</td>
            <td>{formatAge(updatedAt, now)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
