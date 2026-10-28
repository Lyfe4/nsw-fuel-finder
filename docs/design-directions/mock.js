/* global window, document */
/*
 * Shared by the three direction mockups: a stylised map of the 2250 scene
 * (not real geometry; only the stations' positions are real) and small
 * formatting helpers. Each direction styles the same SVG classes its own way.
 */
(function () {
  const { origin, stations } = window.MOCK;
  const KM_LNG = 1 / 93.0; // degrees of longitude per km at 33.4°S
  const KM_LAT = 1 / 111.0;

  // Fitted to the stations, as the app's map is, not centred on the search.
  const CENTRE = { latitude: -33.418, longitude: 151.333 };

  function projector(width, height, kmAcross) {
    const pxPerKm = width / kmAcross;
    return ([lat, lng]) => [
      width / 2 + ((lng - CENTRE.longitude) / KM_LNG) * pxPerKm,
      height / 2 - ((lat - CENTRE.latitude) / KM_LAT) * pxPerKm,
    ];
  }

  const WATER = [
    [-33.432, 151.328],
    [-33.428, 151.338],
    [-33.436, 151.352],
    [-33.447, 151.362],
    [-33.46, 151.375],
    [-33.5, 151.37],
    [-33.5, 151.28],
    [-33.47, 151.3],
    [-33.452, 151.312],
    [-33.44, 151.318],
  ];
  const PARKS = [
    [
      [-33.36, 151.27],
      [-33.37, 151.31],
      [-33.392, 151.318],
      [-33.402, 151.296],
      [-33.39, 151.27],
    ],
    [
      [-33.442, 151.382],
      [-33.452, 151.4],
      [-33.47, 151.41],
      [-33.468, 151.385],
    ],
    [
      [-33.45, 151.25],
      [-33.452, 151.285],
      [-33.47, 151.29],
      [-33.48, 151.255],
    ],
  ];
  const MOTORWAY = [
    [-33.5, 151.255],
    [-33.465, 151.272],
    [-33.445, 151.283],
    [-33.42, 151.29],
    [-33.395, 151.297],
    [-33.37, 151.31],
    [-33.33, 151.335],
  ];
  const MAJOR = [
    [
      [-33.44, 151.25],
      [-33.437, 151.297],
      [-33.43, 151.312],
      [-33.427, 151.322],
      [-33.425, 151.342],
      [-33.43, 151.36],
      [-33.437, 151.39],
      [-33.44, 151.42],
    ],
    [
      [-33.425, 151.342],
      [-33.414, 151.347],
      [-33.405, 151.352],
      [-33.395, 151.361],
      [-33.383, 151.372],
      [-33.35, 151.39],
    ],
    [
      [-33.427, 151.322],
      [-33.415, 151.324],
      [-33.4, 151.312],
      [-33.385, 151.305],
    ],
  ];
  const MINOR = [
    [
      [-33.41, 151.33],
      [-33.418, 151.338],
      [-33.42, 151.36],
      [-33.415, 151.38],
    ],
    [
      [-33.395, 151.34],
      [-33.405, 151.335],
      [-33.41, 151.318],
    ],
    [
      [-33.43, 151.36],
      [-33.415, 151.37],
      [-33.4, 151.385],
    ],
    [
      [-33.437, 151.297],
      [-33.448, 151.305],
      [-33.458, 151.302],
    ],
    [
      [-33.38, 151.34],
      [-33.39, 151.35],
      [-33.383, 151.372],
    ],
    [
      [-33.44, 151.36],
      [-33.452, 151.352],
    ],
    [
      [-33.415, 151.29],
      [-33.408, 151.275],
      [-33.4, 151.26],
    ],
  ];
  const PLACES = [
    ['GOSFORD', -33.4245, 151.3435, 'town'],
    ['WEST GOSFORD', -33.4215, 151.311, 'suburb'],
    ['WYOMING', -33.4035, 151.3605, 'suburb'],
    ['KARIONG', -33.441, 151.2905, 'suburb'],
    ['LISAROW', -33.3815, 151.3795, 'suburb'],
    ['ERINA', -33.441, 151.394, 'suburb'],
    ['NARARA', -33.394, 151.341, 'suburb'],
  ];

  const NS = 'http://www.w3.org/2000/svg';
  const el = (name, attrs, parent) => {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    parent.appendChild(node);
    return node;
  };
  const path = (points, p, close) =>
    points
      .map(
        (pt, i) =>
          `${i ? 'L' : 'M'}${p(pt)
            .map((n) => n.toFixed(1))
            .join(',')}`,
      )
      .join('') + (close ? 'Z' : '');

  /**
   * options.tag: 'board' (dark sign tag), 'docket' (boxed tag) or 'plain'
   * (text on a halo). options.selected: the selected station's name.
   */
  window.drawMap = function drawMap(svg, options) {
    const width = Number(svg.getAttribute('width'));
    const height = Number(svg.getAttribute('height'));
    const p = projector(width, height, options.kmAcross ?? 9);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    el('rect', { class: 'land', width, height }, svg);
    if (options.waterPattern) svg.insertAdjacentHTML('afterbegin', options.waterPattern);
    for (const park of PARKS) el('path', { class: 'park', d: path(park, p, true) }, svg);
    el('path', { class: 'water', d: path(WATER, p, true) }, svg);
    if (options.waterlines) {
      // Atlas "waterlining": rings inside the shore, as MapLibre line-offset would draw them.
      const clip = el('clipPath', { id: 'water-clip' }, svg);
      el('path', { d: path(WATER, p, true) }, clip);
      const rings = el('g', { 'clip-path': 'url(#water-clip)' }, svg);
      for (const [cls, width] of [
        ['waterline', 22],
        ['water-gap', 19],
        ['waterline', 13],
        ['water-gap', 11],
        ['waterline', 6],
        ['water-gap', 4.5],
        ['shore', 2],
      ])
        el('path', { class: cls, d: path(WATER, p, true), 'stroke-width': width }, rings);
    }
    for (const road of MINOR) el('path', { class: 'road-minor', d: path(road, p) }, svg);
    for (const road of MAJOR) el('path', { class: 'road-major-casing', d: path(road, p) }, svg);
    for (const road of MAJOR) el('path', { class: 'road-major', d: path(road, p) }, svg);
    el('path', { class: 'road-motorway-casing', d: path(MOTORWAY, p) }, svg);
    el('path', { class: 'road-motorway', d: path(MOTORWAY, p) }, svg);
    const shieldAt = p([-33.418, 151.2905]);
    const shield = el(
      'g',
      { class: 'shield', transform: `translate(${shieldAt[0]},${shieldAt[1]})` },
      svg,
    );
    el('rect', { x: -13, y: -9, width: 26, height: 18, rx: 2 }, shield);
    el('text', { x: 0, y: 4.5, 'text-anchor': 'middle' }, shield).textContent = 'M1';
    const waterLabel = p([-33.462, 151.33]);
    el(
      'text',
      { class: 'water-label', x: waterLabel[0], y: waterLabel[1], 'text-anchor': 'middle' },
      svg,
    ).textContent = 'Brisbane Water';
    for (const [name, lat, lng, kind] of PLACES) {
      const [x, y] = p([lat, lng]);
      el('text', { class: `place-label ${kind}`, x, y, 'text-anchor': 'middle' }, svg).textContent =
        name;
    }

    const [ox, oy] = p([origin.latitude, origin.longitude]);
    el('circle', { class: 'origin-ring', cx: ox, cy: oy, r: 9 }, svg);
    el('circle', { class: 'origin-dot', cx: ox, cy: oy, r: 2.5 }, svg);

    const tags = el('g', {}, svg);
    const dots = el('g', {}, svg);
    const placed = [];
    const overlaps = (box) =>
      placed.some(
        (b) => box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y,
      );
    const shown = stations.filter((s) => {
      const [x, y] = p([s.lat, s.lng]);
      return x > 6 && x < width - 6 && y > 6 && y < height - 6;
    });
    for (const s of shown) {
      const [x, y] = p([s.lat, s.lng]);
      placed.push({ x: x - 6, y: y - 6, w: 12, h: 12 });
    }
    // Cheapest first, so the cheapest keep their labels (as in the app).
    for (const s of shown) {
      const [x, y] = p([s.lat, s.lng]);
      const selected = s.name === options.selected;
      el(
        'circle',
        {
          class: `dot ${s.band}${selected ? ' selected' : ''}`,
          cx: x,
          cy: y,
          r: selected ? 7 : 5.5,
        },
        dots,
      );
      const cheapest = s.price === stations[0].price;
      const label =
        cheapest && options.cheapestWord
          ? `${options.cheapestWord} ${s.price.toFixed(1)}`
          : s.price.toFixed(1);
      const g = el(
        'g',
        { class: `tag ${s.band}${cheapest ? ' cheapest' : ''}${selected ? ' selected' : ''}` },
        tags,
      );
      const rect = el('rect', {}, g);
      const text = el('text', { x: x + 11, y: y + 4.5 }, g);
      if (cheapest && options.cheapestWord && options.splitCheapest) {
        el('tspan', { class: 'word' }, text).textContent = `${options.cheapestWord} `;
        el('tspan', {}, text).textContent = s.price.toFixed(1);
      } else {
        text.textContent = label;
      }
      const w = text.getComputedTextLength();
      const padX = options.tag === 'plain' ? 0 : 4;
      const box = { x: x + 11 - padX, y: y - 8, w: w + padX * 2, h: 17 };
      let moved = box;
      if (overlaps(box) && !cheapest) {
        moved = { ...box, x: x - 11 - w - padX };
        if (overlaps(moved)) {
          g.remove();
          continue;
        }
        text.setAttribute('x', String(x - 11 - w));
      }
      placed.push(moved);
      Object.entries({ x: moved.x, y: moved.y, width: moved.w, height: moved.h }).forEach(
        ([k, v]) => rect.setAttribute(k, String(v)),
      );
    }
  };

  /** Compass point from the search centre: "SW". */
  window.bearing = (s) => {
    const dx = (s.lng - origin.longitude) / KM_LNG;
    const dy = (s.lat - origin.latitude) / KM_LAT;
    const deg = (Math.atan2(dx, dy) * 180) / Math.PI + 360;
    return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
  };

  /** "57 CENTRAL COAST HWY, WEST GOSFORD NSW 2250" -> "West Gosford" */
  window.locality = (address) => {
    const part = address
      .split(',')
      .pop()
      .replace(/\s+(NSW|ACT)\s+\d{4}$/i, '')
      .trim();
    return part.toLowerCase().replace(/(^|\s)([a-z])/g, (m, a, b) => a + b.toUpperCase());
  };

  window.ageText = (hours) =>
    hours < 1
      ? 'just now'
      : hours < 48
        ? `${hours} hours ago`
        : `${Math.round(hours / 24)} days ago`;

  /** "57 CENTRAL COAST HWY, WEST GOSFORD NSW 2250" -> "57 Central Coast Hwy, West Gosford" */
  window.shortAddress = (address) => {
    const trimmed = address.replace(/\s+(NSW|ACT|QLD|SA|VIC)\s+\d{4}$/i, '');
    if (trimmed !== trimmed.toUpperCase()) return trimmed;
    return trimmed.toLowerCase().replace(/(^|[\s,-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  };
})();
