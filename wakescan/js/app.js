/* WakeScan — app logic.
   Alarms that only stop when you physically scan an item in your house.
   Data lives in localStorage; sounds are synthesized; scanning uses the
   camera (see scanner.js). */
(function () {
  'use strict';

  /* ============================ utils ============================ */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const uid = () =>
    (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  const pad = (n) => String(n).padStart(2, '0');
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const uses12h = (() => {
    try {
      return /am|pm/i.test(new Date(2000, 0, 1, 15).toLocaleTimeString());
    } catch (e) { return true; }
  })();

  function fmtTime(hhmm) {
    const [H, M] = hhmm.split(':').map(Number);
    if (!uses12h) return { main: pad(H) + ':' + pad(M), ampm: '' };
    const ampm = H >= 12 ? 'PM' : 'AM';
    const h = H % 12 === 0 ? 12 : H % 12;
    return { main: h + ':' + pad(M), ampm };
  }

  function repeatSummary(days) {
    if (!days.length) return 'Once';
    if (days.length === 7) return 'Every day';
    const set = new Set(days);
    if (days.length === 5 && !set.has(0) && !set.has(6)) return 'Weekdays';
    if (days.length === 2 && set.has(0) && set.has(6)) return 'Weekends';
    return days.slice().sort((a, b) => a - b).map((d) => DAY_NAMES[d]).join(', ');
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  let toastTimer = null;
  function toast(msg, ms) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms || 2600);
  }

  /* ============================ state ============================ */

  const LS = {
    alarms: 'wakescan.v1.alarms',
    items: 'wakescan.v1.items',
    settings: 'wakescan.v1.settings',
    ringing: 'wakescan.v1.ringing',
  };

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function persist(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full/blocked */ }
  }

  let alarms = load(LS.alarms, []);
  let items = load(LS.items, []);
  let settings = Object.assign(
    { snoozeAllowed: true, snoozeMin: 5, emergency: true, wakeLock: false },
    load(LS.settings, {})
  );

  const saveAlarms = () => persist(LS.alarms, alarms);
  const saveItems = () => persist(LS.items, items);
  const saveSettings = () => persist(LS.settings, settings);

  const itemById = (id) => items.find((i) => i.id === id);
  const alarmById = (id) => alarms.find((a) => a.id === id);
  const alarmsUsingItem = (id) => alarms.filter((a) => a.itemIds.includes(id));

  /* ============================ QR drawing ============================ */

  function makeQr(text) {
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr;
  }

  function drawQrToCanvas(canvas, text) {
    const qr = makeQr(text);
    const n = qr.getModuleCount();
    const margin = 2;
    const total = n + margin * 2;
    canvas.width = total;
    canvas.height = total;
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, total, total);
    g.fillStyle = '#0a0f1b';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) g.fillRect(c + margin, r + margin, 1, 1);
      }
    }
  }

  function qrSvg(text) {
    return makeQr(text).createSvgTag({ cellSize: 8, margin: 4, scalable: true });
  }

  /* ============================ tabs & fab ============================ */

  let activeTab = 'alarms';

  function switchTab(tab) {
    activeTab = tab;
    $$('.tab').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    $('#view-alarms').hidden = tab !== 'alarms';
    $('#view-items').hidden = tab !== 'items';
    $('#view-settings').hidden = tab !== 'settings';
    const fab = $('#fab');
    fab.hidden = tab === 'settings';
    fab.setAttribute('aria-label', tab === 'items' ? 'Add item' : 'Add alarm');
  }

  $$('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  $('#fab').addEventListener('click', () => {
    if (activeTab === 'items') openItemSheet();
    else openAlarmEditor(null);
  });

  /* ============================ sheets ============================ */

  const backdrop = $('#backdrop');
  let openSheetEl = null;

  function openSheet(el) {
    closeSheet();
    openSheetEl = el;
    backdrop.hidden = false;
    requestAnimationFrame(() => backdrop.classList.add('show'));
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('open'));
    const first = el.querySelector('input, select, button:not([data-close])');
    if (first && first.type === 'text') setTimeout(() => first.focus(), 250);
  }

  function closeSheet() {
    if (!openSheetEl) return;
    const el = openSheetEl;
    openSheetEl = null;
    WakeSounds.stop(); // stop any sound preview
    el.classList.remove('open');
    backdrop.classList.remove('show');
    setTimeout(() => {
      el.hidden = true;
      if (!openSheetEl) backdrop.hidden = true;
    }, 300);
  }

  backdrop.addEventListener('click', closeSheet);
  $$('[data-close]').forEach((b) => b.addEventListener('click', closeSheet));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openSheetEl) closeSheet();
  });

  /* ============================ alarms view ============================ */

  function renderAlarms() {
    const list = $('#alarmList');
    const sorted = alarms.slice().sort((a, b) => a.time.localeCompare(b.time));
    list.innerHTML = sorted.map((a) => {
      const t = fmtTime(a.time);
      const sound = WakeSounds.list.find((s) => s.id === a.sound);
      const liveItems = a.itemIds.filter(itemById);
      const itemChip = liveItems.length
        ? `<span class="chip accent"><svg class="ic"><use href="#i-qr"/></svg>${liveItems.length === 1
            ? esc(itemById(liveItems[0]).name)
            : liveItems.length + ' items · scan ' + (a.mode === 'all' ? 'all' : 'any')}</span>`
        : `<span class="chip warn"><svg class="ic"><use href="#i-bell"/></svg>No scan needed</span>`;
      return `
        <div class="alarm-card ${a.enabled ? '' : 'off'}" data-id="${a.id}" role="button" tabindex="0" aria-label="Edit alarm ${t.main} ${t.ampm}">
          <div class="alarm-row1">
            <div>
              <div class="alarm-time">${t.main}<span class="ampm">${t.ampm}</span></div>
              <div class="alarm-meta">${esc(a.label || 'Alarm')} · ${repeatSummary(a.days)}</div>
            </div>
            <span class="switch" data-stop>
              <input type="checkbox" ${a.enabled ? 'checked' : ''} data-toggle="${a.id}" aria-label="Alarm ${t.main} ${t.ampm} on or off"/>
              <span class="knob" aria-hidden="true"></span>
            </span>
          </div>
          <div class="alarm-chips">
            <span class="chip"><svg class="ic"><use href="#i-volume"/></svg>${sound ? esc(sound.name) : 'Sound'}</span>
            ${itemChip}
          </div>
        </div>`;
    }).join('');

    $('#alarmsEmpty').hidden = alarms.length > 0;
    list.hidden = alarms.length === 0;
    renderNextAlarmLine();

    $$('.alarm-card', list).forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-stop]')) return;
        openAlarmEditor(card.dataset.id);
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openAlarmEditor(card.dataset.id);
        }
      });
    });
    $$('input[data-toggle]', list).forEach((input) => {
      input.addEventListener('change', () => {
        const a = alarmById(input.dataset.toggle);
        if (!a) return;
        a.enabled = input.checked;
        if (!input.checked) a.snoozeUntil = null;
        saveAlarms();
        renderAlarms();
      });
    });
  }

  function nextOccurrence(a, from) {
    const [H, M] = a.time.split(':').map(Number);
    for (let d = 0; d < 8; d++) {
      const cand = new Date(from);
      cand.setDate(cand.getDate() + d);
      cand.setHours(H, M, 0, 0);
      if (cand <= from) continue;
      if (!a.days.length || a.days.includes(cand.getDay())) return cand;
    }
    return null;
  }

  function renderNextAlarmLine() {
    const el = $('#nextAlarmLine');
    const now = new Date();
    let best = null;
    alarms.filter((a) => a.enabled).forEach((a) => {
      const n = nextOccurrence(a, now);
      if (n && (!best || n < best.when)) best = { when: n, alarm: a };
    });
    if (!best) {
      el.textContent = alarms.length ? 'All alarms are off' : 'Scan your way out of bed';
      return;
    }
    const t = fmtTime(pad(best.when.getHours()) + ':' + pad(best.when.getMinutes()));
    const mins = Math.round((best.when - now) / 60000);
    const inTxt = mins < 60 ? mins + ' min' : Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min';
    const dayTxt = best.when.toDateString() === now.toDateString() ? 'today' : DAY_NAMES[best.when.getDay()];
    el.textContent = `Next: ${t.main}${t.ampm ? ' ' + t.ampm : ''} ${dayTxt} · in ${inTxt}`;
  }

  /* ============================ alarm editor ============================ */

  const sheetAlarm = $('#sheetAlarm');
  let editingId = null;
  let draft = null;

  function openAlarmEditor(id) {
    WakeSounds.unlock();
    editingId = id;
    const a = id ? alarmById(id) : null;
    draft = a
      ? { time: a.time, label: a.label, days: a.days.slice(), sound: a.sound, itemIds: a.itemIds.filter(itemById), mode: a.mode }
      : { time: '07:00', label: '', days: [0, 1, 2, 3, 4, 5, 6], sound: 'classic', itemIds: items.map((i) => i.id), mode: 'any' };

    $('#sheetAlarmTitle').textContent = a ? 'Edit alarm' : 'New alarm';
    $('#alarmTime').value = draft.time;
    $('#alarmLabel').value = draft.label || '';
    $('#btnDeleteAlarm').hidden = !a;
    renderDayPills();
    renderSoundList();
    renderItemChecks();
    renderModeSeg();
    openSheet(sheetAlarm);
  }

  function renderDayPills() {
    $$('.day-pill').forEach((p) => {
      const on = draft.days.includes(Number(p.dataset.day));
      p.classList.toggle('on', on);
      p.setAttribute('aria-pressed', String(on));
    });
    $('#repeatHint').textContent = draft.days.length
      ? 'Repeats: ' + repeatSummary(draft.days)
      : 'No days selected — rings once, then turns itself off.';
  }

  $$('.day-pill').forEach((p) => p.addEventListener('click', () => {
    const d = Number(p.dataset.day);
    const i = draft.days.indexOf(d);
    if (i >= 0) draft.days.splice(i, 1);
    else draft.days.push(d);
    renderDayPills();
  }));

  function renderSoundList() {
    const wrap = $('#soundList');
    wrap.innerHTML = WakeSounds.list.map((s) => `
      <div class="sound-row ${draft.sound === s.id ? 'on' : ''}" data-sound="${s.id}" role="radio" aria-checked="${draft.sound === s.id}" tabindex="0">
        <span class="sound-radio" aria-hidden="true"></span>
        <span class="sound-info">
          <span class="sound-name">${esc(s.name)}</span><br/>
          <span class="sound-desc">${esc(s.desc)}</span>
        </span>
        <button type="button" class="sound-preview" data-preview="${s.id}" aria-label="Preview ${esc(s.name)}">
          <svg class="ic"><use href="#i-play"/></svg>
        </button>
      </div>`).join('');

    $$('.sound-row', wrap).forEach((row) => {
      const pick = () => {
        draft.sound = row.dataset.sound;
        renderSoundList();
      };
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-preview]')) return;
        pick();
      });
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
      });
    });
    $$('[data-preview]', wrap).forEach((b) => b.addEventListener('click', () => {
      WakeSounds.unlock();
      WakeSounds.preview(b.dataset.preview);
    }));
  }

  function renderItemChecks() {
    const wrap = $('#itemChecks');
    const hint = $('#itemChecksHint');
    if (!items.length) {
      wrap.innerHTML = `
        <button type="button" class="btn btn-ghost" id="goAddItems" style="width:100%">
          <svg class="ic"><use href="#i-plus"/></svg> You have no items yet — add one
        </button>`;
      $('#goAddItems').addEventListener('click', () => {
        closeSheet();
        switchTab('items');
        setTimeout(openItemSheet, 350);
      });
      hint.textContent = 'Without items, this alarm can be turned off without scanning anything.';
      return;
    }
    wrap.innerHTML = items.map((it) => {
      const on = draft.itemIds.includes(it.id);
      return `
        <label class="item-check ${on ? 'on' : ''}" data-item="${it.id}">
          <input type="checkbox" ${on ? 'checked' : ''} aria-label="Require scanning ${esc(it.name)}"/>
          <span class="check-box" aria-hidden="true"><svg class="ic"><use href="#i-check"/></svg></span>
          <span class="name">${esc(it.name)}</span>
          <span class="kind">${it.kind === 'qr' ? 'QR sticker' : 'Linked code'}</span>
        </label>`;
    }).join('');
    $$('.item-check', wrap).forEach((row) => {
      const input = row.querySelector('input');
      input.addEventListener('change', () => {
        const id = row.dataset.item;
        const i = draft.itemIds.indexOf(id);
        if (input.checked && i < 0) draft.itemIds.push(id);
        if (!input.checked && i >= 0) draft.itemIds.splice(i, 1);
        row.classList.toggle('on', input.checked);
        updateItemHint();
        renderModeSeg();
      });
    });
    updateItemHint();
  }

  function updateItemHint() {
    const hint = $('#itemChecksHint');
    if (!items.length) return;
    const n = draft.itemIds.length;
    hint.textContent = n === 0
      ? 'Nothing selected — you’ll be able to turn this alarm off without getting up. Brave choice.'
      : n === 1
        ? 'You’ll have to scan ' + (itemById(draft.itemIds[0]) ? itemById(draft.itemIds[0]).name : 'this item') + ' to stop the alarm.'
        : 'Pick how many of the ' + n + ' items you must scan below.';
  }

  function renderModeSeg() {
    const seg = $('#modeSeg');
    const multi = draft.itemIds.length > 1;
    seg.style.display = multi ? '' : 'none';
    $$('.seg-btn', seg).forEach((b) => {
      const on = b.dataset.mode === draft.mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  $$('#modeSeg .seg-btn').forEach((b) => b.addEventListener('click', () => {
    draft.mode = b.dataset.mode;
    renderModeSeg();
  }));

  $('#btnSaveAlarm').addEventListener('click', () => {
    draft.time = $('#alarmTime').value || '07:00';
    draft.label = $('#alarmLabel').value.trim();
    if (editingId) {
      const a = alarmById(editingId);
      Object.assign(a, draft, { snoozeUntil: null });
    } else {
      alarms.push(Object.assign({ id: uid(), enabled: true, lastFired: null, snoozeUntil: null }, draft));
    }
    saveAlarms();
    renderAlarms();
    closeSheet();
    toast(editingId ? 'Alarm updated' : 'Alarm set — sleep tight');
    editingId = null;
    maybeAskNotifications();
  });

  $('#btnDeleteAlarm').addEventListener('click', () => {
    if (!editingId) return;
    if (!confirm('Delete this alarm?')) return;
    alarms = alarms.filter((a) => a.id !== editingId);
    saveAlarms();
    renderAlarms();
    closeSheet();
    toast('Alarm deleted');
    editingId = null;
  });

  $('#emptyAddAlarm').addEventListener('click', () => openAlarmEditor(null));

  /* ============================ items view ============================ */

  function renderItems() {
    const list = $('#itemList');
    list.innerHTML = items.map((it) => {
      const used = alarmsUsingItem(it.id).length;
      const thumb = it.kind === 'qr'
        ? `<span class="item-thumb"><canvas data-qrthumb="${it.id}" aria-hidden="true"></canvas></span>`
        : `<span class="item-thumb barcode"><svg class="ic"><use href="#i-scan"/></svg></span>`;
      return `
        <button type="button" class="item-card" data-id="${it.id}">
          ${thumb}
          <span class="item-info">
            <span class="item-name">${esc(it.name)}</span>
            <span class="item-sub">${it.kind === 'qr' ? 'QR sticker' : 'Linked code'} · ${used ? 'used by ' + used + ' alarm' + (used > 1 ? 's' : '') : 'not used yet'}</span>
          </span>
          <svg class="ic chev"><use href="#i-chevron"/></svg>
        </button>`;
    }).join('');

    $('#itemsEmpty').hidden = items.length > 0;
    list.hidden = items.length === 0;

    $$('canvas[data-qrthumb]', list).forEach((cv) => {
      const it = itemById(cv.dataset.qrthumb);
      if (it) drawQrToCanvas(cv, it.code);
    });
    $$('.item-card', list).forEach((card) =>
      card.addEventListener('click', () => openItemView(card.dataset.id)));
  }

  /* ---- add item ---- */

  const sheetItem = $('#sheetItem');

  function openItemSheet() {
    $('#itemName').value = '';
    openSheet(sheetItem);
  }

  function takeItemName() {
    const name = $('#itemName').value.trim();
    if (!name) {
      toast('Give the item a name first');
      $('#itemName').focus();
      return null;
    }
    return name;
  }

  $('#btnMakeQr').addEventListener('click', () => {
    const name = takeItemName();
    if (!name) return;
    const item = { id: uid(), name, kind: 'qr', code: 'WAKESCAN:ITEM:' + uid(), createdAt: Date.now() };
    items.push(item);
    saveItems();
    renderItems();
    closeSheet();
    setTimeout(() => openItemView(item.id), 350);
    toast('Item created — print its sticker');
  });

  $('#btnLinkCode').addEventListener('click', () => {
    const name = takeItemName();
    if (!name) return;
    closeSheet();
    WakeScanner.start({
      title: 'Scan the item’s code',
      hint: 'Point at the barcode or QR already on “' + name + '”',
      onCode(value) {
        const existing = items.find((i) => i.code === value);
        if (existing) return 'That code is already linked to “' + existing.name + '”';
        const item = { id: uid(), name, kind: 'scanned', code: value, createdAt: Date.now() };
        items.push(item);
        saveItems();
        renderItems();
        WakeScanner.flashOk('Linked!');
        setTimeout(() => {
          WakeScanner.close();
          openItemView(item.id);
        }, 600);
        return null;
      },
    });
  });

  $('#emptyAddItem').addEventListener('click', openItemSheet);

  /* ---- item detail ---- */

  const sheetItemView = $('#sheetItemView');
  let viewingItemId = null;

  function openItemView(id) {
    const it = itemById(id);
    if (!it) return;
    viewingItemId = id;
    $('#itemViewName').textContent = it.name;
    const wrap = $('#itemViewQrWrap');
    const used = alarmsUsingItem(id).length;
    if (it.kind === 'qr') {
      wrap.className = 'qr-stage';
      wrap.innerHTML = '<canvas id="itemViewQr" width="220" height="220" aria-label="QR code for this item"></canvas>';
      drawQrToCanvas($('#itemViewQr'), it.code);
      $('#itemViewCaption').textContent = 'Print this sticker and put it on the item — somewhere you have to walk to.';
      $('#btnPrintItem').hidden = false;
    } else {
      wrap.className = 'qr-stage barcode-stage';
      wrap.innerHTML = '<span class="barcode-value">' + esc(it.code.length > 60 ? it.code.slice(0, 60) + '…' : it.code) + '</span>';
      $('#itemViewCaption').textContent = 'Linked to the code already printed on the item. Just scan the item itself.';
      $('#btnPrintItem').hidden = true;
    }
    $('#itemViewUsage').textContent = used
      ? 'Used by ' + used + ' alarm' + (used > 1 ? 's' : '') + '.'
      : 'Not required by any alarm yet — tick it inside an alarm to use it.';
    openSheet(sheetItemView);
  }

  $('#btnPrintItem').addEventListener('click', () => {
    const it = itemById(viewingItemId);
    if (!it || it.kind !== 'qr') return;
    $('#printArea').innerHTML = `
      <h1>${esc(it.name)}</h1>
      <p>WakeScan — scan this in the morning to stop your alarm</p>
      ${qrSvg(it.code)}
      <div class="print-cut">Cut out and stick on: ${esc(it.name)}</div>`;
    window.print();
  });

  $('#btnDeleteItem').addEventListener('click', () => {
    const it = itemById(viewingItemId);
    if (!it) return;
    const used = alarmsUsingItem(it.id).length;
    const msg = used
      ? 'Delete “' + it.name + '”? It will be removed from ' + used + ' alarm' + (used > 1 ? 's' : '') + '.'
      : 'Delete “' + it.name + '”?';
    if (!confirm(msg)) return;
    items = items.filter((i) => i.id !== it.id);
    alarms.forEach((a) => { a.itemIds = a.itemIds.filter((x) => x !== it.id); });
    saveItems();
    saveAlarms();
    renderItems();
    renderAlarms();
    closeSheet();
    toast('Item deleted');
  });

  /* ============================ settings ============================ */

  function renderSettings() {
    $('#setSnoozeAllowed').checked = settings.snoozeAllowed;
    $('#setSnoozeLen').value = String(settings.snoozeMin);
    $('#setEmergency').checked = settings.emergency;
    $('#setWakeLock').checked = settings.wakeLock;
    $('#rowSnoozeLen').classList.toggle('disabled', !settings.snoozeAllowed);
    renderNotifyStatus();
  }

  $('#setSnoozeAllowed').addEventListener('change', (e) => {
    settings.snoozeAllowed = e.target.checked;
    saveSettings();
    renderSettings();
  });
  $('#setSnoozeLen').addEventListener('change', (e) => {
    settings.snoozeMin = Number(e.target.value);
    saveSettings();
  });
  $('#setEmergency').addEventListener('change', (e) => {
    settings.emergency = e.target.checked;
    saveSettings();
  });
  $('#setWakeLock').addEventListener('change', (e) => {
    settings.wakeLock = e.target.checked;
    saveSettings();
    applyWakeLock();
  });

  function renderNotifyStatus() {
    const btn = $('#btnNotify');
    const status = $('#notifyStatus');
    if (!('Notification' in window)) {
      btn.disabled = true;
      btn.textContent = 'N/A';
      status.textContent = 'Notifications aren’t supported in this browser.';
      return;
    }
    if (Notification.permission === 'granted') {
      btn.disabled = true;
      btn.textContent = 'On';
      status.textContent = 'You’ll get a notification when an alarm fires.';
    } else if (Notification.permission === 'denied') {
      btn.disabled = true;
      btn.textContent = 'Blocked';
      status.textContent = 'Blocked in browser settings — enable it there if you want alarm notifications.';
    } else {
      btn.disabled = false;
      btn.textContent = 'Enable';
      status.textContent = 'Get a notification when the alarm fires.';
    }
  }

  $('#btnNotify').addEventListener('click', async () => {
    try { await Notification.requestPermission(); } catch (e) { /* user dismissed */ }
    renderNotifyStatus();
  });

  let askedNotify = false;
  function maybeAskNotifications() {
    if (askedNotify || !('Notification' in window) || Notification.permission !== 'default') return;
    askedNotify = true;
    Notification.requestPermission().then(renderNotifyStatus).catch(() => {});
  }

  /* ---- wake lock ---- */

  let wakeLockHandle = null;
  async function applyWakeLock() {
    const want = settings.wakeLock || !!ringState;
    if (want && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      try {
        if (!wakeLockHandle) {
          wakeLockHandle = await navigator.wakeLock.request('screen');
          wakeLockHandle.addEventListener('release', () => { wakeLockHandle = null; });
        }
      } catch (e) { wakeLockHandle = null; }
    } else if (!want && wakeLockHandle) {
      try { wakeLockHandle.release(); } catch (e) {}
      wakeLockHandle = null;
    }
  }
  document.addEventListener('visibilitychange', applyWakeLock);

  /* ---- test alarm ---- */

  let testTimer = null;
  $('#btnTestAlarm').addEventListener('click', () => {
    WakeSounds.unlock();
    clearTimeout(testTimer);
    const sound = alarms.length ? alarms[0].sound : 'classic';
    toast(items.length
      ? 'Test alarm in 15 seconds — go stand near one of your items!'
      : 'Test alarm in 15 seconds (no items yet, so you can turn it off directly)', 5000);
    testTimer = setTimeout(() => {
      startRinging({
        id: '__test__',
        label: 'Test alarm',
        time: pad(new Date().getHours()) + ':' + pad(new Date().getMinutes()),
        sound,
        itemIds: items.map((i) => i.id),
        mode: 'any',
      }, { isTest: true });
    }, 15000);
  });

  /* ============================ ring engine ============================ */

  let ringState = null; // { alarm, required: Item[], scanned: Set, isTest }
  let vibrateTimer = null;
  let titleTimer = null;
  const baseTitle = document.title;

  function engineTick(now) {
    if (ringState) return;
    const nowMs = now.getTime();

    for (const a of alarms) {
      if (a.enabled && a.snoozeUntil && nowMs >= a.snoozeUntil) {
        a.snoozeUntil = null;
        saveAlarms();
        startRinging(a, { isTest: false });
        return;
      }
    }

    for (const a of alarms) {
      if (!a.enabled || a.snoozeUntil) continue;
      if (a.days.length && !a.days.includes(now.getDay())) continue;
      const [H, M] = a.time.split(':').map(Number);
      const sched = new Date(now);
      sched.setHours(H, M, 0, 0);
      const diff = nowMs - sched.getTime();
      if (diff >= 0 && diff <= 10 * 60 * 1000) { // ring up to 10 min late (app just opened)
        const key = sched.toDateString() + ' ' + a.time;
        if (a.lastFired !== key) {
          a.lastFired = key;
          saveAlarms();
          startRinging(a, { isTest: false });
          return;
        }
      }
    }
  }

  function startRinging(alarm, { isTest }) {
    const required = alarm.itemIds.map(itemById).filter(Boolean);
    ringState = { alarm, required, scanned: new Set(), isTest };
    if (!isTest) persist(LS.ringing, alarm.id);

    WakeSounds.unlock();
    WakeSounds.start(alarm.sound);

    if (navigator.vibrate) {
      navigator.vibrate([400, 180, 400, 180]);
      vibrateTimer = setInterval(() => navigator.vibrate([400, 180, 400, 180]), 1300);
    }

    titleTimer = setInterval(() => {
      document.title = document.title === baseTitle ? 'WAKE UP! — WakeScan' : baseTitle;
    }, 900);

    notifyRing(alarm, required);
    renderRing();
    $('#ring').hidden = false;
    $('#goodMorning').hidden = true;
    applyWakeLock();
  }

  function notifyRing(alarm, required) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const names = required.map((r) => r.name).join(', ');
      const n = new Notification('Alarm: ' + (alarm.label || fmtTime(alarm.time).main), {
        body: required.length ? 'Get up and scan: ' + names : 'Time to get up!',
        tag: 'wakescan-ring',
        requireInteraction: true,
      });
      n.onclick = () => { window.focus(); n.close(); };
    } catch (e) { /* notification construction can throw on some platforms */ }
  }

  function renderRing() {
    if (!ringState) return;
    const { alarm, required, scanned, isTest } = ringState;
    const t = fmtTime(alarm.time);
    $('#ringTime').textContent = t.main + (t.ampm ? ' ' + t.ampm : '');
    $('#ringLabel').textContent = alarm.label || (isTest ? 'Test alarm' : 'Wake up');

    const tasks = $('#ringTasks');
    if (!required.length) {
      tasks.innerHTML = '';
      $('#ringInstruction').textContent = 'No scan items on this alarm — lucky you.';
      $('#btnRingScan').hidden = true;
      $('#btnRingDirect').hidden = false;
    } else {
      const needAll = alarm.mode === 'all' && required.length > 1;
      tasks.innerHTML = required.map((it) => `
        <div class="ring-task ${scanned.has(it.id) ? 'done' : ''}">
          <span class="check-box" aria-hidden="true"><svg class="ic"><use href="#i-check"/></svg></span>
          <span class="name">${esc(it.name)}</span>
        </div>`).join('');
      $('#ringInstruction').textContent = needAll
        ? 'Scan ALL of these to turn the alarm off'
        : required.length > 1
          ? 'Scan any ONE of these to turn the alarm off'
          : 'Go scan it to turn the alarm off';
      $('#btnRingScan').hidden = false;
      $('#btnRingDirect').hidden = true;
    }

    const snoozeOk = settings.snoozeAllowed && !isTest;
    $('#btnRingSnooze').hidden = !snoozeOk;
    $('#snoozeText').textContent = 'Snooze ' + settings.snoozeMin + ' min';

    $('#btnEmergency').hidden = !settings.emergency || !required.length;
  }

  function stopRingingEffects() {
    WakeSounds.stop();
    clearInterval(vibrateTimer);
    vibrateTimer = null;
    if (navigator.vibrate) navigator.vibrate(0);
    clearInterval(titleTimer);
    titleTimer = null;
    document.title = baseTitle;
  }

  function dismissRing(message) {
    if (!ringState) return;
    const { alarm, isTest } = ringState;
    stopRingingEffects();
    if (!isTest) {
      alarm.snoozeUntil = null;
      if (!alarm.days.length) alarm.enabled = false; // one-time alarm is done
      saveAlarms();
      localStorage.removeItem(LS.ringing);
    }
    ringState = null;
    $('#ring').hidden = true;
    renderAlarms();
    applyWakeLock();

    $('#gmText').textContent = message || 'Alarm off. You’re officially up.';
    const gm = $('#goodMorning');
    gm.hidden = false;
    setTimeout(() => { gm.hidden = true; }, 3000);
  }

  function snoozeRing() {
    if (!ringState || ringState.isTest) return;
    const { alarm } = ringState;
    stopRingingEffects();
    alarm.snoozeUntil = Date.now() + settings.snoozeMin * 60 * 1000;
    saveAlarms();
    localStorage.removeItem(LS.ringing);
    ringState = null;
    $('#ring').hidden = true;
    applyWakeLock();
    toast('Snoozing ' + settings.snoozeMin + ' min — it’ll be back');
  }

  $('#btnRingSnooze').addEventListener('click', snoozeRing);
  $('#btnRingDirect').addEventListener('click', () => dismissRing());

  $('#btnRingScan').addEventListener('click', () => {
    if (!ringState || !ringState.required.length) return;
    WakeScanner.start({
      title: 'Scan to turn off',
      hint: ringState.required.length > 1 ? 'Find one of your items' : 'Find: ' + ringState.required[0].name,
      onCode: handleRingScan,
      onClose() { /* alarm keeps ringing until dismissed */ },
    });
  });

  function handleRingScan(value) {
    if (!ringState) return 'close';
    const { alarm, required, scanned } = ringState;
    const hit = required.find((it) => it.code === value);
    if (!hit) {
      const other = items.find((i) => i.code === value);
      return other
        ? 'That’s “' + other.name + '” — not one of this alarm’s items'
        : 'Code not recognized — find the right item';
    }
    if (scanned.has(hit.id)) return 'Already scanned — find the next one';
    scanned.add(hit.id);
    renderRing();

    const needAll = alarm.mode === 'all' && required.length > 1;
    const done = needAll ? scanned.size >= required.length : true;
    if (done) {
      WakeScanner.flashOk('“' + hit.name + '” scanned!');
      if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
      setTimeout(() => {
        WakeScanner.close();
        dismissRing();
      }, 650);
      return null;
    }
    const left = required.length - scanned.size;
    WakeScanner.flashOk('“' + hit.name + '” scanned! ' + left + ' more to go');
    if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
    return null;
  }

  /* ---- emergency hold (10 s) ---- */

  const btnEmergency = $('#btnEmergency');
  const emergencyFill = $('#emergencyFill');
  let holdTimer = null;

  function holdStart(e) {
    if (holdTimer) return;
    e.preventDefault();
    if (btnEmergency.setPointerCapture && e.pointerId !== undefined) {
      try { btnEmergency.setPointerCapture(e.pointerId); } catch (err) {}
    }
    btnEmergency.classList.add('holding');
    $('#emergencyText').textContent = 'Keep holding…';
    holdTimer = setTimeout(() => {
      holdTimer = null;
      btnEmergency.classList.remove('holding');
      dismissRing('Emergency stop used. Fix that scanner for tomorrow!');
    }, 10000);
  }
  function holdEnd() {
    if (!holdTimer) return;
    clearTimeout(holdTimer);
    holdTimer = null;
    btnEmergency.classList.remove('holding');
    // restart the fill animation cleanly
    emergencyFill.style.transition = 'none';
    requestAnimationFrame(() => { emergencyFill.style.transition = ''; });
    $('#emergencyText').textContent = 'Can’t scan? Press & hold 10s';
  }
  btnEmergency.addEventListener('pointerdown', holdStart);
  btnEmergency.addEventListener('pointerup', holdEnd);
  btnEmergency.addEventListener('pointercancel', holdEnd);
  btnEmergency.addEventListener('pointerleave', holdEnd);

  /* ============================ clock loop ============================ */

  function tick() {
    const now = new Date();
    const t = fmtTime(pad(now.getHours()) + ':' + pad(now.getMinutes()));
    $('#headerClock').textContent = t.main + (t.ampm ? ' ' + t.ampm : '');
    engineTick(now);
  }
  setInterval(tick, 1000);

  setInterval(renderNextAlarmLine, 30000);

  window.addEventListener('beforeunload', (e) => {
    if (ringState && !ringState.isTest) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  /* ============================ init ============================ */

  document.addEventListener('pointerdown', function unlockOnce() {
    WakeSounds.unlock();
    document.removeEventListener('pointerdown', unlockOnce);
  });

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is best-effort */ });
  }

  renderAlarms();
  renderItems();
  renderSettings();
  switchTab('alarms');
  tick();

  // If the page reloaded while an alarm was ringing, resume it —
  // refreshing the page is not a way out.
  const pendingRing = load(LS.ringing, null);
  if (pendingRing) {
    const a = alarmById(pendingRing);
    if (a) startRinging(a, { isTest: false });
    else localStorage.removeItem(LS.ringing);
  }
})();
