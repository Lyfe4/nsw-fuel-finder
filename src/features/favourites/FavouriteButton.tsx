import { Button } from '@/components/Button/Button';
import { VisuallyHidden } from '@/components/VisuallyHidden/VisuallyHidden';

import styles from './FavouriteButton.module.css';
import { useFavourites } from './useFavourites';

/**
 * A toggle button: "Favourite, Metro Gosford", pressed or not. The name stays
 * the same either way and aria-pressed carries the state, as a toggle's
 * should; "Add Metro Gosford to favourites" would be read out as "Add ... ,
 * pressed" once added, which says the opposite. The star is decoration; the
 * word is the label, so speech input users can say what they see.
 */
export function FavouriteButton({ code, name }: { code: string; name: string }) {
  const { favourites, toggleFavourite } = useFavourites();
  const saved = favourites.some((favourite) => favourite.code === code);
  return (
    <Button
      variant="quiet"
      className={styles.button}
      aria-pressed={saved}
      onClick={() => {
        toggleFavourite({ code, name });
      }}
    >
      <span aria-hidden="true" className={saved ? styles.starOn : styles.star}>
        {saved ? '★' : '☆'}
      </span>
      Favourite<VisuallyHidden>, {name}</VisuallyHidden>
    </Button>
  );
}
