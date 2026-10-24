import { Button } from '@/components/Button/Button';
import type { ApiRequestError } from '@/lib/api';

import styles from './Notices.module.css';
import { whichPlace, type LocationProblem } from './view';

import type { ReactNode } from 'react';

/**
 * A problem the user should hear about now. role="alert" announces the
 * message the moment it appears; the actions follow it, outside the alert, so
 * the announcement is the sentence, not a list of buttons.
 */
function Problem({ message, children }: { message: ReactNode; children?: ReactNode }) {
  return (
    <div className={styles.problem}>
      <p role="alert">{message}</p>
      {children && <div className={styles.actions}>{children}</div>}
    </div>
  );
}

const LOCATION_MESSAGES: Record<LocationProblem, string> = {
  denied:
    'Location is blocked for this site. Search by suburb or postcode instead, or allow location in your browser’s site settings.',
  unavailable: 'Your device couldn’t work out where you are. Search by suburb or postcode instead.',
  timeout: 'Finding your location took too long. Try again, or search by suburb or postcode.',
  unsupported: 'This browser can’t share your location. Search by suburb or postcode instead.',
};

export function LocationProblemNotice({
  problem,
  onRetry,
  onSearchInstead,
}: {
  problem: LocationProblem;
  onRetry: () => void;
  onSearchInstead: () => void;
}) {
  return (
    <Problem message={LOCATION_MESSAGES[problem]}>
      <Button variant="primary" onClick={onSearchInstead}>
        Search by suburb or postcode
      </Button>
      {(problem === 'timeout' || problem === 'unavailable') && (
        <Button onClick={onRetry}>Try location again</Button>
      )}
    </Problem>
  );
}

export function ErrorNotice({
  error,
  onRetry,
  onPick,
  onSearchInstead,
}: {
  error: ApiRequestError;
  onRetry: () => void;
  onPick: (candidate: string) => void;
  onSearchInstead: () => void;
}) {
  switch (error.code) {
    case 'ambiguous_location':
      /*
       * Not a problem: the search worked and found more than one place.
       * Styled as a question, and announced politely by the results status
       * region (see announcement() in view.ts), not as an alert.
       */
      return (
        <div className={styles.question}>
          <p>{whichPlace(error)}</p>
          <ul className={styles.candidates}>
            {error.candidates.map((candidate) => (
              <li key={candidate}>
                <Button onClick={() => onPick(candidate)}>{candidate}</Button>
              </li>
            ))}
          </ul>
        </div>
      );
    case 'location_not_found':
      return (
        <Problem message={`${error.message} Check the spelling, or try a postcode.`}>
          <Button onClick={onSearchInstead}>Change the search</Button>
        </Problem>
      );
    case 'bad_request':
      // Most often "That location is outside NSW." from a nearby search.
      return (
        <Problem message={`${error.message} Fuel Finder covers NSW and the ACT.`}>
          <Button onClick={onSearchInstead}>Search by suburb or postcode</Button>
        </Problem>
      );
    case 'snapshot_unavailable':
      return (
        <Problem message="Fuel prices aren’t available right now. Please try again in a minute.">
          <Button onClick={onRetry}>Try again</Button>
        </Problem>
      );
    case 'rate_limited':
      return (
        <Problem message="A lot of searches are coming from your network right now. Please wait a minute and try again.">
          <Button onClick={onRetry}>Try again</Button>
        </Problem>
      );
    case 'network':
      return (
        <Problem message="Couldn’t connect. Check your internet connection and try again.">
          <Button onClick={onRetry}>Try again</Button>
        </Problem>
      );
    default:
      return (
        <Problem message="Something went wrong loading prices.">
          <Button onClick={onRetry}>Try again</Button>
        </Problem>
      );
  }
}

/** Not an error: the snapshot is old but still the best answer there is. */
export function StaleNotice({ age }: { age: string }) {
  return (
    <p className={styles.stale}>
      <strong>These prices may be out of date.</strong> Our last update from FuelCheck was {age}.
    </p>
  );
}
