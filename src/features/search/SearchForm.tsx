import { useId, useState, type SubmitEvent, type Ref } from 'react';

import { Button } from '@/components/Button/Button';

import { PlaceCombobox } from './PlaceCombobox';
import styles from './SearchForm.module.css';
import { FUEL_TYPES, isFuelTypeCode, type FuelTypeCode } from '../../../shared/fuelTypes';

export interface SearchFormProps {
  fuel: FuelTypeCode;
  currentQuery: string;
  locating: boolean;
  onFuelChange: (fuel: FuelTypeCode) => void;
  onSearchPlace: (query: string) => void;
  onUseLocation: () => void;
  placeInputRef?: Ref<HTMLInputElement>;
}

export function SearchForm({
  fuel,
  currentQuery,
  locating,
  onFuelChange,
  onSearchPlace,
  onUseLocation,
  placeInputRef,
}: SearchFormProps) {
  const fuelId = useId();
  const locationNoteId = useId();
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

  return (
    <form
      role="search"
      aria-label="Fuel prices"
      className={styles.form}
      onSubmit={submit}
      noValidate
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
            if (isFuelTypeCode(event.target.value)) onFuelChange(event.target.value);
          }}
        >
          {FUEL_TYPES.map(({ code, name }) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.placeRow}>
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
        <Button type="submit" variant="primary" className={styles.submit}>
          Search
        </Button>
      </div>
      {empty && (
        <p className={styles.error} role="alert">
          Enter a suburb or postcode, or use your location.
        </p>
      )}

      <div className={styles.or}>
        <span aria-hidden="true">or</span>
        {/*
         * Not disabled while locating: disabling the focused button would drop
         * keyboard focus to the page. Pressing it again just asks again.
         */}
        <Button onClick={onUseLocation} aria-describedby={locationNoteId}>
          {locating ? 'Finding your location…' : 'Use my location'}
        </Button>
        <span id={locationNoteId} className={styles.note}>
          Only used to find stations near you; never stored.
        </span>
      </div>
    </form>
  );
}
