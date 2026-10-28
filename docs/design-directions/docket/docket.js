/* global window, document */
/*
 * Builds the Docket mockups' station rows and price chart from the
 * screenshot fixtures. Decorative characters (leaders, arrows, the star)
 * are aria-hidden, as they will be in the app.
 */
(function () {
  const { stations } = window.MOCK;
  const cheapest = stations[0].price;

  window.stationRows = function stationRows(list, count, options = {}) {
    stations.slice(0, count).forEach((s, i) => {
      const age = i === 1 ? 16 * 24 : s.ageH; // the second row aged to show an old price
      const old = age >= 14 * 24;
      const isCheapest = s.price === cheapest;
      const li = document.createElement('li');
      li.className = `station${isCheapest ? ' cheapest' : ''}`;
      const side = isCheapest
        ? '<span class="flag" aria-hidden="true">Cheapest</span>'
        : s.change
          ? `<span class="change"><span aria-hidden="true">↓ ${Math.abs(s.change).toFixed(1)} today</span><span class="vh">down ${Math.abs(s.change).toFixed(1)} cents a litre since yesterday</span></span>`
          : '';
      li.innerHTML = `
        <div class="line"><h3 class="name"><a href="#">${s.name}</a></h3><span class="lead" aria-hidden="true"></span><span class="amount">${s.price.toFixed(1)}</span><span class="vh"> cents a litre${isCheapest ? ', cheapest' : ''}</span></div>
        <p class="sub"><span>${s.brand} · ${s.km.toFixed(1)} km · ${old ? `<strong class="old">Old price, ${window.ageText(age)}</strong>` : window.ageText(age)}</span>${side}</p>
        <p class="addr">${window.shortAddress(s.address)}</p>
        <div class="acts"><button>Show on map<span class="vh">, ${s.name}</span></button><a href="#">Directions<span aria-hidden="true"> ↗</span></a><button><span aria-hidden="true">☆ </span>Favourite</button></div>`;
      if (options.selected === s.name) li.classList.add('selected');
      list.appendChild(li);
    });
  };

  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTH = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'June',
    'July',
    'Aug',
    'Sept',
    'Oct',
    'Nov',
    'Dec',
  ];
  const formatDay = (iso) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return `${DAY[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
  };

  window.historySummary = function historySummary() {
    const { days } = window.MOCK_HISTORY;
    let low = days[0];
    let high = days[0];
    for (const d of days) {
      if (d[1] < low[1]) low = d;
      if (d[2] > high[2]) high = d;
    }
    return `Lowest in the last ${days.length} days: ${low[1].toFixed(1)} cents a litre on ${formatDay(low[0])}. Highest: ${high[2].toFixed(1)} on ${formatDay(high[0])}.`;
  };

  /** A thermal-print chart: ink trace, low-high band, dotted cursor. */
  window.drawChart = function drawChart(svg, cursorIndex) {
    const NS = 'http://www.w3.org/2000/svg';
    const add = (name, attrs, text) => {
      const node = document.createElementNS(NS, name);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
      if (text !== undefined) node.textContent = text;
      svg.appendChild(node);
      return node;
    };
    const { days } = window.MOCK_HISTORY;
    const width = Number(svg.getAttribute('width'));
    const height = Number(svg.getAttribute('height'));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const left = 34;
    const right = width - 44;
    const top = 8;
    const bottom = height - 22;
    const [min, max] = [140, 250];
    const x = (i) => left + (i / (days.length - 1)) * (right - left);
    const y = (v) => bottom - ((v - min) / (max - min)) * (bottom - top);
    for (let v = 160; v <= 240; v += 40) {
      add('line', { class: 'grid', x1: left, x2: right, y1: y(v), y2: y(v) });
      add('text', { class: 'axis', x: left - 6, y: y(v) + 4, 'text-anchor': 'end' }, v);
    }
    days.forEach(([day], i) => {
      if (day.endsWith('-01')) {
        const month = MONTH[Number(day.slice(5, 7)) - 1];
        add('text', { class: 'axis', x: x(i), y: height - 6 }, month);
      }
    });
    const band =
      days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[2]).toFixed(1)}`).join('') +
      [...days]
        .reverse()
        .map((d, j) => `L${x(days.length - 1 - j).toFixed(1)},${y(d[1]).toFixed(1)}`)
        .join('') +
      'Z';
    add('path', { class: 'band', d: band });
    add('path', {
      class: 'trace',
      d: days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[3]).toFixed(1)}`).join(''),
    });
    const last = days.at(-1);
    add('text', { class: 'endlabel', x: right + 6, y: y(last[3]) + 4 }, last[3].toFixed(1));
    const c = days[cursorIndex];
    add('line', { class: 'cursor', x1: x(cursorIndex), x2: x(cursorIndex), y1: top, y2: bottom });
    add('circle', { class: 'cursor-dot', cx: x(cursorIndex), cy: y(c[3]), r: 3.5 });
    return { day: formatDay(c[0]), low: c[1], high: c[2], last: c[3] };
  };
})();
