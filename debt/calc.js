/**
 * Debt payoff math. No DOM, no storage, no network.
 *
 * Model: once a month, charge interest (APR / 12) on each balance, then pay.
 * Every debt gets its minimum. Anything left of a minimum, plus the extra
 * payment, plus minimums from debts already paid off, goes to one target:
 * avalanche = highest APR, snowball = smallest balance.
 *
 * Money is tracked in integer cents. A plan that still has a balance after
 * 600 months (50 years), or that is stuck because no balance can fall,
 * is reported as not paying off.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.DebtCalc = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MAX_MONTHS = 600;
  const CHART_CAP = 240;
  const MAX_MONEY = 1000000000;
  const MAX_APR = 1000;
  const CENT_CAP = 900000000000000; // $9 trillion, under 2^53

  function roundMoney(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return NaN;
    return Math.round(x * 100) / 100;
  }

  function toCents(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.round(x * 100);
  }

  function fromCents(cents) {
    return Number((cents / 100).toFixed(2));
  }

  function monthlyInterestCents(balanceCents, apr) {
    if (balanceCents <= 0 || apr <= 0) return 0;
    return Math.round(balanceCents * (apr / 100 / 12));
  }

  function monthlyInterest(balance, apr) {
    return fromCents(monthlyInterestCents(toCents(balance), Number(apr) || 0));
  }

  function addMonths(date, count) {
    return new Date(date.getFullYear(), date.getMonth() + count, 1);
  }

  function compareTargets(strategy) {
    if (strategy === 'snowball') {
      return function (a, b) {
        return a.balance - b.balance || b.apr - a.apr || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      };
    }
    return function (a, b) {
      return b.apr - a.apr || a.balance - b.balance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    };
  }

  function sumBalances(items) {
    let total = 0;
    for (let i = 0; i < items.length; i++) total += items[i].balance;
    return total;
  }

  /**
   * Project one strategy.
   * debts: { id?, name?, balance, apr, minimum } in dollars.
   * Returns months (null if it does not pay off), totalInterest (null if not),
   * series of remaining balances in dollars (index = month, 0 = today).
   */
  function simulate(debts, extraMonthly, strategy, opts) {
    const options = opts || {};
    const maxMonths = options.maxMonths == null ? MAX_MONTHS : options.maxMonths;
    const padToMonths = options.padToMonths || 0;
    const asOf = options.asOf instanceof Date ? options.asOf : new Date();
    const order = compareTargets(strategy === 'snowball' ? 'snowball' : 'avalanche');

    const items = [];
    const list = Array.isArray(debts) ? debts : [];
    for (let i = 0; i < list.length; i++) {
      const src = list[i] || {};
      const balance = Math.max(0, toCents(src.balance));
      if (!balance) continue;
      items.push({
        id: String(src.id || src.name || i),
        balance: balance,
        apr: Math.max(0, Number(src.apr) || 0),
        minimum: Math.max(0, toCents(src.minimum)),
      });
    }

    const extra = Math.max(0, toCents(extraMonthly));
    const series = [fromCents(sumBalances(items))];
    let interestCents = 0;
    let months = 0;
    let never = false;
    let overflow = false;

    while (months < maxMonths) {
      const opening = sumBalances(items);
      if (opening <= 0) {
        if (months >= padToMonths) break;
        series.push(0);
        months += 1;
        continue;
      }

      const snapshot = items.map(function (d) { return d.balance; });
      let monthInterest = 0;
      let hitCap = false;

      for (let i = 0; i < items.length; i++) {
        const debt = items[i];
        if (debt.balance <= 0) continue;
        const interest = monthlyInterestCents(debt.balance, debt.apr);
        if (debt.balance > CENT_CAP - interest) {
          hitCap = true;
          break;
        }
        debt.balance += interest;
        monthInterest += interest;
      }

      if (hitCap) {
        never = true;
        overflow = true;
        break;
      }

      let pool = extra;
      for (let i = 0; i < items.length; i++) {
        if (items[i].balance <= 0) pool += items[i].minimum;
      }

      for (let i = 0; i < items.length; i++) {
        const debt = items[i];
        if (debt.balance <= 0) continue;
        const pay = Math.min(debt.balance, debt.minimum);
        debt.balance -= pay;
        const leftover = debt.minimum - pay;
        if (leftover > 0) pool += leftover;
      }

      const targets = items.filter(function (d) { return d.balance > 0; }).sort(order);
      for (let i = 0; i < targets.length && pool > 0; i++) {
        const pay = Math.min(targets[i].balance, pool);
        targets[i].balance -= pay;
        pool -= pay;
      }

      interestCents += monthInterest;
      months += 1;
      series.push(fromCents(sumBalances(items)));

      let unchanged = true;
      for (let i = 0; i < items.length; i++) {
        if (items[i].balance !== snapshot[i]) {
          unchanged = false;
          break;
        }
      }
      if (unchanged) {
        never = true;
        if (months >= Math.max(padToMonths, 1)) break;
      }
    }

    if (sumBalances(items) > 0) never = true;

    const paidOff = !never;
    return {
      strategy: strategy === 'snowball' ? 'snowball' : 'avalanche',
      months: paidOff ? months : null,
      never: !paidOff,
      overflow: overflow,
      totalInterest: paidOff ? fromCents(interestCents) : null,
      payoffDate: paidOff ? addMonths(asOf, months) : null,
      series: series,
    };
  }

  function lineToHorizon(debts, extraMonthly, strategy, horizon, verdict, asOf) {
    let series = verdict.series;
    if (series.length - 1 < horizon) {
      series = simulate(debts, extraMonthly, strategy, {
        asOf: asOf,
        padToMonths: horizon,
        maxMonths: Math.max(horizon, 1),
      }).series;
    }
    const line = [];
    for (let i = 0; i <= horizon; i++) {
      if (i < series.length) line.push(series[i]);
      else line.push(series.length ? series[series.length - 1] : 0);
    }
    return line;
  }

  function pickWinner(avalanche, snowball) {
    if (avalanche.never && snowball.never) return 'none';
    if (avalanche.never) return 'snowball';
    if (snowball.never) return 'avalanche';
    const gap = avalanche.totalInterest - snowball.totalInterest;
    if (Math.abs(gap) > 0.009) return gap < 0 ? 'avalanche' : 'snowball';
    if (avalanche.months !== snowball.months) {
      return avalanche.months < snowball.months ? 'avalanche' : 'snowball';
    }
    return 'tie';
  }

  function buildChart(debts, extraMonthly, opts) {
    const options = opts || {};
    const asOf = options.asOf instanceof Date ? options.asOf : new Date();
    const avalanche = simulate(debts, extraMonthly, 'avalanche', { asOf: asOf });
    const snowball = simulate(debts, extraMonthly, 'snowball', { asOf: asOf });

    let horizon = 36;
    if (!avalanche.never && !snowball.never) {
      horizon = Math.max(avalanche.months, snowball.months, 1);
    } else if (!avalanche.never) {
      horizon = Math.max(avalanche.months, 12);
    } else if (!snowball.never) {
      horizon = Math.max(snowball.months, 12);
    }
    horizon = Math.min(Math.max(horizon, 1), CHART_CAP);

    return {
      avalanche: avalanche,
      snowball: snowball,
      horizon: horizon,
      winner: pickWinner(avalanche, snowball),
      avalancheLine: lineToHorizon(debts, extraMonthly, 'avalanche', horizon, avalanche, asOf),
      snowballLine: lineToHorizon(debts, extraMonthly, 'snowball', horizon, snowball, asOf),
    };
  }

  function applyPayment(currentBalance, amount) {
    const current = Math.max(0, toCents(currentBalance));
    const pay = toCents(amount);
    if (!(pay > 0)) {
      return { ok: false, error: 'Payment must be greater than zero.' };
    }
    const applied = Math.min(pay, current);
    if (applied <= 0) {
      return { ok: false, error: 'This debt is already at zero.' };
    }
    return {
      ok: true,
      applied: fromCents(applied),
      capped: applied < pay,
      currentBalance: fromCents(current - applied),
    };
  }

  function reversePayment(currentBalance, amount) {
    const next = Math.max(0, toCents(currentBalance)) + Math.max(0, toCents(amount));
    return fromCents(next);
  }

  function emptyState() {
    return { version: 1, extraMonthlyPayment: 0, example: false, debts: [] };
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parts = value.split('-');
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    const d = Number(parts[2]);
    if (y < 1900 || y > 2200) return false;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  function readMoneyField(value, label, errors) {
    if (typeof value === 'string' && value.trim() !== '') value = Number(value.replace(/[$,]/g, ''));
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(label + ' must be a number.');
      return null;
    }
    if (value < 0) {
      errors.push(label + ' cannot be negative.');
      return null;
    }
    if (value > MAX_MONEY) {
      errors.push(label + ' is larger than this tracker allows.');
      return null;
    }
    return roundMoney(value);
  }

  function newId(prefix) {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /**
   * Validate an imported JSON value. Returns { ok, errors, data }.
   * Only known fields are kept.
   */
  function validateImport(input) {
    const errors = [];
    if (!isPlainObject(input)) {
      return { ok: false, errors: ['This file does not look like a debt tracker export. Expected a JSON object with a debts list.'] };
    }
    if (input.app != null && input.app !== 'jb-debt-tracker') {
      errors.push('This JSON is not a debt tracker file.');
    }
    if (input.version != null && Number(input.version) !== 1) {
      errors.push('This file was made by a different version of the tracker.');
    }
    if (!Array.isArray(input.debts)) {
      errors.push('Expected a debts list.');
      return { ok: false, errors: errors };
    }

    let extra = 0;
    if (input.extraMonthlyPayment != null && input.extraMonthlyPayment !== '') {
      const parsed = readMoneyField(input.extraMonthlyPayment, 'Extra monthly payment', errors);
      if (parsed == null) extra = 0;
      else extra = parsed;
    }

    const seen = Object.create(null);
    const debts = [];
    const source = input.debts;
    for (let i = 0; i < source.length; i++) {
      const raw = source[i];
      const label = 'Debt ' + (i + 1);
      if (!isPlainObject(raw)) {
        errors.push(label + ' is not an object.');
        continue;
      }
      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      if (!name) errors.push(label + ' needs a name.');
      else if (name.length > 80) errors.push(label + ' name must be 80 characters or fewer.');

      const startingBalance = readMoneyField(raw.startingBalance, label + ' starting balance', errors);
      const currentBalance = readMoneyField(raw.currentBalance, label + ' current balance', errors);
      let apr = raw.apr;
      if (typeof apr === 'string' && apr.trim() !== '') apr = Number(apr.replace(/%/g, ''));
      if (typeof apr !== 'number' || !Number.isFinite(apr)) {
        errors.push(label + ' APR must be a number.');
        apr = null;
      } else if (apr < 0) {
        errors.push(label + ' APR cannot be negative.');
        apr = null;
      } else if (apr > MAX_APR) {
        errors.push(label + ' APR is larger than this tracker allows.');
        apr = null;
      } else {
        apr = Math.round(apr * 10000) / 10000;
      }
      const minimumPayment = readMoneyField(raw.minimumPayment, label + ' minimum payment', errors);

      const payments = [];
      if (raw.payments != null && !Array.isArray(raw.payments)) {
        errors.push(label + ' payments must be a list.');
      } else if (Array.isArray(raw.payments)) {
        for (let p = 0; p < raw.payments.length; p++) {
          const pay = raw.payments[p];
          const payLabel = label + ' payment ' + (p + 1);
          if (!isPlainObject(pay)) {
            errors.push(payLabel + ' is not an object.');
            continue;
          }
          if (!validDate(pay.date)) errors.push(payLabel + ' needs a date as YYYY-MM-DD.');
          const amount = readMoneyField(pay.amount, payLabel + ' amount', errors);
          if (amount != null && amount <= 0) errors.push(payLabel + ' amount must be greater than zero.');
          let id = typeof pay.id === 'string' && pay.id.trim() ? pay.id.trim() : '';
          if (!id || seen[id]) id = newId('pay');
          seen[id] = true;
          if (amount != null && amount > 0 && validDate(pay.date)) {
            payments.push({ id: id, date: pay.date, amount: amount });
          }
        }
      }

      let id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : '';
      if (!id || seen[id]) id = newId('debt');
      seen[id] = true;

      if (name && startingBalance != null && currentBalance != null && apr != null && minimumPayment != null) {
        debts.push({
          id: id,
          name: name,
          startingBalance: startingBalance,
          currentBalance: currentBalance,
          apr: apr,
          minimumPayment: minimumPayment,
          payments: payments,
        });
      }
    }

    if (errors.length) return { ok: false, errors: errors };

    return {
      ok: true,
      errors: [],
      data: {
        version: 1,
        extraMonthlyPayment: extra,
        example: input.example === true,
        debts: debts,
      },
    };
  }

  function totals(debts) {
    let starting = 0;
    let remaining = 0;
    let paid = 0;
    let logged = 0;
    const list = Array.isArray(debts) ? debts : [];
    for (let i = 0; i < list.length; i++) {
      const debt = list[i];
      const start = Math.max(0, Number(debt.startingBalance) || 0);
      const current = Math.max(0, Number(debt.currentBalance) || 0);
      starting += start;
      remaining += current;
      paid += Math.max(0, start - current);
      const payments = debt.payments || [];
      for (let p = 0; p < payments.length; p++) logged += Math.max(0, Number(payments[p].amount) || 0);
    }
    starting = roundMoney(starting);
    remaining = roundMoney(remaining);
    paid = roundMoney(paid);
    logged = roundMoney(logged);
    const percent = starting > 0 ? Math.max(0, Math.min(100, (paid / starting) * 100)) : 0;
    return {
      starting: starting,
      remaining: remaining,
      paid: paid,
      logged: logged,
      percent: percent,
    };
  }

  return {
    MAX_MONTHS: MAX_MONTHS,
    MAX_MONEY: MAX_MONEY,
    MAX_APR: MAX_APR,
    roundMoney: roundMoney,
    toCents: toCents,
    fromCents: fromCents,
    monthlyInterest: monthlyInterest,
    simulate: simulate,
    buildChart: buildChart,
    applyPayment: applyPayment,
    reversePayment: reversePayment,
    emptyState: emptyState,
    validateImport: validateImport,
    totals: totals,
    addMonths: addMonths,
    newId: newId,
  };
});
