/**
 * The three directions' proposed palettes, checked with the same maths as
 * src/styles/tokens.test.ts: WCAG contrast for the same pairs, and CIE76 ΔE
 * between the price bands under typical vision and full-severity
 * protanopia, deuteranopia and tritanopia (Machado et al. 2009).
 *
 *   node docs/design-directions/palettes.mjs
 *
 * Proposal only: nothing in src/ reads this. The chosen direction's values
 * move into src/styles/tokens.css in part 2, where the real test checks them.
 */

export const PALETTES = {
  'A. Price Board': {
    light: {
      bg: '#f1efe9',
      surface: '#f8f7f3',
      text: '#1a1915',
      muted: '#5b5850',
      rule: '#d4d0c5',
      borderStrong: '#827d6f',
      accent: '#8a4600',
      onAccent: '#f8f7f3',
      focus: '#1a1915',
      warning: '#8a4600',
      danger: '#a1260d',
      panel: '#151513',
      led: '#f2ede0',
      ledLit: '#ffb224',
      bandLow: '#b25500',
      bandMid: '#77736a',
      bandHigh: '#2f5b8f',
      land: '#ebe8df',
      water: '#c6d0d3',
      green: '#dcdfd2',
    },
    dark: {
      bg: '#11110f',
      surface: '#171714',
      text: '#ece8de',
      muted: '#a39e91',
      rule: '#2e2c27',
      borderStrong: '#7b766a',
      accent: '#ffb224',
      onAccent: '#151513',
      focus: '#ffb224',
      warning: '#ffb224',
      danger: '#ff8a70',
      panel: '#000000',
      led: '#f2ede0',
      ledLit: '#ffb224',
      bandLow: '#ffb224',
      bandMid: '#9a968c',
      bandHigh: '#6f9fe0',
      land: '#171714',
      water: '#0f1b20',
      green: '#1b1e17',
    },
  },
  'B. Road Atlas': {
    light: {
      bg: '#f2ede1',
      surface: '#f7f3ea',
      text: '#1d1b16',
      muted: '#5c5749',
      rule: '#d3cab6',
      borderStrong: '#857c6a',
      accent: '#1b4d87',
      onAccent: '#f7f3ea',
      focus: '#1b4d87',
      warning: '#8c4a0b',
      danger: '#a32a1a',
      bandLow: '#1b4d87',
      bandMid: '#76705f',
      bandHigh: '#a3560e',
      land: '#efe9db',
      water: '#bcd2dc',
      green: '#dbe0c9',
    },
    dark: {
      bg: '#15181a',
      surface: '#1a1e21',
      text: '#e9e4d6',
      muted: '#a39d8c',
      rule: '#2f3539',
      borderStrong: '#7d7a70',
      accent: '#8db9ec',
      onAccent: '#15181a',
      focus: '#8db9ec',
      warning: '#e89a4f',
      danger: '#ff9480',
      bandLow: '#8db9ec',
      bandMid: '#9a968a',
      bandHigh: '#e8964a',
      land: '#14181a',
      water: '#0c2230',
      green: '#182019',
    },
  },
  'C. Docket': {
    light: {
      bg: '#e8e5dc',
      surface: '#fbfaf6',
      text: '#1c1c1a',
      muted: '#58564f',
      rule: '#8e8b83',
      borderStrong: '#7a776f',
      accent: '#1f55a8',
      onAccent: '#fbfaf6',
      focus: '#1f55a8',
      warning: '#1c1c1a',
      danger: '#a3261a',
      bandLow: '#1f55a8',
      bandMid: '#77736a',
      bandHigh: '#a4520c',
      land: '#f3f1ea',
      water: '#d3dfe4',
      green: '#e6e4da',
    },
    dark: {
      bg: '#0e0f11',
      surface: '#17181b',
      text: '#edebe4',
      muted: '#a8a59c',
      rule: '#5c5a55',
      borderStrong: '#7d7a73',
      accent: '#86b4f0',
      onAccent: '#17181b',
      focus: '#86b4f0',
      warning: '#edebe4',
      danger: '#ff9480',
      bandLow: '#86b4f0',
      bandMid: '#9c988e',
      bandHigh: '#f0954a',
      land: '#141518',
      water: '#1b2932',
      green: '#1a1c1e',
    },
  },
};

const linear = (hex) =>
  hex
    .replace('#', '')
    .match(/../g)
    .map((pair) => {
      const c = parseInt(pair, 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const contrast = (a, b) => {
  const [x, y] = [luminance(linear(a)), luminance(linear(b))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const VISION = {
  typical: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};
const lab = (hex, m) => {
  const c = linear(hex);
  const [r, g, b] = m.map((row) =>
    Math.min(1, Math.max(0, row[0] * c[0] + row[1] * c[1] + row[2] * c[2])),
  );
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};
const deltaE = (a, b, m) => Math.hypot(...lab(a, m).map((v, i) => v - lab(b, m)[i]));

const TEXT = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['muted', 'bg'],
  ['muted', 'surface'],
  ['accent', 'bg'],
  ['accent', 'surface'],
  ['onAccent', 'accent'],
  ['warning', 'surface'],
  ['danger', 'surface'],
  ['led', 'panel'],
  ['ledLit', 'panel'],
];
const NON_TEXT = [
  ['focus', 'bg'],
  ['focus', 'surface'],
  ['borderStrong', 'surface'],
  ...['land', 'water', 'green'].flatMap((g) => [
    ['bandLow', g],
    ['bandMid', g],
    ['bandHigh', g],
    ['text', g],
  ]),
];

let failures = 0;
for (const [name, themes] of Object.entries(PALETTES)) {
  for (const [theme, p] of Object.entries(themes)) {
    const lines = [];
    for (const [pairs, min] of [
      [TEXT, 4.5],
      [NON_TEXT, 3],
    ]) {
      for (const [fg, bg] of pairs) {
        if (!p[fg] || !p[bg]) continue;
        const ratio = contrast(p[fg], p[bg]);
        if (ratio < min) failures++;
        lines.push(`${ratio < min ? 'FAIL' : '  ok'} ${fg} on ${bg}: ${ratio.toFixed(2)}`);
      }
    }
    const bands = ['bandLow', 'bandMid', 'bandHigh'];
    let lowest = Infinity;
    for (const m of Object.values(VISION))
      for (const [i, a] of bands.entries())
        for (const b of bands.slice(i + 1)) lowest = Math.min(lowest, deltaE(p[a], p[b], m));
    if (lowest < 20) failures++;
    lines.push(
      `${lowest < 20 ? 'FAIL' : '  ok'} price bands, smallest ΔE in any vision: ${lowest.toFixed(1)}`,
    );
    console.log(`\n${name}, ${theme}\n${lines.join('\n')}`);
  }
}
console.log(failures ? `\n${failures} failing` : '\nAll pass.');
process.exitCode = failures ? 1 : 0;
