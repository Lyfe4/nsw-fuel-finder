/* global window, document */
// Stamps the shared templates into each screen, the rows, and the history.
window.fillScreens = function fillScreens(rowCount) {
  for (const slot of document.querySelectorAll('[data-use]')) {
    const template = document.getElementById(slot.dataset.use);
    slot.replaceWith(template.content.cloneNode(true));
  }
  for (const list of document.querySelectorAll('ol.rows')) {
    const open = list.dataset.open === undefined ? -1 : Number(list.dataset.open);
    window.minimalRows(list, rowCount, open);
    const asof = document.createElement('p');
    asof.className = 'asof';
    asof.textContent = 'Unleaded 91 prices as of 6:00 pm, from FuelCheck.';
    list.after(asof);
  }
};

window.fillHistory = function fillHistory() {
  for (const view of document.querySelectorAll('.hist')) {
    view.querySelector('.story').textContent = window.historySummary();
    const days = window.MOCK_HISTORY.days;
    const cursor = days.findIndex(([day]) => day === '2026-09-18');
    const r = window.drawChart(view.querySelector('.chart'), cursor);
    view.querySelector('.readout').innerHTML =
      `<span>${r.day}</span><span>low ${r.low.toFixed(1)} · high ${r.high.toFixed(1)} · last <b>${r.last.toFixed(1)}</b></span>`;
  }
};
