/* FINITE — a live dashboard of the one life you have.
   Everything below runs on-device. Nothing is sent anywhere. */
'use strict';

/* ============================== constants ============================== */

const STORE_KEY = 'finite.v1';
const HEART_BPM = 72;            // average resting heart rate
const BREATHS_PER_MIN = 16;      // average adult respiration
const ORBIT_KM_PER_SEC = 29.78;  // Earth's speed around the Sun
const SYNODIC_MONTH_DAYS = 29.530588;
const WEEKS_PER_YEAR = 52;       // map approximation, labelled "~" in the UI
const PARENT_HORIZON = 85;       // optimistic average for a loved one
const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;

const fmtInt = new Intl.NumberFormat('en-US');

/* ============================== state ============================== */

let state = null;          // { birth:'YYYY-MM-DD', horizon:90, books:12, parent:{age,visits}|null }
let birthDate = null;
let horizonDate = null;
let deferredInstall = null;
let revealStart = 0;       // timestamp of the post-onboarding count-up

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s.birth || !s.horizon) return null;
    return s;
  } catch { return null; }
}

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function deriveDates() {
  const [y, m, d] = state.birth.split('-').map(Number);
  birthDate = new Date(y, m - 1, d);
  horizonDate = new Date(y + state.horizon, m - 1, d);
}

/* ============================== helpers ============================== */

const $ = (id) => document.getElementById(id);

function ageMs(now = Date.now()) { return now - birthDate.getTime(); }
function lifeMs() { return horizonDate.getTime() - birthDate.getTime(); }
function lifeFraction(now = Date.now()) {
  return Math.min(1, Math.max(0, ageMs(now) / lifeMs()));
}
function remainingDays(now = Date.now()) {
  return Math.max(0, (horizonDate.getTime() - now) / DAY_MS);
}

function vibrate(pattern) {
  try { navigator.vibrate && navigator.vibrate(pattern); } catch { /* no-op */ }
}

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/* ============================== onboarding ============================== */

function startOnboarding() {
  const ob = $('onboarding');
  ob.hidden = false;
  const screens = [...ob.querySelectorAll('.ob-screen')];
  let step = 0;

  const show = (i) => {
    screens.forEach((s, j) => { s.hidden = j !== i; });
    step = i;
  };

  const birthInput = $('ob-birth');
  const today = new Date();
  birthInput.max = today.toISOString().slice(0, 10);
  birthInput.min = '1900-01-01';

  $('ob-horizon').addEventListener('input', (e) => {
    $('ob-horizon-value').textContent = e.target.value;
  });

  ob.addEventListener('click', (e) => {
    const t = e.target;
    if (t.matches('[data-next]')) {
      if (step === 1) {
        const v = birthInput.value;
        const ok = v && new Date(v) < today && v >= '1900-01-01';
        $('ob-birth-error').hidden = ok;
        if (!ok) return;
      }
      vibrate(12);
      show(step + 1);
    } else if (t.matches('[data-finish]') || t.matches('[data-skip]')) {
      const age = parseInt($('ob-parent-age').value, 10);
      const visits = parseInt($('ob-parent-visits').value, 10);
      const parent = (!t.matches('[data-skip]') && age >= 1 && age <= 110 && visits >= 1)
        ? { age, visits } : null;
      state = {
        birth: birthInput.value,
        horizon: parseInt($('ob-horizon').value, 10),
        books: 12,
        parent,
      };
      saveState();
      deriveDates();
      ob.hidden = true;
      vibrate([15, 110, 15, 600, 15, 110, 15]); // two heartbeats
      revealStart = performance.now();
      bootApp();
    }
  });

  show(0);
}

/* ============================== live tickers ============================== */

function tick(now) {
  const t = Date.now();
  const a = ageMs(t);
  const seconds = a / 1000;

  // post-onboarding reveal: count the heartbeats up from zero
  let revealScale = 1;
  if (revealStart) {
    const p = (now - revealStart) / 2400;
    if (p >= 1) revealStart = 0;
    else revealScale = easeOutCubic(Math.max(0, p));
  }

  $('v-heartbeats').textContent = fmtInt.format(Math.floor(seconds / 60 * HEART_BPM * revealScale));
  $('v-breaths').textContent = fmtInt.format(Math.floor(seconds / 60 * BREATHS_PER_MIN * revealScale));
  $('v-seconds').textContent = fmtInt.format(Math.floor(seconds * revealScale));
  $('v-distance').textContent = fmtInt.format(Math.floor(seconds * ORBIT_KM_PER_SEC * revealScale)) + ' km';

  // life as one day
  const frac = lifeFraction(t);
  const daySec = frac * 86400;
  const hh = String(Math.floor(daySec / 3600)).padStart(2, '0');
  const mm = String(Math.floor((daySec % 3600) / 60)).padStart(2, '0');
  const ss = (daySec % 60).toFixed(5).padStart(8, '0');
  $('v-lifeclock').innerHTML = `${hh}:${mm}:<span class="ms">${ss}</span>`;
  $('v-lifeclock-caption').textContent = lifeClockCaption(daySec / 3600);
  $('dayband-marker').style.left = `calc(${(frac * 100).toFixed(4)}% - 1px)`;

  // percentage of weeks, 9 decimal places — visibly moving
  $('v-pct').textContent = (frac * 100).toFixed(9) + ' %';

  requestAnimationFrame(tick);
}

