import { useId } from 'react';

import { Button } from '@/components/Button/Button';

import { brandCounts, filtersText, withoutOld } from './filters';
import { OLD_PRICE_DAYS } from './priceAge';
import styles from './ResultsTools.module.css';

import type { StationPrice } from '../../../shared/api';
import type { ResultsSort } from '../search/searchState';

export interface ResultsToolsProps {
  /** Every station the search found, before filters: the counts come from these. */
  found: readonly StationPrice[];
  now: Date;
  sort: ResultsSort;
  brands: readonly string[];
  hideOld: boolean;
  onSortChange: (sort: ResultsSort) => void;
  onBrandsChange: (brands: string[]) => void;
  onHideOldChange: (hideOld: boolean) => void;
  onClearFilters: () => void;
}

/**
 * Sort and filter the results, on this device: the API never sees either.
 *
 * Sort is a native select, like Fuel and Within. The filters are in a
 * closed <details>, because a 25 km search can find 30 brands and a wall of
 * checkboxes above the prices is the clutter this must not be. Its summary
 * says what is in force ("Filters: BP and Shell"), so a closed panel never
 * hides that the list is filtered.
 *
 * Native checkboxes in a fieldset, each with its count: the counts are of
 * the stations left after the old-price filter, so they add up to what the
 * list will show. Changes apply at once; there is no Apply button to miss.
 */
export function ResultsTools({
  found,
  now,
  sort,
  brands,
  hideOld,
  onSortChange,
  onBrandsChange,
  onHideOldChange,
  onClearFilters,
}: ResultsToolsProps) {
  const sortId = useId();
  const recent = withoutOld(found, now);
  const oldCount = found.length - recent.length;
  const counts = brandCounts(hideOld ? recent : found, brands);
  const chosen = new Set(brands);
  const filters = { brands, hideOld };

  const toggleBrand = (brand: string, on: boolean) => {
    onBrandsChange(on ? [...brands, brand] : brands.filter((b) => b !== brand));
  };

  return (
    <div className={styles.tools}>
      <div className={styles.sort}>
        <label htmlFor={sortId} className={styles.label}>
          Sort
        </label>
        <select
          id={sortId}
          className={styles.select}
          value={sort}
          onChange={(event) => {
            onSortChange(event.target.value === 'distance' ? 'distance' : 'price');
          }}
        >
          <option value="price">Cheapest first</option>
          <option value="distance">Nearest first</option>
        </select>
      </div>
      <details className={styles.filters}>
        <summary className={styles.summary}>
          Filters: <span className={styles.current}>{filtersText(filters)}</span>
        </summary>
        <div className={styles.panel}>
          <fieldset className={styles.brands}>
            <legend className={styles.legend}>Brands</legend>
            <p className={styles.hint}>None ticked shows every brand.</p>
            <ul className={styles.options}>
              {counts.map(({ brand, count }) => (
                <li key={brand}>
                  <label className={styles.option}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={chosen.has(brand)}
                      onChange={(event) => {
                        toggleBrand(brand, event.target.checked);
                      }}
                    />
                    <span>
                      {brand} <span className={styles.count}>({count})</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <label className={styles.option}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={hideOld}
              onChange={(event) => {
                onHideOldChange(event.target.checked);
              }}
            />
            <span>
              Hide prices not updated for {OLD_PRICE_DAYS} days or more{' '}
              <span className={styles.count}>({oldCount})</span>
            </span>
          </label>
          {/*
           * Always there and never disabled: a focused button that hides or
           * disables itself drops keyboard focus to the page. With nothing
           * to clear, pressing it does nothing.
           */}
          <Button className={styles.clear} onClick={onClearFilters}>
            Clear filters
          </Button>
        </div>
      </details>
    </div>
  );
}
