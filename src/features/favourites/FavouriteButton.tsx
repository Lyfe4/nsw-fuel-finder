import { useState } from 'react';

import { Button } from '@/components/Button/Button';
import { VisuallyHidden } from '@/components/VisuallyHidden/VisuallyHidden';

import styles from './FavouriteButton.module.css';
import { MAX_FAVOURITES } from './favourites';
import { useFavourites } from './useFavourites';

/**
 * A toggle button: "Favourite, Metro Gosford", pressed or not. The name stays
 * the same either way and aria-pressed carries the state, as a toggle's
 * should; "Add Metro Gosford to favourites" would be read out as "Add ... ,
 * pressed" once added, which says the opposite. The star is decoration; the
 * word is the label, so speech input users can say what they see.
 *
 * Saving one gives the star a short pop, so the press visibly did something.
 * Only after a press here: stars already saved when the list appears stay
 * still.
 *
 * At MAX_FAVOURITES a press cannot add one, so it says why (an alert: the
 * press failed) rather than doing nothing. The button stays enabled: a
 * disabled one would explain nothing, and drop out of the Tab order.
 */
export function FavouriteButton({ code, name }: { code: string; name: string }) {
  const { favourites, toggleFavourite } = useFavourites();
  const [pressed, setPressed] = useState(false);
  const [full, setFull] = useState(false);
  const saved = favourites.some((favourite) => favourite.code === code);
  // Gone again once there is room, or once this station is saved some other way.
  const showFull = full && !saved && favourites.length >= MAX_FAVOURITES;
  const starClass = saved ? (pressed ? styles.starPop : styles.starOn) : styles.star;
  return (
    <>
      <Button
        variant="quiet"
        className={styles.button}
        aria-pressed={saved}
        onClick={() => {
          setPressed(true);
          setFull(!toggleFavourite({ code, name }));
        }}
      >
        <span aria-hidden="true" className={starClass}>
          {saved ? '★' : '☆'}
        </span>
        Favourite<VisuallyHidden>, {name}</VisuallyHidden>
      </Button>
      {showFull && (
        <p role="alert" className={styles.full}>
          You already have {MAX_FAVOURITES} favourites, the most this device keeps. Remove one to
          add this station.
        </p>
      )}
    </>
  );
}