function lifeClockCaption(hour) {
  if (hour < 6) return 'in your life — the quiet hours before your dawn';
  if (hour < 9) return 'in your life — your morning, everything still ahead';
  if (hour < 12) return 'in your life — mid-morning, building momentum';
  if (hour < 15) return 'in your life — the bright middle of your day';
  if (hour < 18) return 'in your life — golden afternoon, the good light';
  if (hour < 21) return 'in your life — your evening, time to do what matters';
  return 'in your life — late evening, every hour precious now';
}

/* ============================== weeks map ============================== */

const grid = { canvas: null, off: null, cols: WEEKS_PER_YEAR, rows: 0, cell: 0, weekIdx: 0, total: 0, visible: false };

function buildGrid() {
  grid.canvas = $('weeks-canvas');
  const ctx = grid.canvas.getContext('2d');
  if (!ctx) return;

  grid.rows = state.horizon;
  grid.total = grid.rows * grid.cols;
  grid.weekIdx = Math.min(grid.total - 1, Math.floor(ageMs() / WEEK_MS));

  const cssWidth = grid.canvas.parentElement.clientWidth || 320;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  grid.cell = cssWidth / grid.cols;
  const cssHeight = grid.cell * grid.rows;

  grid.canvas.width = Math.round(cssWidth * dpr);
  grid.canvas.height = Math.round(cssHeight * dpr);
  grid.canvas.style.height = cssHeight + 'px';

  // static layer: every dot except the pulsing current week
  grid.off = document.createElement('canvas');
  grid.off.width = grid.canvas.width;
  grid.off.height = grid.canvas.height;
  const o = grid.off.getContext('2d');
  o.scale(dpr, dpr);
  drawDots(o, grid.cols, grid.rows, grid.cell, grid.weekIdx, { skipCurrent: true });

  $('v-weeknum').textContent = fmtInt.format(grid.weekIdx + 1);
  $('v-weekstotal').textContent = '~' + fmtInt.format(grid.total);
  $('v-weeksleft').textContent = fmtInt.format(Math.max(0, grid.total - grid.weekIdx - 1));

  if (!grid.animating) {
    grid.animating = true;
    animateGrid();
  }
}

