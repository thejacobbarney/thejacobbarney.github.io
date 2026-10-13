import { round } from './stats.js';

/**
 * Minimal dependency-free SVG line chart. Takes real {date, value} points
 * (no interpolation/fabrication for missing days — gaps just aren't drawn)
 * and renders a smoothed polyline with a soft area fill underneath, matching
 * the brand's teal/mint palette. Returns '' if there's nothing to plot.
 */
export function renderLineChart(points, { width = 600, height = 160, color = '#14b8a6', fill = true, padding = 8 } = {}) {
  const clean = points.filter((p) => p.value !== null && p.value !== undefined && !Number.isNaN(p.value));
  if (clean.length < 2) return '';

  const values = clean.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const stepX = innerW / (clean.length - 1);

  const coords = clean.map((p, i) => {
    const x = padding + i * stepX;
    const y = padding + innerH - ((p.value - min) / range) * innerH;
    return [round(x, 2), round(y, 2)];
  });

  const linePath = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ');
  const areaPath = `${linePath} L${coords[coords.length - 1][0]},${height - padding} L${coords[0][0]},${height - padding} Z`;

  const gradId = `chartFill${Math.random().toString(36).slice(2, 8)}`;

  return `<svg class="trend-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    ${
      fill
        ? `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${color}" stop-opacity="0.28"/>
            <stop offset="1" stop-color="${color}" stop-opacity="0"/>
          </linearGradient></defs>
          <path d="${areaPath}" fill="url(#${gradId})" stroke="none"/>`
        : ''
    }
    <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
