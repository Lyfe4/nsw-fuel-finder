import { describe, expect, it } from 'vitest';

import { directionsUrl } from './directions';

const GOSFORD = { latitude: -33.4245, longitude: 151.3419 };
const APPLE = 'https://maps.apple.com/?daddr=-33.4245,151.3419&dirflg=d';
const GOOGLE =
  'https://www.google.com/maps/dir/?api=1&destination=-33.4245,151.3419&travelmode=driving';

describe('directions', () => {
  it.each([
    [
      'an iPhone',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      5,
      APPLE,
    ],
    [
      'an iPad asking for the desktop site (it says Macintosh, with touch)',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15',
      5,
      APPLE,
    ],
    [
      'a Mac (Macintosh, no touch)',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15',
      0,
      GOOGLE,
    ],
    [
      'an Android phone',
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36',
      5,
      GOOGLE,
    ],
    [
      'Windows',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36',
      0,
      GOOGLE,
    ],
  ])('on %s, open the right maps app', (_, userAgent, maxTouchPoints, expected) => {
    expect(directionsUrl(GOSFORD, { userAgent, maxTouchPoints })).toBe(expected);
  });
});
