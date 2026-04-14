// ── Cron Builder Component ────────────────────────────────────────────────────
// No dependencies.

const CRON_DAYS_HE   = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];
const CRON_DAYS_FULL = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];

/** Parse a 5-part cron expression into builder state */
export function parseCronExpression(expr) {
  const parts = (expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return { mode: 'custom', custom: expr || '', hour: 12, minute: 0, days: [1,2,3,4,5] };
  const [min, hr, dom, mon, dow] = parts;
  if (dom === '*' && mon === '*') {
    const m = parseInt(min), h = parseInt(hr);
    if (hr === '*' && !isNaN(m))
      return { mode: 'every-hour', minute: m, hour: 12, days: [1,2,3,4,5], custom: '' };
    if (!isNaN(m) && !isNaN(h)) {
      if (dow === '*')
        return { mode: 'every-day', minute: m, hour: h, days: [1,2,3,4,5], custom: '' };
      const days = dow.split(',').map(Number).filter(d => d >= 0 && d <= 6);
      return { mode: 'specific-days', minute: m, hour: h, days, custom: '' };
    }
  }
  return { mode: 'custom', custom: expr, hour: 12, minute: 0, days: [1,2,3,4,5] };
}

/**
 * Mount a cron builder onto a .cron-builder element.
 * @param {string}   rootId   - ID of the root .cron-builder div
 * @param {function} onUpdate - called with the new cron expression on every change
 * @returns {{ setExpr, reset, getExpr }}
 */
export function createCronBuilder(rootId, onUpdate) {
  const root = document.getElementById(rootId);
  if (!root) return null;
  const $  = sel => root.querySelector(sel);
  const $$ = sel => root.querySelectorAll(sel);

  const state = { mode: 'every-day', hour: 12, minute: 0, days: [1,2,3,4,5], custom: '' };

  function buildExpr() {
    if (state.mode === 'every-day')     return `${state.minute} ${state.hour} * * *`;
    if (state.mode === 'specific-days') return `${state.minute} ${state.hour} * * ${state.days.length ? state.days.join(',') : '*'}`;
    if (state.mode === 'every-hour')    return `${state.minute} * * * *`;
    return state.custom;
  }

  function describeExpr() {
    const hh = String(state.hour).padStart(2,'0'), mm = String(state.minute).padStart(2,'0');
    if (state.mode === 'every-day')     return `כל יום בשעה ${hh}:${mm}`;
    if (state.mode === 'specific-days') {
      if (!state.days.length) return 'לא נבחרו ימים';
      return `כל ${state.days.map(d => CRON_DAYS_FULL[d]).join(', ')} בשעה ${hh}:${mm}`;
    }
    if (state.mode === 'every-hour')    return `כל שעה בדקה ${mm}`;
    return '';
  }

  function sync() {
    const expr = buildExpr();
    onUpdate(expr);
    const pe = $('.js-cb-preview-expr'), pd = $('.js-cb-preview-desc');
    if (pe) pe.textContent = expr;
    if (pd) pd.textContent = describeExpr();
  }

  function populateSelects() {
    const hourSel = $('.js-cb-hour-sel'), minSel = $('.js-cb-min-sel');
    if (!hourSel || !minSel) return;
    hourSel.innerHTML = Array.from({length:24}, (_,h) =>
      `<option value="${h}">${String(h).padStart(2,'0')}</option>`).join('');
    minSel.innerHTML  = [0,5,10,15,20,25,30,35,40,45,50,55].map(m =>
      `<option value="${m}">${String(m).padStart(2,'0')}</option>`).join('');
    hourSel.value = state.hour;
    minSel.value  = state.minute;
    hourSel.addEventListener('change', () => { state.hour   = +hourSel.value; sync(); });
    minSel.addEventListener('change',  () => { state.minute = +minSel.value;  sync(); });
  }

  function renderDays() {
    const el = $('.js-cb-day-grid');
    if (!el) return;
    el.innerHTML = CRON_DAYS_HE.map((name, i) =>
      `<button class="cron-day-btn${state.days.includes(i) ? ' active' : ''}" data-d="${i}" title="${CRON_DAYS_FULL[i]}">${name}</button>`
    ).join('');
    el.querySelectorAll('.cron-day-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const d = +btn.dataset.d, idx = state.days.indexOf(d);
        if (idx >= 0) state.days.splice(idx, 1); else state.days.push(d);
        state.days.sort((a,b) => a - b);
        renderDays(); sync();
      });
    });
  }

  function applyMode(mode) {
    state.mode = mode;
    $$('.cron-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));

    const showTime = mode !== 'custom', showHour = mode !== 'every-hour';
    const showDays = mode === 'specific-days', showCustom = mode === 'custom';

    const timeRow     = $('.js-cb-time-row'),  hourSel   = $('.js-cb-hour-sel');
    const timeSep     = $('.js-cb-time-sep'),  timeLbl   = $('.js-cb-time-label');
    const timeSectLbl = $('.js-cb-time-section-label');
    const daysRow     = $('.js-cb-days-row'),  customRow = $('.js-cb-custom-row');

    if (timeRow)     timeRow.style.display   = showTime   ? '' : 'none';
    if (hourSel)     hourSel.style.display   = showHour   ? '' : 'none';
    if (timeSep)     timeSep.style.display   = showHour   ? '' : 'none';
    if (timeLbl)     timeLbl.textContent     = showHour   ? 'בשעה' : 'בדקה';
    if (timeSectLbl) timeSectLbl.textContent = showHour   ? 'שעת שליחה' : 'דקת שליחה';
    if (daysRow)     daysRow.style.display   = showDays   ? '' : 'none';
    if (customRow)   customRow.style.display = showCustom ? '' : 'none';

    if (showDays) renderDays();
    sync();
  }

  $$('.cron-tab').forEach(btn => btn.addEventListener('click', () => applyMode(btn.dataset.mode)));
  const customInp = $('.js-cb-custom-input');
  if (customInp) customInp.addEventListener('input', e => { state.custom = e.target.value.trim(); sync(); });

  populateSelects();
  applyMode('every-day');

  return {
    setExpr(expr) {
      const parsed = parseCronExpression(expr);
      Object.assign(state, parsed);
      const hourSel = $('.js-cb-hour-sel'), minSel = $('.js-cb-min-sel');
      if (hourSel) hourSel.value = state.hour;
      if (minSel)  minSel.value  = state.minute;
      const ci = $('.js-cb-custom-input');
      if (ci) ci.value = state.mode === 'custom' ? state.custom : '';
      applyMode(state.mode);
    },
    reset() {
      Object.assign(state, { mode: 'every-day', hour: 12, minute: 0, days: [1,2,3,4,5], custom: '' });
      const hourSel = $('.js-cb-hour-sel'), minSel = $('.js-cb-min-sel');
      if (hourSel) hourSel.value = 12;
      if (minSel)  minSel.value  = 0;
      const ci = $('.js-cb-custom-input');
      if (ci) ci.value = '';
      applyMode('every-day');
    },
    getExpr: buildExpr,
  };
}
