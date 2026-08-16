import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { PieChart, calculatePieSegments } from '../plugins/stats/web-src/components/PieChart';

const data = [
  { id: 'large', label: 'Large', value: 60, valueLabel: '60' },
  { id: 'medium', label: 'Medium', value: 30, valueLabel: '30' },
  { id: 'small', label: 'Small', value: 10, valueLabel: '10' },
];

describe('PieChart', () => {
  it('calculates each share against the total and closes exactly at 100 percent', () => {
    const segments = calculatePieSegments(data);
    expect(segments.map((segment) => segment.percentage)).toEqual([60, 30, 10]);
    expect(segments.reduce((sum, segment) => sum + segment.percentage, 0)).toBeCloseTo(100, 10);
    expect(segments.map((segment) => segment.dashOffset)).toEqual([-0, -60, -90]);
  });

  it('ignores non-positive values instead of diluting visible percentages', () => {
    const segments = calculatePieSegments([...data, { id: 'none', label: 'None', value: 0, valueLabel: '0' }]);
    expect(segments).toHaveLength(3);
    expect(segments.reduce((sum, segment) => sum + segment.percentage, 0)).toBeCloseTo(100, 10);
  });

  it('renders a value-bearing legend so the chart is understandable without color', () => {
    render(<PieChart title="Token distribution" data={data} emptyText="No data" />);
    const figure = screen.getByRole('figure', { name: 'Token distribution' });
    expect(within(figure).getByText('60.0% · 60')).toBeTruthy();
    expect(within(figure).getByText('30.0% · 30')).toBeTruthy();
    expect(within(figure).getByText('10.0% · 10')).toBeTruthy();
  });
});
