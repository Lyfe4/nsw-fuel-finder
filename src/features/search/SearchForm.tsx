import { useId, useState, type SubmitEvent, type Ref } from 'react';

import { Button, IconButton } from '@/components/Button/Button';
import { Icon } from '@/components/Icon/Icon';
import { Caret, Search } from '@/components/Icon/icons';
import { VisuallyHidden } from '@/components/VisuallyHidden/VisuallyHidden';

import { PlaceCombobox } from './PlaceCombobox';
import styles from './SearchForm.module.css';
import { RADIUS_STEPS, splitPlace } from './searchState';
import { FUEL_TYPES, isFuelTypeCode, type FuelTypeCode } from '../../../shared/fuelTypes';

export interface SearchFormProps {
  fuel: FuelTypeCode;
  radius: number;
  currentQuery: string;
  locating: boolean;
  onFuelChange: (fuel: FuelTypeCode) => void;
  onRadiusChange: (radius: number) => void;
  onSearchPlace: (query: string) => void;
  onUseLocation: () => void;
  placeInputRef?: Ref<HTMLInputElement>;
  /**
   * On a phone after a search, the form folds into one line: the fuel (still
   * a select, so changing it is one tap), the place and distance, and the
   * search button ("Change search"), which opens the form again. `null` when it never folds: before a
   * search, and on a wide screen, where the form is one row anyway.
   */
  folded: { open: boolean; place: string; onOpenChange: (open: boolean) => void } | null;
}

const fuelOptions = FUEL_TYPES.map(({ code, name }) => (
  <option key={code} value={code}>
    {name}
  </option>
));

export function SearchForm({
  fuel,
  radius,
  currentQuery,
  locating,
  onFuelChange,
  onRadiusChange,
  onSearchPlace,
  onUseLocation,
  placeInputRef,
  folded,
}: SearchFormProps) {
  const fuelId = useId();
  const radiusId = useId();
  const formId = useId();
  const [typed, setTyped] = useState(currentQuery);
  const [empty, setEmpty] = useState(false);
  // Follow the URL when it changes underneath the form (Back, Forward, a
  // "did you mean" button), without a remount that would throw away focus.
  const [syncedQuery, setSyncedQuery] = useState(currentQuery);
  if (currentQuery !== syncedQuery) {
    setSyncedQuery(currentQuery);
    setTyped(currentQuery);
  }

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = typed.trim();
    setEmpty(!query);
    if (query) onSearchPlace(query);
  };

  const changeFuel = (value: string) => {
    if (isFuelTypeCode(value)) onFuelChange(value);
  };
  const fuelName = FUEL_TYPES.find((f) => f.code === fuel)?.name ?? fuel;
  const [suburb, postcode] = splitPlace(folded?.place ?? '');

  return (
    <div className={styles.search}>
      {folded && (
        <div className={styles.folded}>
          <div className={styles.lead}>
            {/*
             * The fuel stays a native select here: changing it is the most
             * common thing after a search, and one tap. While the form is open
             * it has its own Fuel select, so this one becomes plain text.
             */}
            {folded.open ? (
              <span className={styles.fuelText}>{fuelName}</span>
            ) : (
              /*
               * The select itself is invisible over the fuel's name and caret,
               * so the line is exactly as wide as the name in every browser
               * (field-sizing is Chromium's alone), and a tap anywhere on it
               * opens the phone's own picker.
               */
              <span className={styles.fuelPick}>
                <span aria-hidden="true" className={styles.fuelName}>
                  {fuelName}
                </span>
                <Icon icon={Caret} />
                <select
                  aria-label="Fuel"
                  className={styles.fuelSelect}
                  value={fuel}
                  onChange={(event) => {
                    changeFuel(event.target.value);
                  }}
                >
                  {fuelOptions}
                </select>
              </span>
            )}
            {/*
             * "10 km · Port Macquarie NSW 2444": beside the fuel when it
             * fits, otherwise on a line of its own under it. The distance
             * comes first and is never cut; a place too long for the line
             * loses the end of its suburb ("Port Macqu…"), never the state
             * and postcode.
             */}
            <span className={styles.where}>
              <span className={styles.distance}>
                <VisuallyHidden>, within </VisuallyHidden>
                {radius} km
              </span>
              <span aria-hidden="true">·</span>
              <VisuallyHidden>,</VisuallyHidden>{' '}
              <span className={styles.place}>
                <span className={styles.suburb}>{suburb}</span>
                {postcode && <span className={styles.postcode}>{postcode}</span>}
              </span>
            </span>
          </div>
          <IconButton
            icon={Search}
            label="Change search"
            title="Change search"
            className={styles.toggle}
            aria-expanded={folded.open}
            aria-controls={formId}
            onClick={() => {
              folded.onOpenChange(!folded.open);
            }}
          />
        </div>
      )}
      <form
        id={formId}
        role="search"
        aria-label="Fuel prices"
        className={styles.form}
        onSubmit={submit}
        noValidate
        hidden={folded !== null && !folded.open}
      >
        <div className={styles.field}>
          <label htmlFor={fuelId} className={styles.label}>
            Fuel
          </label>
          {/*
           * Native, not a custom listbox: nine options, and every phone shows
           * its own picker for a native select (see docs/decisions.md).
           */}
          <select
            id={fuelId}
            className={styles.select}
            value={fuel}
            onChange={(event) => {
              changeFuel(event.target.value);
            }}
          >
            {fuelOptions}
          </select>
        </div>
        {/*
         * A native select, like the fuel: four distances, each one a real
         * choice, and no slider to drag 1 km at a time with a thumb or arrow
         * keys. Applies at once, like the fuel, and is kept in the URL.
         */}
        <div className={styles.field}>
          <label htmlFor={radiusId} className={styles.label}>
            Within
          </label>
          <select
            id={radiusId}
            className={styles.select}
            value={radius}
            onChange={(event) => {
              onRadiusChange(Number(event.target.value));
            }}
          >
            {RADIUS_STEPS.map((step) => (
              <option key={step} value={step}>
                {step} km
              </option>
            ))}
          </select>
        </div>

        <div className={styles.place}>
          <PlaceCombobox
            value={typed}
            onValueChange={(value) => {
              setTyped(value);
              if (value.trim()) setEmpty(false);
            }}
            onSelect={(label) => {
              setEmpty(false);
              onSearchPlace(label);
            }}
            {...(placeInputRef ? { inputRef: placeInputRef } : {})}
          />
        </div>
        <Button type="submit" variant="primary" className={styles.submit}>
          Search
        </Button>
        {empty && (
          <p className={styles.error} role="alert">
            Enter a suburb or postcode, or use your location.
          </p>
        )}

        {/*
         * Not disabled while locating: disabling the focused button would drop
         * keyboard focus to the page. Pressing it again just asks again. What
         * happens to the position is on the privacy page.
         */}
        <Button variant="quiet" className={styles.locate} onClick={onUseLocation}>
          {locating ? 'Finding your location…' : 'Use my location'}
        </Button>
      </form>
    </div>
  );
}
