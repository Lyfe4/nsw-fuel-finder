import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App';

describe('App', () => {
  it('renders the page heading', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: 'Fuel Finder' })).toBeInTheDocument();
  });

  // That public/privacy.html exists is checked in netlify/lib/securityHeaders.test.ts.
  it('links to the privacy note', () => {
    render(<App />);

    const link = screen.getByRole('link', { name: 'Privacy' });
    expect(link).toHaveAttribute('href', '/privacy.html');
  });
});
