# NSW Fuel Finder

Live NSW fuel prices near you, sorted cheapest first for the fuel you use.

**Work in progress.** The live-data counterpart to
[Patchbay](https://github.com/Lyfe4/toolbox), a fully offline developer toolbox.

## Data

- Fuel prices: [NSW Government FuelCheck](https://www.fuelcheck.nsw.gov.au/), via
  the API.NSW Fuel API, refreshed every 30 minutes.
- Suburb and postcode locations: based on Australian Bureau of Statistics data,
  [ASGS Edition 3](https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs-edition-3)
  (2021) Suburbs and Localities and Postal Areas, used under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Built by
  `scripts/build-gazetteer.js`.
