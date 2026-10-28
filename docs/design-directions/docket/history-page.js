/* global window, document */
// Fills a history view: the summary, the chart and readout, every fuel here.
window.fillHistory = function fillHistory(root = document) {
  const FUELS = [
    ['U91', 'Unleaded 91'],
    ['E10', 'Ethanol 94'],
    ['P95', 'Premium 95'],
    ['P98', 'Premium 98'],
    ['PDL', 'Premium Diesel'],
  ];
  const AGES = {
    U91: '21 hours ago',
    E10: '12 hours ago',
    P95: '4 days ago',
    P98: '4 days ago',
    PDL: '12 hours ago',
  };
  root.querySelector('#story').textContent = window.historySummary();
  const chart = root.querySelector('#chart');
  const days = window.MOCK_HISTORY.days;
  const cursor = days.findIndex(([day]) => day === '2026-09-18');
  const r = window.drawChart(chart, cursor);
  root.querySelector('#readout').innerHTML =
    `<span>${r.day}</span><span>low ${r.low.toFixed(1)} · high ${r.high.toFixed(1)} · last <b>${r.last.toFixed(1)}</b></span>`;
  const prices = window.MOCK_HISTORY.station.prices;
  root.querySelector('#fuels').innerHTML = FUELS.filter(([code]) => prices[code])
    .map(
      ([code, name]) =>
        `<div class="line item${code === 'U91' ? ' this' : ''}"><span class="fname">${name}</span><span class="lead" aria-hidden="true"></span><span class="amount">${prices[code].priceCents.toFixed(1)}</span><span class="when">${AGES[code]}</span></div>`,
    )
    .join('');
};
