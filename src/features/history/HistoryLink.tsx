import { createContext, use, type MouseEvent, type ReactNode } from 'react';

import { VisuallyHidden } from '@/components/VisuallyHidden/VisuallyHidden';

interface HistoryLinks {
  href: (code: string) => string;
  open: (code: string) => void;
}

/**
 * How to reach a station's price history, given by SearchScreen (which owns
 * the URL) to the list, the map's card and the favourites, without passing it
 * through every component in between.
 */
export const HistoryLinkContext = createContext<HistoryLinks | null>(null);

const HINT_ID = 'history-link-hint';

/**
 * Rendered once, by whoever provides the context: the description every
 * history link points at.
 */
export function HistoryLinkHint() {
  return <VisuallyHidden id={HINT_ID}>Opens its price history</VisuallyHidden>;
}

/**
 * A station's name as a link to its price history. A real link, so it can
 * be opened in a new tab or copied; an ordinary click is handled here, to
 * open the view without reloading the page.
 *
 * The link's name is just the station's: it sits inside the station's
 * heading, and anything added to it would be read as part of every heading.
 * Where it goes is its description ("Metro Gosford, link, opens its price
 * history"), so the purpose is still announced.
 */
export function HistoryLink({
  code,
  className,
  children,
}: {
  code: string;
  className?: string | undefined;
  children: ReactNode;
}) {
  const links = use(HistoryLinkContext);
  if (!links) return <>{children}</>;
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    links.open(code);
  };
  return (
    <a
      className={className}
      href={links.href(code)}
      onClick={onClick}
      aria-describedby={HINT_ID}
      data-history-link={code}
    >
      {children}
    </a>
  );
}
