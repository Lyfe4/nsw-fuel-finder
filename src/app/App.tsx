import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { SearchScreen } from '@/features/search/SearchScreen';
import { ThemeSelect } from '@/features/theme/ThemeSelect';
import { useApplyTheme } from '@/features/theme/useTheme';

import styles from './App.module.css';
import { createQueryClient } from './queryClient';

/**
 * The application shell: providers, page landmarks and attribution. The
 * screen itself is SearchScreen.
 */
export function App({ queryClient }: { queryClient?: QueryClient }) {
  const [client] = useState(() => queryClient ?? createQueryClient());
  useApplyTheme();

  return (
    <QueryClientProvider client={client}>
      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.titles}>
            <h1 className={styles.title}>NSW Fuel Finder</h1>
            <p className={styles.tagline}>Live fuel prices near you, cheapest first.</p>
          </div>
          <ThemeSelect />
        </header>
        <main className={styles.main}>
          <SearchScreen />
        </main>
        <footer className={styles.footer}>
          <p>
            Fuel prices from{' '}
            <a href="https://www.fuelcheck.nsw.gov.au/">NSW Government FuelCheck</a>, refreshed
            every 30 minutes.
          </p>
          <p>
            Price history before 23 October 2026 from{' '}
            <a href="https://data.nsw.gov.au/data/dataset/fuel-check">
              NSW FuelCheck price history
            </a>{' '}
            (NSW Fair Trading), used under{' '}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA</a>. Our daily low,
            high and last prices made from it are shared under the same licence.
          </p>
          <p>
            Suburb and postcode locations based on{' '}
            <a href="https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs-edition-3">
              Australian Bureau of Statistics ASGS Edition 3 (2021)
            </a>{' '}
            data, used under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.
          </p>
          <p>
            Map tiles from <a href="https://openfreemap.org/">OpenFreeMap</a>, map data ©{' '}
            <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors.
          </p>
        </footer>
      </div>
    </QueryClientProvider>
  );
}
