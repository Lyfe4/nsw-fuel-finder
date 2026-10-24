import { useCombobox } from 'downshift';
import { useId, type Ref } from 'react';

import { VisuallyHidden } from '@/components/VisuallyHidden/VisuallyHidden';

import styles from './PlaceCombobox.module.css';
import { usePlaceSuggestions } from './usePlaceSuggestions';

export interface PlaceComboboxProps {
  value: string;
  onValueChange: (value: string) => void;
  /** A suggestion was chosen. Typed text is submitted by the surrounding form. */
  onSelect: (label: string) => void;
  inputRef?: Ref<HTMLInputElement>;
}

/**
 * Suburb or postcode, with suggestions from /api/places: the WAI-ARIA 1.2
 * combobox pattern, implemented by Downshift's useCombobox (focus stays in
 * the input; arrow keys move aria-activedescendant through the listbox; Enter
 * picks the highlighted suggestion; Escape closes, then clears).
 *
 * Typing a place and pressing Enter without choosing a suggestion is just as
 * valid: the API resolves free text, so the suggestions help, never gate.
 */
export function PlaceCombobox({ value, onValueChange, onSelect, inputRef }: PlaceComboboxProps) {
  const hintId = useId();
  const inputId = useId();
  const suggestions = usePlaceSuggestions(value);

  const {
    isOpen,
    highlightedIndex,
    closeMenu,
    getLabelProps,
    getMenuProps,
    getInputProps,
    getItemProps,
  } = useCombobox<string>({
    inputId,
    items: suggestions,
    inputValue: value,
    // Controlled as "nothing selected", so choosing the same place twice
    // still searches twice.
    selectedItem: null,
    itemToString: (item) => item ?? '',
    onInputValueChange: ({ inputValue: next }) => {
      onValueChange(next);
    },
    onSelectedItemChange: ({ selectedItem }) => {
      if (selectedItem) onSelect(selectedItem);
    },
  });

  const showList = isOpen && suggestions.length > 0;

  return (
    <div className={styles.field}>
      <label className={styles.label} {...getLabelProps()} htmlFor={inputId}>
        Suburb or postcode
      </label>
      <p id={hintId} className={styles.hint}>
        For example Erina, Bondi Beach or 2250
      </p>
      <div className={styles.inputWrap}>
        <input
          className={styles.input}
          {...getInputProps({
            ...(inputRef ? { ref: inputRef } : {}),
            onKeyDown: (event) => {
              // Downshift swallows Enter whenever its menu is open, even with
              // nothing highlighted - so typing "Erina" and pressing Enter would
              // do nothing. With no suggestion highlighted, Enter belongs to the
              // form and submits what was typed - and the list closes, or it
              // would sit over the results it just asked for.
              if (event.key === 'Enter' && highlightedIndex < 0) {
                (
                  event.nativeEvent as KeyboardEvent & { preventDownshiftDefault?: boolean }
                ).preventDownshiftDefault = true;
                closeMenu();
              }
            },
            'aria-describedby': hintId,
            autoComplete: 'off',
            autoCapitalize: 'words',
            spellCheck: false,
            enterKeyHint: 'search',
          })}
        />
        {/*
         * Escape clears too (the second press), but nobody on a phone knows
         * that. Only there when there is something to clear; focus goes back to
         * the box, ready to type, since the button itself is about to go.
         */}
        {value !== '' && (
          <button
            type="button"
            className={styles.clear}
            aria-label="Clear suburb or postcode"
            onClick={() => {
              document.getElementById(inputId)?.focus();
              closeMenu();
              onValueChange('');
            }}
          >
            <span aria-hidden="true">×</span>
          </button>
        )}
      </div>
      <ul className={showList ? styles.list : styles.listClosed} {...getMenuProps()}>
        {showList &&
          suggestions.map((item, index) => (
            <li
              key={item}
              className={index === highlightedIndex ? styles.optionActive : styles.option}
              {...getItemProps({ item, index })}
            >
              {item}
            </li>
          ))}
      </ul>
      {/*
       * Downshift's hooks no longer announce result counts, and the list
       * arrives after the keystroke that asked for it. Polite, so it waits
       * for the screen reader to finish echoing what was typed.
       */}
      <VisuallyHidden role="status">
        {showList
          ? `${String(suggestions.length)} ${suggestions.length === 1 ? 'suggestion' : 'suggestions'}. Use up and down arrows to choose.`
          : ''}
      </VisuallyHidden>
    </div>
  );
}
