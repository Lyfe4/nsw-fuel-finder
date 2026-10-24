import type { LatLng } from '../../shared/geo';

/**
 * iPhone, iPad and iPod. iPadOS asks for desktop sites and says "Macintosh",
 * so a Mac that reports touch points is an iPad; a real Mac has none.
 */
function isAppleMobile(userAgent: string, maxTouchPoints: number): boolean {
  return (
    /iPhone|iPad|iPod/.test(userAgent) || (userAgent.includes('Macintosh') && maxTouchPoints > 1)
  );
}

/**
 * Driving directions to a station, in the maps app the device already has.
 *
 * - On iOS and iPadOS, Apple Maps: maps.apple.com links open the Maps app.
 * - Everywhere else, Google's universal directions URL, which opens the
 *   Google Maps app on Android (and wherever it is installed) and Google
 *   Maps on the web otherwise.
 *
 * By coordinates, not the address: FuelCheck's addresses are sometimes a
 * highway and a town, which a maps app can resolve to the wrong place. The
 * destination is the station; the start is wherever the app says you are,
 * so our page never passes the user's position on.
 */
export function directionsUrl(
  { latitude, longitude }: LatLng,
  device: { userAgent: string; maxTouchPoints: number } = navigator,
): string {
  const point = `${String(latitude)},${String(longitude)}`;
  return isAppleMobile(device.userAgent, device.maxTouchPoints)
    ? `https://maps.apple.com/?daddr=${point}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${point}&travelmode=driving`;
}
