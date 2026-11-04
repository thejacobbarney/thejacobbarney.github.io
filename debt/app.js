/* Debt payoff tracker. Reads and writes localStorage only. No network calls. */
(function () {
  'use strict';

  var STORAGE_KEY = 'jb.debtTracker.v1';

  // Fictional sample. Applied only from the "Load example data" button.
  var EXAMPLE = {
    extraMonthlyPayment: 200,
    debts: [
      {
        name: 'Example store card',
        startingBalance: 1200,
        currentBalance: 1200,
        apr: 27.99,
        minimumPayment: 20,
        payments: []
      },
      {
        name: 'Example credit card',
        startingBalance: 4200,
        currentBalance: 3850,
        apr: 19.99,
        minimumPayment: 85,
        payments: [
          { date: '2026-09-12', amount: 200 },
          { date: '2026-10-12', amount: 150 }
        ]
      },
      {
        name: 'Example student loan',
        startingBalance: 6400,
        currentBalance: 6400,
        apr: 0,
        minimumPayment: 100,
        payments: []
      },
      {
        name: 'Example car loan',
        startingBalance: 15000,
        currentBalance: 11200,
        apr: 5.5,
        minimumPayment: 310,
        payments: []
      }
    ]
  };

  var moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  var state = DebtCalc.emptyState();
  var ui = { historyOpen: new Set(), payOpen: new Set() };
  var projection = null;
  var confirmResolver = null;
  var editingId = null;
  var currentTouched = false;

  var statusEl = document.getElementById('status');
  var extraInput = document.getElementById('extra');
  var debtList = document.getElementById('debt-list');
  var fileInput = document.getElementById('import-file');
  var debtDialog = document.getElementById('debt-dialog');
  var confirmDialog = document.getElementById('confirm-dialog');

  function money(n) {
    var x = Number(n);
    if (!Number.isFinite(x)) return '—';
    return moneyFmt.format(x);
  }

  function percentText(n) {
    var rounded = Math.round(n * 10) / 10;
    var body = Math.abs(rounded - Math.round(rounded)) < 0.05
      ? String(Math.round(rounded))
      : rounded.toFixed(1);
    return body + '%';
  }

  function moneyInput(n) {
    return (Math.round(Number(n) * 100) / 100).toFixed(2);
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function todayISO() {
    var d = new Date();
    var z = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  }

  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var parts = value.split('-').map(Number);
    var dt = new Date(parts[0], parts[1] - 1, parts[2]);
    return dt.getFullYear() === parts[0] && dt.getMonth() === parts[1] - 1 && dt.getDate() === parts[2];
  }

  function formatIso(iso) {
    var parts = iso.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  }

  function formatMonth(date) {
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  function monthLabel(asOf, index) {
    if (index === 0) return 'Now';
    var d = DebtCalc.addMonths(asOf, index);
    var mon = d.toLocaleDateString('en-US', { month: 'short' });
    return mon + ' ’' + String(d.getFullYear()).slice(2);
  }

  function parseMoney(raw) {
    var t = String(raw).trim().replace(/[$,]/g, '');
    if (t === '') return null;
    var n = Number(t);
    if (!Number.isFinite(n) || n < 0 || n > DebtCalc.MAX_MONEY) return null;
    return DebtCalc.roundMoney(n);
  }

  function parseApr(raw) {
    var t = String(raw).trim().replace(/%/g, '');
    if (t === '') return null;
    var n = Number(t);
    if (!Number.isFinite(n) || n < 0 || n > DebtCalc.MAX_APR) return null;
    return Math.round(n * 10000) / 10000;
  }

  function setStatus(message, kind) {
    statusEl.textContent = message || '';
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
    statusEl.hidden = !message;
  }

  function saveState() {
    var payload = {
      version: 1,
      extraMonthlyPayment: state.extraMonthlyPayment,
      example: state.example === true,
      debts: state.debts
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      return true;
    } catch (err) {
      setStatus('Could not save in this browser. Export a backup so these numbers are not only on screen.', 'error');
      return false;
    }
  }

  function loadState() {
    var raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return;
    }
    if (!raw) return;
    try {
      var result = DebtCalc.validateImport(JSON.parse(raw));
      if (!result.ok) {
        setStatus('Saved data in this browser could not be read, so nothing was loaded. Adding a debt, importing, or loading example data will replace it.', 'error');
        return;
      }
      state = result.data;
    } catch (err) {
      setStatus('Saved data in this browser could not be read, so nothing was loaded.', 'error');
    }
  }

  function modelDebts() {
    return state.debts.map(function (d) {
      return {
        id: d.id,
        name: d.name,
        balance: d.currentBalance,
        apr: d.apr,
        minimum: d.minimumPayment
      };
    });
  }

  function currentProjection() {
    if (!projection) {
      projection = DebtCalc.buildChart(modelDebts(), state.extraMonthlyPayment, { asOf: new Date() });
    }
    return projection;
  }

  function syncExtraField() {
    if (document.activeElement === extraInput) return;
    extraInput.value = moneyInput(state.extraMonthlyPayment || 0);
    extraInput.removeAttribute('aria-invalid');
  }

  function renderBanner() {
    document.getElementById('example-banner').hidden = !state.example;
  }

  function renderSummary() {
    var t = DebtCalc.totals(state.debts);
    var pct = Math.max(0, Math.min(100, t.percent));
    var host = document.getElementById('summary');
    var logged = t.logged > 0
      ? '<p class="fine">Payments logged on this page: ' + esc(money(t.logged)) + '. Paid off also counts the gap between each starting balance and the current balance.</p>'
      : '<p class="fine">Paid off is the gap between the starting balances you entered and what is left. Logging a payment reduces the current balance.</p>';
    host.innerHTML =
      '<div class="stat-grid">' +
        '<div class="stat-card"><div class="stat-value">' + esc(money(t.paid)) + '</div><div class="stat-label">Total paid</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + esc(money(t.remaining)) + '</div><div class="stat-label">Total remaining</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + esc(percentText(pct)) + '</div><div class="stat-label">Paid off</div>' +
          '<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + esc(pct.toFixed(1)) + '" aria-label="Percent paid off">' +
            '<span style="width:' + pct.toFixed(1) + '%"></span></div>' +
        '</div>' +
      '</div>' + logged;
  }

  function niceCeil(value) {
    if (value <= 0) return 1;
    var padded = value * 1.06;
    var pow = Math.pow(10, Math.floor(Math.log10(padded)));
    var n = padded / pow;
    var nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return nice * pow;
  }

  function axisMoney(n) {
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 10000) return '$' + Math.round(n / 1000) + 'k';
    if (n >= 1000) return '$' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return moneyFmt.format(n);
  }

  function svgEl(name, attrs) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', name);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        el.setAttribute(key, attrs[key]);
      });
    }
    return el;
  }

  function renderChart() {
    var host = document.getElementById('chart');
    var legend = document.getElementById('chart-legend');
    var note = document.getElementById('chart-note');
    var details = document.getElementById('chart-details');
    var tableHost = document.getElementById('chart-table');
    var owed = state.debts.some(function (d) { return d.currentBalance > 0; });

    if (!state.debts.length || !owed) {
      legend.hidden = true;
      details.hidden = true;
      note.textContent = '';
      host.innerHTML = '<p class="empty-note">' +
        (state.debts.length
          ? 'Every balance is zero, so there is nothing left to project.'
          : 'Add a debt to see a projected balance.') +
        '</p>';
      return;
    }

    var model = currentProjection();
    var width = Math.max(280, host.clientWidth || 640);
    var height = width < 520 ? 230 : 300;
    var pad = { top: 16, right: 12, bottom: 32, left: width < 420 ? 48 : 58 };
    var innerW = width - pad.left - pad.right;
    var innerH = height - pad.top - pad.bottom;
    var paying = [];
    if (!model.avalanche.never) paying = paying.concat(model.avalancheLine);
    if (!model.snowball.never) paying = paying.concat(model.snowballLine);
    var clipped = null;
    var domainValues;
    if (model.avalanche.never && model.snowball.never) {
      domainValues = model.avalancheLine.concat(model.snowballLine);
    } else if (model.avalanche.never) {
      domainValues = model.snowballLine.slice();
      clipped = 'avalanche';
    } else if (model.snowball.never) {
      domainValues = model.avalancheLine.slice();
      clipped = 'snowball';
    } else {
      domainValues = model.avalancheLine.concat(model.snowballLine);
    }
    var yMax = niceCeil(Math.max.apply(null, domainValues.concat([1])));

    function xOf(i) {
      if (model.horizon === 0) return pad.left;
      return pad.left + (innerW * i) / model.horizon;
    }
    function yOf(v) {
      var clamped = Math.max(0, Math.min(v, yMax));
      return pad.top + innerH - (innerH * clamped) / yMax;
    }
    function pathFor(values) {
      var d = '';
      for (var i = 0; i < values.length; i++) {
        d += (i === 0 ? 'M' : 'L') + xOf(i).toFixed(2) + ' ' + yOf(values[i]).toFixed(2) + ' ';
      }
      return d.trim();
    }

    var svg = svgEl('svg', {
      viewBox: '0 0 ' + width + ' ' + height,
      width: '100%',
      height: String(height),
      role: 'img'
    });
    svg.setAttribute('aria-label', chartLabel(model));

    var clip = svgEl('clipPath', { id: 'plot-clip' });
    clip.appendChild(svgEl('rect', {
      x: String(pad.left),
      y: String(pad.top),
      width: String(innerW),
      height: String(innerH)
    }));
    var defs = svgEl('defs');
    defs.appendChild(clip);
    svg.appendChild(defs);

    var ticks = 4;
    for (var t = 0; t <= ticks; t++) {
      var value = (yMax * t) / ticks;
      var y = yOf(value);
      svg.appendChild(svgEl('line', {
        x1: String(pad.left),
        x2: String(width - pad.right),
        y1: y.toFixed(2),
        y2: y.toFixed(2),
        stroke: '#EDEBE8',
        'stroke-width': '1'
      }));
      var label = svgEl('text', {
        x: String(pad.left - 8),
        y: (y + 4).toFixed(2),
        'text-anchor': 'end',
        fill: '#9298A0',
        'font-size': '11',
        'font-family': 'Inter, system-ui, sans-serif'
      });
      label.textContent = axisMoney(value);
      svg.appendChild(label);
    }

    var asOf = new Date();
    var tickCount = width < 480 ? 3 : (model.horizon > 48 ? 5 : 4);
    var seen = {};
    for (var k = 0; k < tickCount; k++) {
      var month = Math.round((model.horizon * k) / (tickCount - 1));
      if (seen[month]) continue;
      seen[month] = true;
      var anchor = month <= 0 ? 'start' : (month >= model.horizon ? 'end' : 'middle');
      var xl = svgEl('text', {
        x: xOf(month).toFixed(2),
        y: String(height - 8),
        'text-anchor': anchor,
        fill: '#9298A0',
        'font-size': '11',
        'font-family': 'Inter, system-ui, sans-serif'
      });
      xl.textContent = monthLabel(asOf, month);
      svg.appendChild(xl);
    }

    var plot = svgEl('g', { 'clip-path': 'url(#plot-clip)' });
    plot.appendChild(svgEl('path', {
      d: pathFor(model.avalancheLine),
      fill: 'none',
      stroke: '#1B3664',
      'stroke-width': '2.5',
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round'
    }));
    plot.appendChild(svgEl('path', {
      d: pathFor(model.snowballLine),
      fill: 'none',
      stroke: '#9C4A32',
      'stroke-width': '2.5',
      'stroke-dasharray': '7 5',
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round'
    }));
    svg.appendChild(plot);

    host.innerHTML = '';
    host.appendChild(svg);

    legend.hidden = false;
    legend.innerHTML = '<span><i class="swatch ava"></i> Avalanche</span><span><i class="swatch snow"></i> Snowball</span>';

    var caption = 'Solid navy is avalanche. Dashed copper is snowball.';
    if (clipped === 'snowball') {
      caption += ' Snowball runs off this chart because that plan does not pay off. The scale follows avalanche.';
    } else if (clipped === 'avalanche') {
      caption += ' Avalanche runs off this chart because that plan does not pay off. The scale follows snowball.';
    } else if (model.avalanche.never && model.snowball.never) {
      caption += ' Neither plan pays off. The chart shows the next ' + model.horizon + ' months.';
    } else if (model.horizon >= 240) {
      caption += ' The chart stops at 20 years. Full timing is in the comparison below.';
    }
    note.textContent = caption;
    renderChartTable(model, asOf);
    details.hidden = false;
  }

  function chartLabel(model) {
    function bit(name, plan) {
      if (plan.never) return name + ' does not pay off';
      if (!plan.months) return name + ' is already paid off';
      return name + ' pays off in ' + plan.months + ' months';
    }
    return 'Projected balance. ' + bit('Avalanche', model.avalanche) + '. ' + bit('Snowball', model.snowball) + '.';
  }

  function renderChartTable(model, asOf) {
    var host = document.getElementById('chart-table');
    var table = document.createElement('table');
    table.className = 'data';
    var head = document.createElement('thead');
    var hr = document.createElement('tr');
    ['Month', 'Avalanche', 'Snowball'].forEach(function (label, index) {
      var th = document.createElement('th');
      th.textContent = label;
      if (index > 0) th.className = 'num';
      th.scope = 'col';
      hr.appendChild(th);
    });
    head.appendChild(hr);
    table.appendChild(head);
    var body = document.createElement('tbody');
    for (var i = 0; i <= model.horizon; i++) {
      var tr = document.createElement('tr');
      var month = document.createElement('td');
      month.textContent = monthLabel(asOf, i);
      var ava = document.createElement('td');
      ava.className = 'num';
      ava.textContent = money(model.avalancheLine[i]);
      var snow = document.createElement('td');
      snow.className = 'num';
      snow.textContent = money(model.snowballLine[i]);
      tr.appendChild(month);
      tr.appendChild(ava);
      tr.appendChild(snow);
      body.appendChild(tr);
    }
    table.appendChild(body);
    host.innerHTML = '';
    host.appendChild(table);
  }

  function formatDuration(months) {
    if (months == null) return '—';
    if (months === 0) return 'Already paid off';
    var years = Math.floor(months / 12);
    var rem = months % 12;
    var text = months + (months === 1 ? ' month' : ' months');
    if (years > 0) {
      text += ' (' + years + (years === 1 ? ' yr' : ' yrs');
      if (rem) text += ' ' + rem + ' mo';
      text += ')';
    }
    return text;
  }

  function planBadge(which, model) {
    if (model.winner !== which) return '';
    var other = which === 'avalanche' ? model.snowball : model.avalanche;
    var mine = model[which];
    if (other.never) return 'Pays off';
    if (mine.totalInterest + 0.009 < other.totalInterest) return 'Lower interest';
    if (mine.months < other.months) return 'Sooner';
    return '';
  }

  function planHtml(title, key, plan, model) {
    var badge = planBadge(key, model);
    var dateText = plan.never ? 'Does not pay off' : (plan.months === 0 ? 'Already paid off' : formatMonth(plan.payoffDate));
    var interestText = plan.never ? '—' : money(plan.totalInterest);
    return '<article class="plan' + (model.winner === key ? ' is-winner' : '') + '">' +
      '<div class="plan-kicker"><h3 class="plan-name">' + title + '</h3>' +
      (badge ? '<span class="badge">' + esc(badge) + '</span>' : '') +
      '</div><dl>' +
      '<div><dt>Debt-free</dt><dd>' + esc(dateText) + '</dd></div>' +
      '<div><dt>Time</dt><dd>' + esc(formatDuration(plan.never ? null : plan.months)) + '</dd></div>' +
      '<div><dt>Total interest</dt><dd>' + esc(interestText) + '</dd></div>' +
      '</dl></article>';
  }

  function comparisonNote(model) {
    var a = model.avalanche;
    var s = model.snowball;
    if (a.months === 0 && s.months === 0) return 'These balances are already at zero.';
    if (a.never && s.never) {
      return 'Neither strategy pays off within 50 years. The minimums plus the extra payment do not bring every balance down.';
    }
    if (a.never) return 'Only snowball pays off. Avalanche never covers the interest on the balance it pays first.';
    if (s.never) return 'Only avalanche pays off. Snowball never covers the interest on the balance it pays first.';
    if (model.winner === 'tie') return 'Both strategies reach the same debt-free month and the same interest.';
    var winner = model.winner === 'avalanche' ? a : s;
    var other = model.winner === 'avalanche' ? s : a;
    var name = model.winner === 'avalanche' ? 'Avalanche' : 'Snowball';
    var saved = DebtCalc.roundMoney(other.totalInterest - winner.totalInterest);
    if (saved > 0.009) return name + ' pays ' + money(saved) + ' less interest.';
    if (winner.months < other.months) {
      return name + ' is debt-free ' + (other.months - winner.months) + ' months sooner.';
    }
    return name + ' is the lower-cost plan.';
  }

  function renderStrategy() {
    var plans = document.getElementById('plans');
    var note = document.getElementById('plan-note');
    var cash = document.getElementById('cashflow');
    if (!state.debts.length) {
      plans.innerHTML = '<p class="empty-note">Add a debt to compare snowball and avalanche.</p>';
      note.textContent = '';
      cash.textContent = '';
      return;
    }
    var minimums = 0;
    var interest = 0;
    state.debts.forEach(function (d) {
      if (d.currentBalance <= 0) return;
      minimums += Number(d.minimumPayment) || 0;
      interest += DebtCalc.monthlyInterest(d.currentBalance, d.apr);
    });
    minimums = DebtCalc.roundMoney(minimums);
    interest = DebtCalc.roundMoney(interest);
    var extra = state.extraMonthlyPayment || 0;
    var totalPay = DebtCalc.roundMoney(minimums + extra);
    var cashText = 'This month: about ' + money(interest) + ' of interest, ' + money(minimums) + ' in minimums';
    cashText += extra ? ', plus ' + money(extra) + ' extra (' + money(totalPay) + ' in all).' : ' (' + money(totalPay) + ' in all).';
    if (interest > totalPay + 0.009) {
      cashText += ' Interest is higher than the total payment. A plan can still recover after a debt is paid off and its minimum rolls forward.';
    }
    cash.textContent = cashText;

    var owed = state.debts.some(function (d) { return d.currentBalance > 0; });
    if (!owed) {
      plans.innerHTML = '<p class="empty-note">Every balance is zero. There is no interest left to compare.</p>';
      note.textContent = '';
      return;
    }
    var model = currentProjection();
    plans.innerHTML = planHtml('Avalanche', 'avalanche', model.avalanche, model) +
      planHtml('Snowball', 'snowball', model.snowball, model);
    note.textContent = comparisonNote(model);
  }

  function debtWarning(d) {
    if (d.currentBalance <= 0) return '';
    var interest = DebtCalc.monthlyInterest(d.currentBalance, d.apr);
    if (interest > d.minimumPayment + 0.009) {
      return 'Minimum is below this month’s interest of ' + money(interest) + '. Unless extra payments land here, this balance grows.';
    }
    if (interest > 0 && d.minimumPayment <= interest + 0.009) {
      return 'Minimum covers interest only, so this balance does not fall on its own.';
    }
    if (d.apr === 0 && d.minimumPayment <= 0) {
      return 'No payment is set, so this balance stays until you pay it or add an extra payment.';
    }
    return '';
  }

  function debtCard(d) {
    var progress = debtProgress(d);
    var warning = debtWarning(d);
    var historyOpen = ui.historyOpen.has(d.id);
    var payOpen = ui.payOpen.has(d.id);
    var dateId = 'pay-date-' + String(d.id).replace(/[^A-Za-z0-9_-]/g, '');
    var amountId = 'pay-amt-' + String(d.id).replace(/[^A-Za-z0-9_-]/g, '');
    var payments = (d.payments || []).slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.id < b.id ? 1 : -1;
    });
    var rows = payments.length
      ? payments.map(function (p) {
          return '<div class="pay-row">' +
            '<span>' + esc(formatIso(p.date)) + '</span>' +
            '<span class="pay-amount">' + esc(money(p.amount)) + '</span>' +
            '<button type="button" class="btn btn-ghost btn-small" data-action="delete-payment" data-pay-id="' + esc(p.id) + '">Delete</button>' +
          '</div>';
        }).join('')
      : '<p class="fine">No payments logged yet.</p>';
    return '<article class="debt" data-debt-id="' + esc(d.id) + '">' +
      '<div class="debt-top"><h3 class="debt-name">' + esc(d.name) + '</h3><span class="pill">' + esc(formatApr(d.apr)) + ' APR</span></div>' +
      '<div class="meta-grid">' +
        meta('Starting', money(d.startingBalance)) +
        meta('Current', money(d.currentBalance)) +
        meta('Minimum', money(d.minimumPayment)) +
        meta('Interest this month', money(DebtCalc.monthlyInterest(d.currentBalance, d.apr))) +
      '</div>' +
      '<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + progress.pct.toFixed(1) + '" aria-label="Paid off on ' + esc(d.name) + '">' +
        '<span style="width:' + progress.pct.toFixed(1) + '%"></span></div>' +
      '<p class="progress-caption">' + esc(percentText(progress.pct)) + ' paid off · ' + esc(money(progress.paid)) + ' of ' + esc(money(d.startingBalance)) + '</p>' +
      (d.currentBalance > d.startingBalance ? '<p class="fine">Current balance is above the starting balance, so paid off stays at zero until it drops back under.</p>' : '') +
      (warning ? '<p class="callout">' + esc(warning) + '</p>' : '') +
      '<div class="card-actions">' +
        '<button type="button" class="btn btn-navy btn-small" data-action="pay" aria-expanded="' + (payOpen ? 'true' : 'false') + '">Log payment</button>' +
        '<button type="button" class="btn btn-ghost btn-small" data-action="history" aria-expanded="' + (historyOpen ? 'true' : 'false') + '">History' + (payments.length ? ' (' + payments.length + ')' : '') + '</button>' +
        '<button type="button" class="btn btn-ghost btn-small" data-action="edit">Edit</button>' +
        '<button type="button" class="btn btn-danger btn-small" data-action="delete">Delete</button>' +
      '</div>' +
      '<form class="pay-form" data-panel="pay"' + (payOpen ? '' : ' hidden') + '>' +
        '<div class="field"><label for="' + dateId + '">Date</label><input id="' + dateId + '" type="date" name="date" required value="' + todayISO() + '"></div>' +
        '<div class="field"><label for="' + amountId + '">Amount</label><div class="affix"><span aria-hidden="true">$</span><input id="' + amountId + '" name="amount" inputmode="decimal" required autocomplete="off" placeholder="0.00"></div></div>' +
        '<button type="submit" class="btn btn-navy">Log payment</button>' +
      '</form>' +
      '<div class="history" data-panel="history"' + (historyOpen ? '' : ' hidden') + '>' +
        '<p class="fine">Deleting a payment adds that amount back to the current balance.</p>' +
        rows +
      '</div>' +
    '</article>';
  }

  function meta(label, value) {
    return '<div><div class="meta-label">' + esc(label) + '</div><div class="meta-value">' + esc(value) + '</div></div>';
  }

  function formatApr(apr) {
    var n = Number(apr) || 0;
    var text = Math.round(n * 100) / 100;
    return String(text) + '%';
  }

  function debtProgress(d) {
    var start = Math.max(0, Number(d.startingBalance) || 0);
    var current = Math.max(0, Number(d.currentBalance) || 0);
    var paid = Math.max(0, start - current);
    var pct = start > 0 ? Math.max(0, Math.min(100, (paid / start) * 100)) : 0;
    return { paid: DebtCalc.roundMoney(paid), pct: pct };
  }

  function renderDebts() {
    if (!state.debts.length) {
      debtList.innerHTML = '<div class="empty-block"><strong>No debts yet</strong><p class="muted">Add one to track a payoff, or load the example data. The example is labeled and fictional.</p></div>';
      return;
    }
    debtList.innerHTML = state.debts.map(debtCard).join('');
  }

  function renderAll() {
    projection = null;
    renderBanner();
    renderSummary();
    renderChart();
    renderStrategy();
    renderDebts();
    syncExtraField();
  }

  function refreshPlans() {
    projection = null;
    renderSummary();
    renderChart();
    renderStrategy();
  }

  function findDebt(id) {
    for (var i = 0; i < state.debts.length; i++) {
      if (state.debts[i].id === id) return state.debts[i];
    }
    return null;
  }

  function debtRoot(id) {
    var nodes = debtList.querySelectorAll('[data-debt-id]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-debt-id') === id) return nodes[i];
    }
    return null;
  }

  function togglePanel(id, kind) {
    var set = kind === 'history' ? ui.historyOpen : ui.payOpen;
    var root = debtRoot(id);
    var open = !set.has(id);
    if (open) set.add(id);
    else set.delete(id);
    if (root) {
      var panel = root.querySelector('[data-panel="' + kind + '"]');
      if (panel) panel.hidden = !open;
      var btn = root.querySelector('[data-action="' + (kind === 'history' ? 'history' : 'pay') + '"]');
      if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open && kind === 'pay') {
        var amount = panel.querySelector('input[name="amount"]');
        if (amount) amount.focus();
      }
    }
  }

  function showDebtErrors(errors) {
    var box = document.getElementById('debt-errors');
    if (!errors.length) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    box.innerHTML = errors.map(function (err) { return '<li>' + esc(err) + '</li>'; }).join('');
  }

  function openDebtDialog(debt) {
    editingId = debt ? debt.id : null;
    currentTouched = !!debt;
    document.getElementById('debt-dialog-title').textContent = debt ? 'Edit debt' : 'Add a debt';
    document.getElementById('debt-save').textContent = debt ? 'Save changes' : 'Save debt';
    document.getElementById('debt-name').value = debt ? debt.name : '';
    document.getElementById('debt-start').value = debt ? moneyInput(debt.startingBalance) : '';
    document.getElementById('debt-current').value = debt ? moneyInput(debt.currentBalance) : '';
    document.getElementById('debt-apr').value = debt ? String(debt.apr) : '';
    document.getElementById('debt-min').value = debt ? moneyInput(debt.minimumPayment) : '';
    showDebtErrors([]);
    debtDialog.showModal();
    document.getElementById('debt-name').focus();
  }

  function closeDebtDialog() {
    if (debtDialog.open) debtDialog.close();
  }

  function readDebtForm() {
    var nameRaw = document.getElementById('debt-name').value;
    var startRaw = document.getElementById('debt-start').value;
    var currentRaw = document.getElementById('debt-current').value;
    var aprRaw = document.getElementById('debt-apr').value;
    var minRaw = document.getElementById('debt-min').value;
    var name = nameRaw.trim();
    var starting = parseMoney(startRaw);
    var current = parseMoney(currentRaw);
    var apr = parseApr(aprRaw);
    var minimum = parseMoney(minRaw);
    var errors = [];
    if (!name) errors.push('Name is required.');
    else if (name.length > 80) errors.push('Name must be 80 characters or fewer.');
    if (!startRaw.trim()) errors.push('Starting balance is required.');
    else if (starting == null) errors.push('Starting balance must be zero or greater.');
    if (!currentRaw.trim()) errors.push('Current balance is required.');
    else if (current == null) errors.push('Current balance must be zero or greater.');
    if (!aprRaw.trim()) errors.push('APR is required. Use 0 if there is no interest.');
    else if (apr == null) errors.push('APR must be between 0 and ' + DebtCalc.MAX_APR + '.');
    if (!minRaw.trim()) errors.push('Minimum payment is required. Use 0 if there is none.');
    else if (minimum == null) errors.push('Minimum payment must be zero or greater.');
    return { errors: errors, value: { name: name, starting: starting, current: current, apr: apr, minimum: minimum } };
  }

  function saveDebtForm(event) {
    event.preventDefault();
    var form = readDebtForm();
    showDebtErrors(form.errors);
    if (form.errors.length) return;
    var value = form.value;
    if (editingId) {
      var existing = findDebt(editingId);
      if (!existing) return;
      existing.name = value.name;
      existing.startingBalance = value.starting;
      existing.currentBalance = value.current;
      existing.apr = value.apr;
      existing.minimumPayment = value.minimum;
    } else {
      state.debts.push({
        id: DebtCalc.newId('debt'),
        name: value.name,
        startingBalance: value.starting,
        currentBalance: value.current,
        apr: value.apr,
        minimumPayment: value.minimum,
        payments: []
      });
    }
    state.example = false;
    saveState();
    closeDebtDialog();
    renderAll();
    setStatus(editingId ? 'Saved changes to ' + value.name + '.' : 'Added ' + value.name + '.', 'ok');
  }

  function confirmAction(opts) {
    document.getElementById('confirm-title').textContent = opts.title;
    document.getElementById('confirm-body').textContent = opts.body;
    var ok = document.getElementById('confirm-ok');
    ok.textContent = opts.confirmLabel || 'Confirm';
    ok.className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-navy');
    return new Promise(function (resolve) {
      confirmResolver = resolve;
      confirmDialog.showModal();
      ok.focus();
    });
  }

  function settleConfirm(value) {
    if (confirmDialog.open) confirmDialog.close();
    if (!confirmResolver) return;
    var resolve = confirmResolver;
    confirmResolver = null;
    resolve(value);
  }

  function exportData() {
    var payload = {
      app: 'jb-debt-tracker',
      version: 1,
      exportedAt: new Date().toISOString(),
      extraMonthlyPayment: state.extraMonthlyPayment,
      debts: state.debts
    };
    if (state.example) payload.example = true;
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'debt-tracker-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    setStatus(state.debts.length
      ? 'Downloaded a JSON backup of the numbers in this browser.'
      : 'Downloaded an empty backup.', 'ok');
  }

  function handleImportFile(file) {
    file.text().then(function (text) {
      if (text.length > 2000000) {
        setStatus('That file is too large to import.', 'error');
        return;
      }
      var parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        setStatus('That file is not valid JSON.', 'error');
        return;
      }
      var result = DebtCalc.validateImport(parsed);
      if (!result.ok) {
        setStatus(result.errors.slice(0, 4).join(' '), 'error');
        return;
      }
      var needsConfirm = state.debts.length > 0 || state.extraMonthlyPayment > 0 || state.example;
      var apply = function () {
        state = result.data;
        ui.historyOpen.clear();
        ui.payOpen.clear();
        saveState();
        renderAll();
        var noun = state.debts.length === 1 ? 'debt' : 'debts';
        setStatus('Imported ' + state.debts.length + ' ' + noun + '.', 'ok');
      };
      if (!needsConfirm) {
        apply();
        return;
      }
      var names = result.data.debts.map(function (d) { return d.name; });
      var preview = names.slice(0, 5).join(', ');
      if (names.length > 5) preview += '…';
      var noun = result.data.debts.length === 1 ? 'debt' : 'debts';
      var currentNoun = state.debts.length === 1 ? 'debt' : 'debts';
      confirmAction({
        title: 'Replace saved debts?',
        body: 'This file has ' + result.data.debts.length + ' ' + noun +
          (preview ? ' (' + preview + ')' : '') +
          '. Importing replaces the ' + state.debts.length + ' ' + currentNoun +
          ' currently stored in this browser.',
        confirmLabel: 'Replace',
        danger: true
      }).then(function (ok) {
        if (!ok) {
          setStatus('Import cancelled. Saved debts were left as they are.', 'ok');
          return;
        }
        apply();
      });
    }).catch(function () {
      setStatus('Could not read that file.', 'error');
    });
  }

  function loadExample() {
    var run = function () {
      var result = DebtCalc.validateImport({
        app: 'jb-debt-tracker',
        version: 1,
        example: true,
        extraMonthlyPayment: EXAMPLE.extraMonthlyPayment,
        debts: EXAMPLE.debts
      });
      if (!result.ok) {
        setStatus('Example data could not be loaded.', 'error');
        return;
      }
      state = result.data;
      ui.historyOpen.clear();
      ui.payOpen.clear();
      saveState();
      renderAll();
      setStatus('Loaded example data. These balances are fictional.', 'ok');
    };
    if (state.debts.length || state.extraMonthlyPayment > 0) {
      confirmAction({
        title: 'Load example data?',
        body: 'This replaces what is saved in this browser with fictional sample debts. Nothing is uploaded.',
        confirmLabel: 'Load example',
        danger: state.debts.length > 0
      }).then(function (ok) { if (ok) run(); });
      return;
    }
    run();
  }

  function eraseAll() {
    if (!state.debts.length && !state.extraMonthlyPayment && !state.example) {
      setStatus('Nothing is saved in this browser.', 'ok');
      return;
    }
    confirmAction({
      title: 'Erase saved data?',
      body: 'This removes debts, payments, and the extra payment from this browser. A JSON file you already downloaded is left alone.',
      confirmLabel: 'Erase',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      state = DebtCalc.emptyState();
      ui.historyOpen.clear();
      ui.payOpen.clear();
      saveState();
      renderAll();
      setStatus('Erased saved data from this browser.', 'ok');
    });
  }

  function logPayment(debtId, date, amount) {
    var debt = findDebt(debtId);
    if (!debt) return;
    if (!validDate(date)) {
      setStatus('Choose a valid payment date.', 'error');
      return;
    }
    var parsed = parseMoney(amount);
    if (parsed == null || parsed <= 0) {
      setStatus('Enter a payment greater than zero.', 'error');
      return;
    }
    var result = DebtCalc.applyPayment(debt.currentBalance, parsed);
    if (!result.ok) {
      setStatus(result.error, 'error');
      return;
    }
    debt.currentBalance = result.currentBalance;
    debt.payments = debt.payments || [];
    debt.payments.push({ id: DebtCalc.newId('pay'), date: date, amount: result.applied });
    ui.historyOpen.add(debtId);
    ui.payOpen.delete(debtId);
    saveState();
    renderAll();
    if (result.capped) {
      setStatus('Logged ' + money(result.applied) + ', the remaining balance. The rest was not applied.', 'ok');
    } else {
      setStatus('Logged ' + money(result.applied) + ' on ' + formatIso(date) + '. Current balance is now ' + money(debt.currentBalance) + '.', 'ok');
    }
  }

  function deletePayment(debtId, payId) {
    var debt = findDebt(debtId);
    if (!debt) return;
    var payment = (debt.payments || []).filter(function (p) { return p.id === payId; })[0];
    if (!payment) return;
    confirmAction({
      title: 'Delete this payment?',
      body: 'The ' + money(payment.amount) + ' payment on ' + formatIso(payment.date) + ' will be removed, and that amount will be added back to the current balance.',
      confirmLabel: 'Delete payment',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      debt.currentBalance = DebtCalc.reversePayment(debt.currentBalance, payment.amount);
      debt.payments = debt.payments.filter(function (p) { return p.id !== payId; });
      saveState();
      renderAll();
      setStatus('Deleted the payment. Current balance is ' + money(debt.currentBalance) + '.', 'ok');
    });
  }

  function deleteDebt(id) {
    var debt = findDebt(id);
    if (!debt) return;
    confirmAction({
      title: 'Delete ' + debt.name + '?',
      body: 'This removes the debt and its payment history from this browser.',
      confirmLabel: 'Delete debt',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      state.debts = state.debts.filter(function (d) { return d.id !== id; });
      if (!state.debts.length) state.example = false;
      ui.historyOpen.delete(id);
      ui.payOpen.delete(id);
      saveState();
      renderAll();
      setStatus('Deleted ' + debt.name + '.', 'ok');
    });
  }

  document.getElementById('nav').classList.toggle('scrolled', window.scrollY > 20);
  window.addEventListener('scroll', function () {
    document.getElementById('nav').classList.toggle('scrolled', window.scrollY > 20);
  }, { passive: true });

  document.getElementById('add-btn').addEventListener('click', function () { openDebtDialog(null); });
  document.getElementById('debt-cancel').addEventListener('click', closeDebtDialog);
  document.getElementById('debt-close').addEventListener('click', closeDebtDialog);
  document.getElementById('debt-form').addEventListener('submit', saveDebtForm);
  document.getElementById('debt-start').addEventListener('input', function () {
    if (!currentTouched) document.getElementById('debt-current').value = document.getElementById('debt-start').value;
  });
  document.getElementById('debt-current').addEventListener('input', function () { currentTouched = true; });
  debtDialog.addEventListener('click', function (event) {
    if (event.target === debtDialog) closeDebtDialog();
  });

  document.getElementById('confirm-form').addEventListener('submit', function (event) {
    event.preventDefault();
    settleConfirm(true);
  });
  document.getElementById('confirm-ok').addEventListener('click', function () { settleConfirm(true); });
  document.getElementById('confirm-cancel').addEventListener('click', function () { settleConfirm(false); });
  confirmDialog.addEventListener('cancel', function () {
    if (!confirmResolver) return;
    var resolve = confirmResolver;
    confirmResolver = null;
    resolve(false);
  });
  confirmDialog.addEventListener('click', function (event) {
    if (event.target === confirmDialog) settleConfirm(false);
  });

  document.getElementById('example-btn').addEventListener('click', loadExample);
  document.getElementById('export-btn').addEventListener('click', exportData);
  document.getElementById('import-btn').addEventListener('click', function () { fileInput.click(); });
  document.getElementById('erase-btn').addEventListener('click', eraseAll);
  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (file) handleImportFile(file);
  });

  extraInput.addEventListener('input', function () {
    var raw = extraInput.value.trim();
    if (raw === '' || raw === '.') {
      extraInput.removeAttribute('aria-invalid');
      state.extraMonthlyPayment = 0;
      saveState();
      refreshPlans();
      return;
    }
    var n = parseMoney(raw);
    if (n == null) {
      extraInput.setAttribute('aria-invalid', 'true');
      return;
    }
    extraInput.removeAttribute('aria-invalid');
    state.extraMonthlyPayment = n;
    saveState();
    refreshPlans();
  });
  extraInput.addEventListener('blur', function () {
    extraInput.removeAttribute('aria-invalid');
    extraInput.value = moneyInput(state.extraMonthlyPayment || 0);
  });

  debtList.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-action]');
    if (!btn || !debtList.contains(btn)) return;
    var root = btn.closest('[data-debt-id]');
    if (!root) return;
    var id = root.getAttribute('data-debt-id');
    var action = btn.getAttribute('data-action');
    if (action === 'pay') togglePanel(id, 'pay');
    else if (action === 'history') togglePanel(id, 'history');
    else if (action === 'edit') openDebtDialog(findDebt(id));
    else if (action === 'delete') deleteDebt(id);
    else if (action === 'delete-payment') deletePayment(id, btn.getAttribute('data-pay-id'));
  });

  debtList.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || !form.classList.contains('pay-form')) return;
    event.preventDefault();
    var root = form.closest('[data-debt-id]');
    if (!root) return;
    logPayment(
      root.getAttribute('data-debt-id'),
      form.querySelector('[name="date"]').value,
      form.querySelector('[name="amount"]').value
    );
  });

  var chartFrame = 0;
  if (window.ResizeObserver) {
    new ResizeObserver(function () {
      cancelAnimationFrame(chartFrame);
      chartFrame = requestAnimationFrame(function () {
        if (state.debts.some(function (d) { return d.currentBalance > 0; })) renderChart();
      });
    }).observe(document.getElementById('chart'));
  }

  loadState();
  renderAll();
})();
