/* global window, document */
/*
 * The minimal Docket rows. Each station is an <li> holding an <h3> holding
 * one <button> (the WAI-ARIA accordion pattern): one Tab stop, heading
 * navigation kept, and the button's name is the whole row as a sentence.
 * Decorative characters are aria-hidden.
 */
(function () {
  const { stations } = window.MOCK;
  const cheapest = stations[0].price;
  const AGED = 1; // the second row aged to 16 days, to show an old price

  const ageOf = (s, i) => (i === AGED ? 16 * 24 : s.ageH);

  function rowHtml(s, i, open) {
    const age = ageOf(s, i);
    const old = age >= 14 * 24;
    const isCheapest = s.price === cheapest;
    const price = s.price.toFixed(1);
    const ageText = window.ageText(age);
    return `
      <h3><button class="pick" aria-expanded="${open}" aria-controls="card-${i}">
        <span class="top"><span class="name">${s.name}</span><span class="lead" aria-hidden="true"></span><span class="amount">${price}</span></span><span class="vh"> cents a litre${isCheapest ? ', cheapest' : ''},</span>
        <span class="meta"><span>${s.km.toFixed(1)} km<span class="vh"> away,</span> <span aria-hidden="true">·</span> ${old ? `<span class="old">Old price, ${ageText}</span>` : `<span class="vh">updated </span>${ageText}`}</span>${isCheapest ? '<span class="word" aria-hidden="true">Cheapest</span>' : ''}</span>
      </button></h3>`;
  }

  function cardHtml(s, i) {
    const moved = s.change
      ? ` · <span class="word" style="color: var(--color-accent)"><span aria-hidden="true">↓ </span><span class="vh">down </span>${Math.abs(s.change).toFixed(1)}<span class="vh"> cents a litre</span> today</span>`
      : '';
    return `
      <div class="card" id="card-${i}">
        <p class="where">${s.brand} · ${window.shortAddress(s.address)}${moved}</p>
        <a class="history" href="#">Price history<span class="vh">, ${s.name}</span></a>
        <div class="actions"><a class="btn primary" href="#">Directions<span aria-hidden="true">&nbsp;↗</span></a><button class="btn" aria-pressed="false"><span aria-hidden="true">☆&nbsp;</span>Favourite</button><button class="btn end">Close</button></div>
      </div>`;
  }

  window.minimalRows = function minimalRows(list, count, openIndex = -1) {
    stations.slice(0, count).forEach((s, i) => {
      const li = document.createElement('li');
      const open = i === openIndex;
      li.className = `station${s.price === cheapest ? ' cheapest' : ''}${open ? ' open' : ''}`;
      li.innerHTML = rowHtml(s, i, open) + (open ? cardHtml(s, i) : '');
      list.appendChild(li);
    });
  };
})();
