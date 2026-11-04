/* Debt payoff tracker. Reads and writes localStorage only. No network calls. */
(function () {
  'use strict';

  var STORAGE_KEY = 'jb.debtTracker.v1';

  var moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  var state = DebtCalc.emptyState();
  var sharedMode = false;
  var activeShare = null;
  var editingJournalId = null;
  var lastShareUrl = '';
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
    if (sharedMode) return false;
    var payload = {
      version: 1,
      extraMonthlyPayment: state.extraMonthlyPayment,
      example: state.example === true,
      debts: state.debts,
      journal: state.journal || []
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
        setStatus('Saved data in this browser could not be read, so nothing was loaded. Adding a debt or importing a file will replace it.', 'error');
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
      debtList.innerHTML = '<div class="empty-block"><strong>Nothing entered yet</strong><p class="muted">Add each balance you still owe. Use the name you actually call it. Starting balance is what you are measuring from. Current balance is what you owe today.</p></div>';
      return;
    }
    debtList.innerHTML = state.debts.map(debtCard).join('');
  }

  function renderAll() {
    projection = null;
    renderSummary();
    renderChart();
    renderStrategy();
    renderDebts();
    renderJournal();
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
      debts: state.debts,
      journal: state.journal || []
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
      var needsConfirm = state.debts.length > 0 || state.extraMonthlyPayment > 0 || state.example || (state.journal && state.journal.length > 0);
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
          ' and ' + result.data.journal.length + ' journal ' + (result.data.journal.length === 1 ? 'entry' : 'entries') +
          '. Importing replaces the ' + state.debts.length + ' ' + currentNoun +
          ' and ' + (state.journal ? state.journal.length : 0) + ' journal entries currently stored in this browser.',
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

  function snapshotNow() {
    var t = DebtCalc.totals(state.debts);
    return {
      paid: t.paid,
      remaining: t.remaining,
      percent: Math.round(t.percent * 10) / 10
    };
  }

  function collectTimeline(debts, journal) {
    var milestones = DebtCalc.buildMilestones(debts, todayISO());
    var entries = (journal || []).map(function (entry) {
      return {
        kind: 'entry',
        date: entry.date,
        id: entry.id,
        title: entry.title,
        note: entry.note || '',
        snapshot: entry.snapshot || null
      };
    });
    return entries.concat(milestones).sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      if (a.kind !== b.kind) return a.kind === 'entry' ? -1 : 1;
      return 0;
    });
  }

  function timelineItemHtml(item) {
    if (item.kind === 'milestone') {
      return '<li class="tl-item milestone"><div><p class="tl-kicker">Milestone</p><p class="tl-title">' +
        esc(item.label) + '</p><p class="fine">' + esc(formatIso(item.date)) + '</p></div></li>';
    }
    var snap = item.snapshot;
    var snapText = 'Snapshot not recorded';
    if (snap && snap.percent != null) {
      snapText = percentText(snap.percent) + ' paid';
      if (snap.remaining != null) snapText += ' · ' + money(snap.remaining) + ' left';
      if (snap.paid != null) snapText += ' · ' + money(snap.paid) + ' paid';
    }
    return '<li class="tl-item entry"><div><p class="tl-kicker">' + esc(formatIso(item.date)) + '</p>' +
      '<p class="tl-title">' + esc(item.title) + '</p>' +
      (item.note ? '<p class="tl-note">' + esc(item.note) + '</p>' : '') +
      '<p class="fine">' + esc(snapText) + '</p>' +
      '<div class="card-actions editor-only">' +
      '<button type="button" class="btn btn-ghost btn-small" data-journal-action="edit" data-journal-id="' + esc(item.id) + '">Edit</button>' +
      '<button type="button" class="btn btn-danger btn-small" data-journal-action="delete" data-journal-id="' + esc(item.id) + '">Delete</button>' +
      '</div></div></li>';
  }

  function renderJournal() {
    var host = document.getElementById('journal-list');
    if (!host) return;
    var items = collectTimeline(state.debts, state.journal);
    if (!items.length) {
      host.innerHTML = '<p class="empty-note">No notes yet. Milestones appear when payoff passes 25%, 50%, 75%, or 100%, or when a balance hits zero.</p>';
      return;
    }
    host.innerHTML = '<ol class="timeline">' + items.map(timelineItemHtml).join('') + '</ol>';
  }

  function resetJournalForm() {
    editingJournalId = null;
    var form = document.getElementById('journal-form');
    if (!form) return;
    form.reset();
    document.getElementById('journal-date').value = todayISO();
    document.getElementById('journal-save').textContent = 'Add entry';
    document.getElementById('journal-cancel').hidden = true;
  }

  function saveJournal(event) {
    event.preventDefault();
    if (sharedMode) return;
    var date = document.getElementById('journal-date').value;
    var title = document.getElementById('journal-title').value.trim();
    var note = document.getElementById('journal-note').value.trim();
    if (!DebtCalc.validDate(date)) {
      setStatus('Choose a valid date for the note.', 'error');
      return;
    }
    if (!title) {
      setStatus('Give the note a short title.', 'error');
      return;
    }
    if (title.length > 80) {
      setStatus('The title must be 80 characters or fewer.', 'error');
      return;
    }
    if (note.length > 4000) {
      setStatus('The note must be 4,000 characters or fewer.', 'error');
      return;
    }
    state.journal = state.journal || [];
    if (editingJournalId) {
      var existing = null;
      for (var i = 0; i < state.journal.length; i++) {
        if (state.journal[i].id === editingJournalId) existing = state.journal[i];
      }
      if (!existing) return;
      existing.date = date;
      existing.title = title;
      existing.note = note;
      setStatus('Updated “' + title + '”. The progress snapshot stays as it was when you first saved it.', 'ok');
    } else {
      state.journal.push({
        id: DebtCalc.newId('note'),
        date: date,
        title: title,
        note: note,
        snapshot: snapshotNow()
      });
      setStatus('Saved “' + title + '” with the progress at this moment.', 'ok');
    }
    saveState();
    resetJournalForm();
    renderJournal();
  }

  function editJournal(id) {
    var entry = null;
    for (var i = 0; i < (state.journal || []).length; i++) {
      if (state.journal[i].id === id) entry = state.journal[i];
    }
    if (!entry) return;
    editingJournalId = id;
    document.getElementById('journal-date').value = entry.date;
    document.getElementById('journal-title').value = entry.title;
    document.getElementById('journal-note').value = entry.note || '';
    document.getElementById('journal-save').textContent = 'Save changes';
    document.getElementById('journal-cancel').hidden = false;
    document.getElementById('journal-title').focus();
  }

  function deleteJournal(id) {
    var entry = null;
    for (var i = 0; i < state.journal.length; i++) {
      if (state.journal[i].id === id) entry = state.journal[i];
    }
    if (!entry) return;
    confirmAction({
      title: 'Delete this note?',
      body: '“' + entry.title + '” will be removed from this browser, including the progress snapshot stored with it.',
      confirmLabel: 'Delete note',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      state.journal = state.journal.filter(function (item) { return item.id !== id; });
      if (editingJournalId === id) resetJournalForm();
      saveState();
      renderJournal();
      setStatus('Deleted “' + entry.title + '”.', 'ok');
    });
  }

  function bytesToB64url(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function b64urlToBytes(text) {
    var padLen = (4 - (text.length % 4)) % 4;
    var b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '===='.slice(0, padLen);
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function gzipBytes(bytes) {
    if (typeof CompressionStream === 'undefined') return Promise.resolve(null);
    var stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Response(stream).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
  }

  function gunzipBytes(bytes) {
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
  }

  function shareNameChoices() {
    var rows = document.querySelectorAll('#share-names .share-name');
    var choices = [];
    rows.forEach(function (row) {
      choices.push({
        show: row.querySelector('.share-show').checked,
        name: row.querySelector('.share-rename').value.trim()
      });
    });
    return choices;
  }

  function debtShareLabel(debt, index, choice) {
    if (choice && choice.show) {
      var name = (choice.name || debt.name || '').trim();
      if (name) return name.slice(0, 80);
    }
    return 'Debt ' + (index + 1);
  }

  function downsample(values, maxPoints) {
    if (!values || values.length <= maxPoints) return (values || []).slice();
    var out = [];
    var last = values.length - 1;
    for (var i = 0; i < maxPoints; i++) out.push(values[Math.round((i * last) / (maxPoints - 1))]);
    return out;
  }

  function planDateText(plan) {
    if (!plan || plan.never) return null;
    if (!plan.months) return 'Already paid off';
    return formatMonth(plan.payoffDate);
  }

  function dollarFreeNote(model) {
    var a = model.avalanche;
    var s = model.snowball;
    if (a.never && s.never) return 'Neither plan pays off within 50 years.';
    if (a.never) return 'Only snowball reaches zero.';
    if (s.never) return 'Only avalanche reaches zero.';
    if (model.winner === 'tie') return 'Both plans reach zero together.';
    var name = model.winner === 'avalanche' ? 'Avalanche' : 'Snowball';
    var mine = model[model.winner];
    var other = model.winner === 'avalanche' ? s : a;
    if (mine.months != null && other.months != null && mine.months < other.months) return name + ' reaches zero first.';
    return name + ' is the lower-interest plan.';
  }

  function buildSharePayload(mode) {
    var choices = shareNameChoices();
    var totals = DebtCalc.totals(state.debts);
    var model = DebtCalc.buildChart(modelDebts(), state.extraMonthlyPayment, { asOf: new Date() });
    var milestones = DebtCalc.buildMilestones(state.debts, todayISO()).map(function (item) {
      var label = item.label;
      if (item.debtIndex != null) {
        var choice = choices[item.debtIndex];
        var shown = choice && choice.show && (choice.name || state.debts[item.debtIndex].name);
        label = shown ? (String(choice.name || state.debts[item.debtIndex].name).trim() + ' paid off') : 'A debt paid off';
      }
      return { date: item.date, label: label };
    });
    if (mode === 'percent') {
      var start = totals.starting;
      function toPercent(line) {
        return downsample(line, 36).map(function (value) {
          if (!(start > 0)) return 0;
          return Math.round(Math.max(0, Math.min(100, (value / start) * 100)) * 10) / 10;
        });
      }
      return {
        v: 1,
        mode: 'percent',
        asOf: todayISO(),
        percent: Math.round(totals.percent * 10) / 10,
        debts: state.debts.map(function (debt, index) {
          var startBal = Math.max(0, Number(debt.startingBalance) || 0);
          var current = Math.max(0, Number(debt.currentBalance) || 0);
          var pct = startBal > 0 ? Math.max(0, Math.min(100, ((startBal - current) / startBal) * 100)) : 0;
          return { label: debtShareLabel(debt, index, choices[index]), percent: Math.round(pct * 10) / 10 };
        }),
        plan: {
          avalanche: { months: model.avalanche.months, date: planDateText(model.avalanche), never: !!model.avalanche.never },
          snowball: { months: model.snowball.months, date: planDateText(model.snowball), never: !!model.snowball.never },
          note: dollarFreeNote(model)
        },
        chart: {
          months: downsample(model.avalancheLine.map(function (_, i) { return i; }), 36),
          avalanche: toPercent(model.avalancheLine),
          snowball: toPercent(model.snowballLine)
        },
        milestones: milestones,
        journal: (state.journal || []).map(function (entry) {
          var item = { date: entry.date, title: entry.title, note: entry.note || '' };
          if (entry.snapshot && entry.snapshot.percent != null) item.percent = entry.snapshot.percent;
          return item;
        })
      };
    }
    return {
      v: 1,
      mode: 'full',
      asOf: todayISO(),
      extra: state.extraMonthlyPayment || 0,
      debts: state.debts.map(function (debt, index) {
        return {
          name: debtShareLabel(debt, index, choices[index]),
          startingBalance: debt.startingBalance,
          currentBalance: debt.currentBalance,
          apr: debt.apr,
          minimumPayment: debt.minimumPayment,
          payments: (debt.payments || []).map(function (payment) {
            return { date: payment.date, amount: payment.amount };
          })
        };
      }),
      journal: (state.journal || []).map(function (entry) {
        return {
          date: entry.date,
          title: entry.title,
          note: entry.note || '',
          snapshot: entry.snapshot || null
        };
      })
    };
  }

  function encodeShare(payload) {
    var bytes = new TextEncoder().encode(JSON.stringify(payload));
    return gzipBytes(bytes).then(function (gz) {
      var flag = '0';
      var data = bytes;
      if (gz && gz.length < bytes.length) {
        flag = '1';
        data = gz;
      }
      return location.origin + location.pathname + location.search + '#s' + flag + '.' + bytesToB64url(data);
    });
  }

  function decodeShareHash() {
    var match = /^s([01])\.(.+)$/.exec(location.hash.replace(/^#/, ''));
    if (!match) return Promise.resolve(null);
    var bytes;
    try { bytes = b64urlToBytes(match[2]); } catch (err) { return Promise.reject(err); }
    var decoded = match[1] === '1'
      ? gunzipBytes(bytes).then(function (plain) { return new TextDecoder().decode(plain); })
      : Promise.resolve(new TextDecoder().decode(bytes));
    return decoded.then(function (text) {
      var obj = JSON.parse(text);
      if (!obj || obj.v !== 1 || (obj.mode !== 'full' && obj.mode !== 'percent')) throw new Error('bad share');
      return obj;
    });
  }

  function fillShareNames() {
    var host = document.getElementById('share-names');
    if (!state.debts.length) {
      host.innerHTML = '<p class="fine">No debts to name. The link can still share the journal and the overall percent.</p>';
      return;
    }
    var percentMode = document.querySelector('input[name="share-mode"]:checked').value === 'percent';
    host.innerHTML = '<p class="fine">Show a name, type a different one, or leave it hidden.</p>' +
      state.debts.map(function (debt) {
        return '<div class="share-name"><label class="choice"><input type="checkbox" class="share-show"' +
          (percentMode ? '' : ' checked') + '> Show name</label>' +
          '<input type="text" class="share-rename" maxlength="80" value="' + esc(debt.name) + '" autocomplete="off"></div>';
      }).join('');
  }

  function openShareDialog() {
    if (sharedMode) return;
    document.getElementById('share-result').hidden = true;
    document.getElementById('share-warn').hidden = true;
    lastShareUrl = '';
    document.querySelector('input[name="share-mode"][value="percent"]').checked = true;
    fillShareNames();
    document.getElementById('share-native').hidden = typeof navigator.share !== 'function';
    document.getElementById('share-dialog').showModal();
  }

  function createShareLink(event) {
    event.preventDefault();
    var mode = document.querySelector('input[name="share-mode"]:checked').value;
    encodeShare(buildSharePayload(mode)).then(function (url) {
      lastShareUrl = url;
      document.getElementById('share-url').value = url;
      document.getElementById('share-result').hidden = false;
      document.getElementById('share-length').textContent = url.length + ' characters.';
      var warn = document.getElementById('share-warn');
      if (url.length > 8000) {
        warn.hidden = false;
        warn.textContent = 'This link is very long (' + url.length + ' characters). Some browsers and chat apps will refuse to open it. Shorten the journal, or share percentages only.';
      } else if (url.length > 3500) {
        warn.hidden = false;
        warn.textContent = 'This link is long (' + url.length + ' characters). It still opens in current browsers, but some apps trim long links.';
      } else {
        warn.hidden = true;
      }
      setStatus(mode === 'percent' ? 'Percent-only link is ready to copy.' : 'Full link is ready to copy.', 'ok');
    }).catch(function () {
      setStatus('Could not build the share link in this browser.', 'error');
    });
  }

  function copyShareLink() {
    if (!lastShareUrl) return;
    var done = function () { setStatus('Copied the share link.', 'ok'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(lastShareUrl).then(done).catch(function () {
        document.getElementById('share-url').focus();
        document.getElementById('share-url').select();
        setStatus('Select the link and copy it.', 'error');
      });
      return;
    }
    document.getElementById('share-url').focus();
    document.getElementById('share-url').select();
    setStatus('Select the link and copy it.', 'ok');
  }

  function nativeShare() {
    if (!lastShareUrl || !navigator.share) return;
    navigator.share({ title: 'Payoff progress', url: lastShareUrl }).catch(function () {});
  }

  function renderPercentSummary(shared) {
    var pct = Math.max(0, Math.min(100, Number(shared.percent) || 0));
    document.getElementById('summary').innerHTML =
      '<div class="stat-grid"><div class="stat-card" style="grid-column:1 / -1"><div class="stat-value">' +
      esc(percentText(pct)) + '</div><div class="stat-label">Paid off</div>' +
      '<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
      esc(pct.toFixed(1)) + '" aria-label="Percent paid off"><span style="width:' + pct.toFixed(1) + '%"></span></div>' +
      '<p class="fine">Dollar amounts were left out of this link.</p></div></div>';
  }

  function renderPercentChart(shared) {
    var host = document.getElementById('chart');
    var chart = shared.chart || { months: [0], avalanche: [100], snowball: [100] };
    var width = Math.max(280, host.clientWidth || 640);
    var height = width < 520 ? 220 : 280;
    var pad = { top: 16, right: 12, bottom: 32, left: width < 420 ? 42 : 48 };
    var innerW = width - pad.left - pad.right;
    var innerH = height - pad.top - pad.bottom;
    var maxMonth = Math.max.apply(null, (chart.months || [1]).concat([1]));
    function xOf(month) { return pad.left + (innerW * month) / maxMonth; }
    function yOf(pct) {
      return pad.top + innerH - (innerH * Math.max(0, Math.min(100, pct))) / 100;
    }
    function path(values) {
      var d = '';
      for (var i = 0; i < values.length; i++) {
        var month = chart.months && chart.months[i] != null ? chart.months[i] : i;
        d += (i === 0 ? 'M' : 'L') + xOf(month).toFixed(2) + ' ' + yOf(values[i]).toFixed(2) + ' ';
      }
      return d.trim();
    }
    var svg = svgEl('svg', {
      viewBox: '0 0 ' + width + ' ' + height,
      width: '100%',
      height: String(height),
      role: 'img'
    });
    svg.setAttribute('aria-label', 'Projected percent remaining. Dollar amounts are not included.');
    [0, 25, 50, 75, 100].forEach(function (tick) {
      var y = yOf(tick);
      svg.appendChild(svgEl('line', {
        x1: String(pad.left), x2: String(width - pad.right),
        y1: y.toFixed(2), y2: y.toFixed(2), stroke: '#EDEBE8', 'stroke-width': '1'
      }));
      var label = svgEl('text', {
        x: String(pad.left - 6), y: (y + 4).toFixed(2), 'text-anchor': 'end',
        fill: '#9298A0', 'font-size': '11', 'font-family': 'Inter, system-ui, sans-serif'
      });
      label.textContent = tick + '%';
      svg.appendChild(label);
    });
    var plot = svgEl('g');
    plot.appendChild(svgEl('path', {
      d: path(chart.avalanche || []), fill: 'none', stroke: '#1B3664', 'stroke-width': '2.5',
      'stroke-linejoin': 'round', 'stroke-linecap': 'round'
    }));
    plot.appendChild(svgEl('path', {
      d: path(chart.snowball || []), fill: 'none', stroke: '#9C4A32', 'stroke-width': '2.5',
      'stroke-dasharray': '7 5', 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
    }));
    svg.appendChild(plot);
    host.innerHTML = '';
    host.appendChild(svg);
    document.getElementById('chart-legend').hidden = false;
    document.getElementById('chart-legend').innerHTML = '<span><i class="swatch ava"></i> Avalanche</span><span><i class="swatch snow"></i> Snowball</span>';
    document.getElementById('chart-note').textContent = 'Percent of the original balances still left. Solid navy is avalanche. Dashed copper is snowball.';
    document.getElementById('chart-details').hidden = true;
  }

  function planCardHtml(title, plan, winner) {
    var dateText = plan && plan.never ? 'Does not pay off' : ((plan && plan.date) || '—');
    var timeText = !plan || plan.never || plan.months == null ? '—' : formatDuration(plan.months);
    return '<article class="plan' + (winner ? ' is-winner' : '') + '"><div class="plan-kicker"><h3 class="plan-name">' +
      title + '</h3></div><dl><div><dt>Debt-free</dt><dd>' + esc(dateText) +
      '</dd></div><div><dt>Time</dt><dd>' + esc(timeText) + '</dd></div></dl></article>';
  }

  function renderPercentPlans(shared) {
    var plan = shared.plan || {};
    document.getElementById('cashflow').textContent = '';
    document.getElementById('plans').innerHTML =
      planCardHtml('Avalanche', plan.avalanche, plan.note && plan.note.indexOf('Avalanche') === 0) +
      planCardHtml('Snowball', plan.snowball, plan.note && plan.note.indexOf('Snowball') === 0);
    document.getElementById('plan-note').textContent = plan.note || '';
  }

  function renderPercentDebts(shared) {
    var debts = shared.debts || [];
    if (!debts.length) {
      document.getElementById('debt-list').innerHTML = '<p class="empty-note">No debts were included.</p>';
      return;
    }
    document.getElementById('debt-list').innerHTML = debts.map(function (debt) {
      var pct = Math.max(0, Math.min(100, Number(debt.percent) || 0));
      return '<article class="debt"><h3 class="debt-name">' + esc(debt.label || 'Debt') + '</h3>' +
        '<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
        pct.toFixed(1) + '"><span style="width:' + pct.toFixed(1) + '%"></span></div>' +
        '<p class="progress-caption">' + esc(percentText(pct)) + ' paid off</p></article>';
    }).join('');
  }

  function renderSharedJournal(shared) {
    var entries = (shared.journal || []).map(function (entry) {
      var snap = shared.mode === 'full' ? (entry.snapshot || null) : { percent: entry.percent };
      return { kind: 'entry', date: entry.date, title: entry.title, note: entry.note || '', snapshot: snap };
    });
    var milestones = (shared.mode === 'percent' ? (shared.milestones || []) : DebtCalc.buildMilestones(state.debts, shared.asOf || todayISO()))
      .map(function (item) { return { kind: 'milestone', date: item.date, label: item.label }; });
    var items = entries.concat(milestones).filter(function (item) { return DebtCalc.validDate(item.date); })
      .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    document.getElementById('journal-list').innerHTML = items.length
      ? '<ol class="timeline">' + items.map(timelineItemHtml).join('') + '</ol>'
      : '<p class="empty-note">No notes were included.</p>';
  }

  function showSharedChrome(shared) {
    sharedMode = true;
    activeShare = shared;
    document.body.classList.add('is-shared');
    document.getElementById('shared-banner').hidden = false;
    document.querySelector('.page-title').textContent = 'Shared progress';
    document.querySelector('.section-eyebrow').textContent = 'Read only';
    var when = shared.asOf && DebtCalc.validDate(shared.asOf) ? formatIso(shared.asOf) : 'an unknown date';
    document.querySelector('.lede').textContent = 'A read-only snapshot from ' + when + '. ' +
      (shared.mode === 'percent' ? 'Dollar amounts were left out.' : 'Dollar amounts are included.');
  }

  function applyFullShare(shared) {
    showSharedChrome(shared);
    var imported = DebtCalc.validateImport({
      app: 'jb-debt-tracker',
      version: 1,
      extraMonthlyPayment: shared.extra || 0,
      debts: shared.debts || [],
      journal: (shared.journal || []).map(function (entry) {
        return { date: entry.date, title: entry.title, note: entry.note || '', snapshot: entry.snapshot || null };
      })
    });
    if (!imported.ok) throw new Error(imported.errors.join(' '));
    state = imported.data;
    renderAll();
  }

  function applyPercentShare(shared) {
    showSharedChrome(shared);
    renderPercentSummary(shared);
    renderPercentChart(shared);
    renderPercentPlans(shared);
    renderPercentDebts(shared);
    renderSharedJournal(shared);
  }

  function boot() {
    var hash = location.hash.replace(/^#/, '');
    if (!/^s[01]\./.test(hash)) {
      loadState();
      resetJournalForm();
      renderAll();
      return;
    }
    decodeShareHash().then(function (shared) {
      if (!shared) {
        loadState();
        resetJournalForm();
        renderAll();
        return;
      }
      if (shared.mode === 'percent') applyPercentShare(shared);
      else applyFullShare(shared);
    }).catch(function () {
      sharedMode = true;
      document.body.classList.add('is-shared');
      document.getElementById('shared-banner').hidden = false;
      setStatus('This share link could not be read. Your saved tracker was left untouched.', 'error');
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
        if (activeShare && activeShare.mode === 'percent') renderPercentChart(activeShare);
        else if (state.debts.some(function (d) { return d.currentBalance > 0; })) renderChart();
      });
    }).observe(document.getElementById('chart'));
  }

  document.getElementById('journal-form').addEventListener('submit', saveJournal);
  document.getElementById('journal-cancel').addEventListener('click', resetJournalForm);
  document.getElementById('journal-list').addEventListener('click', function (event) {
    var btn = event.target.closest('[data-journal-action]');
    if (!btn) return;
    var id = btn.getAttribute('data-journal-id');
    if (btn.getAttribute('data-journal-action') === 'edit') editJournal(id);
    else deleteJournal(id);
  });
  document.getElementById('share-btn').addEventListener('click', openShareDialog);
  document.getElementById('share-form').addEventListener('submit', createShareLink);
  document.getElementById('share-close').addEventListener('click', function () { document.getElementById('share-dialog').close(); });
  document.getElementById('share-copy').addEventListener('click', copyShareLink);
  document.getElementById('share-native').addEventListener('click', nativeShare);
  document.getElementById('share-dialog').addEventListener('click', function (event) {
    if (event.target === document.getElementById('share-dialog')) document.getElementById('share-dialog').close();
  });
  document.querySelectorAll('input[name="share-mode"]').forEach(function (input) {
    input.addEventListener('change', function () {
      var percentMode = document.querySelector('input[name="share-mode"]:checked').value === 'percent';
      document.querySelectorAll('.share-show').forEach(function (box) { box.checked = !percentMode; });
    });
  });
  document.querySelector('#shared-banner a').addEventListener('click', function (event) {
    event.preventDefault();
    history.replaceState(null, '', location.pathname + location.search);
    location.reload();
  });

  boot();
})();
