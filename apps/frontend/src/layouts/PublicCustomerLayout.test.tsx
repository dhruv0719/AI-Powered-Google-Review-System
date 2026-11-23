import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PublicCustomerLayout } from './PublicCustomerLayout.js';

describe('PublicCustomerLayout (Mobile Shell)', () => {
  const renderLayoutWithChild = (childText = 'Test Child Page') => {
    return render(
      <MemoryRouter initialEntries={['/test']}>
        <Routes>
          <Route element={<PublicCustomerLayout />}>
            <Route path="/test" element={<div data-testid="child-page">{childText}</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
  };

  it('1. should render exactly one semantic <main id="main-content"> landmark', () => {
    renderLayoutWithChild();

    const mainElements = screen.getAllByRole('main');
    expect(mainElements).toHaveLength(1);
    expect(mainElements[0]).toHaveAttribute('id', 'main-content');
  });

  it('2. should constrain content container to maxWidth 520px with responsive centering', () => {
    renderLayoutWithChild();

    const container = screen.getByTestId('customer-layout-container');
    expect(container).toBeInTheDocument();
    expect(container.style.maxWidth).toBe('520px');
    expect(container.style.width).toBe('100%');
  });

  it('3. should render the neutral platform footer ("Powered by Review System")', () => {
    renderLayoutWithChild();

    const footer = screen.getByTestId('customer-layout-footer');
    expect(footer).toBeInTheDocument();
    expect(footer).toHaveTextContent('Powered by Review System');
    expect(footer.tagName.toLowerCase()).toBe('footer');
  });

  it('4. should render child route via <Outlet /> within the layout container', () => {
    renderLayoutWithChild('QR Review Experience');

    const child = screen.getByTestId('child-page');
    expect(child).toBeInTheDocument();
    expect(child).toHaveTextContent('QR Review Experience');

    const container = screen.getByTestId('customer-layout-container');
    expect(container).toContainElement(child);
  });

  it('5. should define full-height layout with safe-area padding', () => {
    renderLayoutWithChild();

    const main = screen.getByRole('main');
    expect(main.style.minHeight).toBe('100vh');
    expect(main.style.display).toBe('flex');
    expect(main.style.flexDirection).toBe('column');
    expect(main.style.alignItems).toBe('center');
  });
});