function drawDots(ctx, cols, rows, cell, weekIdx, { skipCurrent = false, palette } = {}) {
  const p = palette || {
    spentFrom: [255, 214, 140], spentTo: [255, 110, 20],
    future: '#2b2937', bg: null,
  };
  if (p.bg) { ctx.fillStyle = p.bg; ctx.fillRect(0, 0, cols * cell, rows * cell); }
  const r = cell * 0.32;
  for (let i = 0; i < cols * rows; i++) {
    if (skipCurrent && i === weekIdx) continue;
    const x = (i % cols) * cell + cell / 2;
    const y = Math.floor(i / cols) * cell + cell / 2;
    if (i < weekIdx) {
      const t = i / Math.max(1, weekIdx);
      const c0 = p.spentFrom, c1 = p.spentTo;
      ctx.fillStyle = `rgb(${Math.round(c0[0] + (c1[0] - c0[0]) * t)},${Math.round(c0[1] + (c1[1] - c0[1]) * t)},${Math.round(c0[2] + (c1[2] - c0[2]) * t)})`;
    } else if (i === weekIdx) {
      ctx.fillStyle = '#ffeccc';
    } else {
      ctx.fillStyle = p.future;
    }
    ctx.beginPath();
    ctx.arc(x, y, i === weekIdx ? r * 1.35 : r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function animateGrid() {
  const ctx = grid.canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  const io = new IntersectionObserver((entries) => {
    grid.visible = entries[0].isIntersecting;
  });
  io.observe(grid.canvas);

  const frame = (now) => {
    if (grid.visible && grid.off) {
      ctx.clearRect(0, 0, grid.canvas.width, grid.canvas.height);
      ctx.drawImage(grid.off, 0, 0);
      // the pulsing "you are here" dot
      const pulse = 1 + 0.5 * Math.abs(Math.sin(now / 450));
      const x = (grid.weekIdx % grid.cols) * grid.cell + grid.cell / 2;
      const y = Math.floor(grid.weekIdx / grid.cols) * grid.cell + grid.cell / 2;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.shadowColor = 'rgba(255,170,80,0.9)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#ffeccc';
      ctx.beginPath();
      ctx.arc(x, y, grid.cell * 0.32 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function wireGridTap() {
  const tip = $('week-tip');
  let hideTimer = 0;
  $('weeks-canvas').addEventListener('click', (e) => {
    const rect = grid.canvas.getBoundingClientRect();
    const col = Math.floor((e.clientX - rect.left) / grid.cell);
    const row = Math.floor((e.clientY - rect.top) / grid.cell);
    const idx = row * grid.cols + col;
    if (idx < 0 || idx >= grid.total) return;

    const start = new Date(birthDate.getTime() + idx * WEEK_MS);
    const when = start.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    const age = Math.floor(idx / grid.cols);
    const label = idx < grid.weekIdx
      ? `spent · you were ${age}`
      : idx === grid.weekIdx ? 'this is your week — you are here'
      : `waiting · you'll be ${age}`;
    tip.innerHTML = `Week ${fmtInt.format(idx + 1)} — ${when}<small>${label}</small>`;
    tip.style.left = (col + 0.5) * grid.cell + 'px';
    tip.style.top = row * grid.cell + 'px';
    tip.hidden = false;
    vibrate(8);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { tip.hidden = true; }, 3200);
  });
}

/* ============================== what remains ============================== */

function renderRemains() {
  const now = Date.now();
  const remDays = remainingDays(now);
  const remYears = remDays / 365.25;

  $('r-sunrises').textContent = fmtInt.format(Math.floor(remDays));
  $('r-saturdays').textContent = fmtInt.format(Math.floor(remDays / 7));
  $('r-moons').textContent = fmtInt.format(Math.floor(remDays / SYNODIC_MONTH_DAYS));

  // summers: count June 21sts between now and the horizon
  let summers = 0;
  const nowDate = new Date(now);
  for (let y = nowDate.getFullYear(); y <= horizonDate.getFullYear(); y++) {
    const solstice = new Date(y, 5, 21);
    if (solstice > nowDate && solstice <= horizonDate) summers++;
  }
  $('r-summers').textContent = fmtInt.format(summers);

  $('in-books').value = state.books;
  $('r-books').textContent = fmtInt.format(Math.floor(remYears * state.books));

  const parentCard = $('card-parent');
  const addBtn = $('btn-add-parent');
  if (state.parent) {
    const { age, visits } = state.parent;
    const yearsLeft = Math.max(0, PARENT_HORIZON - age);
    const meetings = Math.round(yearsLeft * visits);
    $('r-parent').textContent = age >= PARENT_HORIZON ? '∞ / 0' : fmtInt.format(meetings);
    $('r-parent-detail').textContent = age >= PARENT_HORIZON
      ? `they're past the average horizon — every visit is borrowed gold`
      : `if they reach ~${PARENT_HORIZON} and you keep visiting ${visits}× a year`;
    parentCard.hidden = false;
    addBtn.hidden = true;
  } else {
    parentCard.hidden = true;
    addBtn.hidden = false;
  }
}

/* ============================== perspective ============================== */

function quotes() {
  const remDays = Math.floor(remainingDays());
  const weekendsLeft = Math.floor(remDays / 7);
  return [
    'You will never be younger than you are right now.',
    `Today is one of ${fmtInt.format(remDays)} mornings you have left. That makes it rare.`,
    'Time is the only thing you spend without ever seeing the balance.',
    'The Stoics kept a skull on the desk and called it memento mori. You keep a dashboard in your pocket.',
    `${fmtInt.format(weekendsLeft)} Saturdays. Say it out loud. Now decide what Saturday is for.`,
    'The trouble is, you think you have time.',
    'Nobody ever lay at the end of it all wishing they had scrolled more.',
    'This page is not morbid. The people most aware of the ending are the ones most awake in the middle.',
  ];
}

function startQuotes() {
  const el = $('v-quote');
  let i = 0;
  setInterval(() => {
    el.classList.add('fading');
    setTimeout(() => {
      const list = quotes();
      i = (i + 1) % list.length;
      el.textContent = list[i];
      el.classList.remove('fading');
    }, 620);
  }, 9000);
}

/* ============================== share card ============================== */

async function shareCard() {
  vibrate(12);
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#07070b';
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, H * 0.42, 60, W / 2, H * 0.42, 700);
  glow.addColorStop(0, 'rgba(255,140,46,0.14)');
  glow.addColorStop(1, 'rgba(255,140,46,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#9b96a8';
  ctx.font = '44px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('F I N I T E', W / 2, 110);

  // the mini map
  const cols = grid.cols, rows = grid.rows;
  const cell = Math.min(900 / cols, 760 / rows);
  const gw = cols * cell, gh = rows * cell;
  ctx.save();
  ctx.translate((W - gw) / 2, 190);
  drawDots(ctx, cols, rows, cell, grid.weekIdx, {});
  ctx.restore();

  const y0 = 190 + gh;
  ctx.fillStyle = '#ece8df';
  ctx.font = '64px Georgia, serif';
  ctx.fillText(`Week ${fmtInt.format(grid.weekIdx + 1)} of ~${fmtInt.format(grid.total)}`, W / 2, y0 + 110);
  ctx.fillStyle = '#ffb46b';
  ctx.font = '42px Georgia, serif';
  ctx.fillText(`${(lifeFraction() * 100).toFixed(1)}% of my weeks are spent.`, W / 2, y0 + 180);
  ctx.fillStyle = '#5d586b';
  ctx.font = '30px system-ui, sans-serif';
  ctx.fillText('Count what counts.', W / 2, H - 80);

  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  if (!blob) return;
  const file = new File([blob], 'finite-week.png', { type: 'image/png' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'FINITE', text: `Week ${fmtInt.format(grid.weekIdx + 1)} of ~${fmtInt.format(grid.total)}.` });
      return;
    } catch { /* user cancelled — fall through to download */ }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'finite-week.png';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ============================== install ============================== */

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  const btn = $('btn-install');
  if (btn) btn.hidden = false;
});

window.addEventListener('appinstalled', () => {
  const btn = $('btn-install');
  if (btn) btn.hidden = true;
});

function wireInstall() {
  $('btn-install').addEventListener('click', async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    $('btn-install').hidden = true;
  });

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (isIOS && !standalone) $('ios-hint').hidden = false;
}

/* ============================== settings ============================== */

function wireSettings() {
  const dlg = $('settings');

  $('btn-settings').addEventListener('click', () => {
    $('set-birth').value = state.birth;
    $('set-birth').max = new Date().toISOString().slice(0, 10);
    $('set-horizon').value = state.horizon;
    $('set-horizon-out').textContent = state.horizon;
    $('set-parent-age').value = state.parent ? state.parent.age : '';
    $('set-parent-visits').value = state.parent ? state.parent.visits : '';
    dlg.showModal();
  });

  $('set-horizon').addEventListener('input', (e) => {
    $('set-horizon-out').textContent = e.target.value;
  });

  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'save') return;
    const birth = $('set-birth').value;
    if (!birth || new Date(birth) >= new Date()) return;
    const age = parseInt($('set-parent-age').value, 10);
    const visits = parseInt($('set-parent-visits').value, 10);
    state.birth = birth;
    state.horizon = parseInt($('set-horizon').value, 10);
    state.parent = (age >= 1 && age <= 110 && visits >= 1) ? { age, visits } : null;
    saveState();
    deriveDates();
    buildGrid();
    renderRemains();
    checkOvertime();
  });

  $('set-reset').addEventListener('click', () => {
    if (confirm('Erase your data from this device and start over?')) {
      localStorage.removeItem(STORE_KEY);
      location.reload();
    }
  });

  $('btn-add-parent').addEventListener('click', () => $('btn-settings').click());

  $('in-books').addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    if (v >= 0 && v <= 200) {
      state.books = v;
      saveState();
      $('r-books').textContent = fmtInt.format(Math.floor((remainingDays() / 365.25) * v));
    }
  });

  $('btn-share').addEventListener('click', shareCard);
}

/* ============================== overtime ============================== */

function checkOvertime() {
  $('overtime').hidden = Date.now() <= horizonDate.getTime();
}

/* ============================== boot ============================== */

function bootApp() {
  $('app').hidden = false;
  buildGrid();
  wireGridTap();
  renderRemains();
  startQuotes();
  wireInstall();
  wireSettings();
  checkOvertime();
  requestAnimationFrame(tick);

  // rebuild the map if the viewport changes (rotation, resize)
  let lastW = window.innerWidth;
  window.addEventListener('resize', () => {
    if (Math.abs(window.innerWidth - lastW) > 40) {
      lastW = window.innerWidth;
      buildGrid();
    }
  });

  // refresh the daily numbers just after midnight
  const msToMidnight = new Date().setHours(24, 0, 5, 0) - Date.now();
  setTimeout(() => { renderRemains(); checkOvertime(); }, msToMidnight);
}

state = loadState();
if (state) {
  deriveDates();
  bootApp();
} else {
  startOnboarding();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline-first is a bonus, not a blocker */ });
  });
}
