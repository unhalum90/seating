// =============================================
// SeatFlow — Teacher Admin Toolkit
// =============================================

const LAYOUT_DEFS = {
  rows: { label: 'Rows', icon: '▤' },
  pairs: { label: 'Pairs', icon: '▥' },
  groups: { label: 'Groups', icon: '⊞' },
  ushape: { label: 'U-Shape', icon: '⊔' },
  exam: { label: 'Exam', icon: '⊡' },
};

// ─── State ───
let state = {
  classes: [],
  currentClassId: null,
  layout: 'rows',
  view: 'teacher',
  currentTool: 'seating',
  behaviour: {}, // classId -> { studentId -> { merits, concerns, notes:[] } }
};

// Timer state (not persisted)
let timer = { duration: 300, remaining: 300, running: false, interval: null };

// Picker state
let pickerHistory = [];
let pickerAnimating = false;

// ─── Helpers ───
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const uid = () => Math.random().toString(36).slice(2, 9);
const currentClass = () => state.classes.find(c => c.id === state.currentClassId);

// ═══════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════
function switchTool(tool) {
  state.currentTool = tool;

  // Tool nav buttons
  $$('.tool-nav button').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));

  // Tool pages
  $$('.tool-page').forEach(p => p.classList.remove('active'));
  $(`#${tool}Page`).classList.add('active');

  // Tool-specific toolbar controls
  $$('.tool-controls').forEach(c => c.classList.remove('active'));
  const tc = $(`.tool-controls[data-for="${tool}"]`);
  if (tc) tc.classList.add('active');

  // Re-render active tool
  if (tool === 'seating') requestAnimationFrame(renderSeats);
  if (tool === 'picker') renderPicker();
  if (tool === 'timer') renderTimer();
  if (tool === 'behaviour') renderBehaviour();
}

// ═══════════════════════════════════════════
// SHARED RENDERING
// ═══════════════════════════════════════════
function render() {
  renderClassSelect();
  renderLayoutButtons();
  renderViewToggle();
  renderRoster();
  renderSeats();
}

function renderClassSelect() {
  const sel = $('#classSelect');
  sel.innerHTML = state.classes.map(c =>
    `<option value="${c.id}" ${c.id === state.currentClassId ? 'selected' : ''}>${c.name}</option>`
  ).join('');
}

function renderLayoutButtons() {
  const group = $('#layoutGroup');
  group.innerHTML = Object.entries(LAYOUT_DEFS).map(([k, d]) =>
    `<button class="tb-btn ${state.layout === k ? 'active' : ''}" data-layout="${k}"><span class="icon">${d.icon}</span> ${d.label}</button>`
  ).join('');
  group.querySelectorAll('.tb-btn').forEach(b => b.addEventListener('click', () => {
    state.layout = b.dataset.layout;
    saveState(); render();
  }));
}

function renderViewToggle() {
  $('#viewToggle').querySelectorAll('button').forEach(b =>
    b.classList.toggle('active', b.dataset.view === state.view));
  $('#roomInner').classList.toggle('student-view', state.view === 'student');
}

function renderRoster() {
  const cls = currentClass();
  if (!cls) return;
  const roster = $('#roster');
  const assigned = cls.students.filter(s => s.seatIndex !== null && s.seatIndex !== undefined);

  roster.innerHTML = cls.students.map(s => {
    const isA = s.seatIndex !== null && s.seatIndex !== undefined;
    return `<div class="student-chip ${isA ? 'assigned' : ''}" draggable="${!isA}" data-student-id="${s.id}">
      <span class="dot"></span><span>${s.name}</span>
      <button class="remove" data-id="${s.id}" title="Remove">×</button></div>`;
  }).join('');

  roster.querySelectorAll('.student-chip:not(.assigned)').forEach(c => {
    c.addEventListener('dragstart', onDragStart);
    c.addEventListener('dragend', onDragEnd);
  });
  roster.querySelectorAll('.remove').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation(); removeStudent(b.dataset.id);
  }));
  $('#rosterFooter').textContent = `${cls.students.length} students · ${assigned.length} seated`;
}

// ═══════════════════════════════════════════
// SEATING PLAN
// ═══════════════════════════════════════════
function generatePositions(layout, cw, ch) {
  const sw = 120, sh = 56, positions = [];
  if (layout === 'rows') {
    const pG = 8, aG = 36, rH = sh + 18;
    const pW = 2 * sw + pG, tW = 3 * pW + 2 * aG;
    const sx = (cw - tW) / 2, tH = 5 * rH, sy = (ch - tH) / 2;
    for (let r = 0; r < 5; r++) for (let p = 0; p < 3; p++) for (let s = 0; s < 2; s++)
      positions.push({ left: sx + p * (pW + aG) + s * (sw + pG), top: sy + r * rH });
  } else if (layout === 'pairs') {
    const pG = 4, aG = 50, rH = sh + 22;
    const pW = 2 * sw + pG, tW = 2 * pW + aG;
    const sx = (cw - tW) / 2, sy = (ch - 7 * rH) / 2;
    for (let r = 0; r < 7; r++) for (let p = 0; p < 2; p++) for (let s = 0; s < 2; s++)
      positions.push({ left: sx + p * (pW + aG) + s * (sw + pG), top: sy + r * rH });
  } else if (layout === 'groups') {
    const iG = 6, gGx = 50, gGy = 40;
    const gW = 2 * sw + iG, gH = 2 * sh + iG;
    const tW = 3 * gW + 2 * gGx, tH = 2 * gH + gGy;
    const sx = (cw - tW) / 2, sy = (ch - tH) / 2;
    for (let gr = 0; gr < 2; gr++) for (let gc = 0; gc < 3; gc++) {
      const gx = sx + gc * (gW + gGx), gy = sy + gr * (gH + gGy);
      positions.push({ left: gx, top: gy }, { left: gx + sw + iG, top: gy }, { left: gx, top: gy + sh + iG }, { left: gx + sw + iG, top: gy + sh + iG });
    }
  } else if (layout === 'ushape') {
    const pad = 20, iW = cw - 2 * pad, iH = ch - 2 * pad;
    const tc = 6, tSp = (iW - tc * sw) / (tc + 1);
    for (let i = 0; i < tc; i++) positions.push({ left: pad + tSp + i * (sw + tSp), top: pad });
    const sc = 3, sSp = (iH - 2 * sh - sc * sh) / (sc + 1);
    for (let i = 0; i < sc; i++) positions.push({ left: pad, top: pad + sh + 20 + sSp + i * (sh + sSp) });
    for (let i = 0; i < sc; i++) positions.push({ left: iW + pad - sw, top: pad + sh + 20 + sSp + i * (sh + sSp) });
    for (let i = 0; i < tc; i++) positions.push({ left: pad + tSp + i * (sw + tSp), top: iH + pad - sh });
  } else if (layout === 'exam') {
    const c = 6, r = 5, hG = (cw - c * sw) / (c + 1), vG = (ch - r * sh) / (r + 1);
    for (let ri = 0; ri < r; ri++) for (let ci = 0; ci < c; ci++)
      positions.push({ left: hG + ci * (sw + hG), top: vG + ri * (sh + vG) });
  }
  return positions;
}

function renderSeats() {
  const cls = currentClass();
  if (!cls) return;
  const container = $('#seatsContainer');
  const rect = container.getBoundingClientRect();
  if (rect.width < 10) return; // not visible yet
  const positions = generatePositions(state.layout, rect.width, rect.height);
  container.innerHTML = '';
  positions.forEach((pos, i) => {
    const student = cls.students.find(s => s.seatIndex === i);
    const seat = document.createElement('div');
    seat.className = `seat ${student ? 'occupied' : 'empty'} ${student?.locked ? 'locked' : ''}`;
    seat.dataset.seatIndex = i;
    seat.style.left = pos.left + 'px';
    seat.style.top = pos.top + 'px';
    if (student) {
      seat.draggable = true;
      seat.dataset.studentId = student.id;
      seat.innerHTML = `<div class="seat-actions">
        <button class="seat-action-btn" data-action="lock" title="${student.locked ? 'Unlock' : 'Lock'}">${student.locked ? '🔓' : '🔒'}</button>
        <button class="seat-action-btn" data-action="unseat" title="Remove from seat">↩</button>
        </div><span class="seat-name">${student.name}</span>`;
      seat.addEventListener('dragstart', onDragStart);
      seat.addEventListener('dragend', onDragEnd);
      seat.querySelectorAll('.seat-action-btn').forEach(b => b.addEventListener('click', e => {
        e.stopPropagation();
        if (b.dataset.action === 'lock') toggleLock(student.id);
        if (b.dataset.action === 'unseat') unseatStudent(student.id);
      }));
    } else {
      seat.innerHTML = `<span class="seat-name" style="font-size:0.7rem;color:var(--text-muted)">Seat ${i + 1}</span>`;
    }
    seat.addEventListener('dragover', onDragOver);
    seat.addEventListener('dragenter', onDragEnter);
    seat.addEventListener('dragleave', onDragLeave);
    seat.addEventListener('drop', onDrop);
    container.appendChild(seat);
  });
}

// ─── Drag & Drop ───
let dragData = null;
function onDragStart(e) {
  dragData = { studentId: e.currentTarget.dataset.studentId };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragData.studentId);
  requestAnimationFrame(() => e.currentTarget.classList.add('dragging'));
}
function onDragEnd(e) { e.currentTarget.classList.remove('dragging'); $$('.seat.drag-over').forEach(el => el.classList.remove('drag-over')); dragData = null; }
function onDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
function onDragEnter(e) { e.preventDefault(); const s = e.currentTarget.closest('.seat'); if (s) s.classList.add('drag-over'); }
function onDragLeave(e) { const s = e.currentTarget.closest('.seat'); if (s && !s.contains(e.relatedTarget)) s.classList.remove('drag-over'); }
function onDrop(e) {
  e.preventDefault();
  const seat = e.currentTarget.closest('.seat');
  if (!seat || !dragData) return;
  seat.classList.remove('drag-over');
  const cls = currentClass(), si = parseInt(seat.dataset.seatIndex);
  const student = cls.students.find(s => s.id === dragData.studentId);
  if (!student) return;
  const existing = cls.students.find(s => s.seatIndex === si);
  if (existing && existing.id !== student.id) {
    existing.seatIndex = (student.seatIndex !== null && student.seatIndex !== undefined) ? student.seatIndex : null;
  }
  student.seatIndex = si;
  saveState(); render();
}

// ─── Seating Actions ───
function addStudents() {
  const input = $('#studentInput');
  const names = input.value.split('\n').map(n => n.trim()).filter(n => n);
  if (!names.length) return;
  const cls = currentClass();
  names.forEach(name => cls.students.push({ id: uid(), name, seatIndex: null, locked: false }));
  input.value = '';
  saveState(); render(); toast(`Added ${names.length} student${names.length > 1 ? 's' : ''}`);
}
function removeStudent(id) { const c = currentClass(); c.students = c.students.filter(s => s.id !== id); saveState(); render(); }
function toggleLock(id) { const s = currentClass().students.find(s => s.id === id); if (s) s.locked = !s.locked; saveState(); render(); }
function unseatStudent(id) { const s = currentClass().students.find(s => s.id === id); if (s) s.seatIndex = null; saveState(); render(); }

function shuffleSeats() {
  const cls = currentClass(), container = $('#seatsContainer'), rect = container.getBoundingClientRect();
  const positions = generatePositions(state.layout, rect.width, rect.height), max = positions.length;
  const unlocked = cls.students.filter(s => !s.locked);
  const locked = new Set(cls.students.filter(s => s.locked && s.seatIndex !== null).map(s => s.seatIndex));
  const avail = []; for (let i = 0; i < max; i++) if (!locked.has(i)) avail.push(i);
  for (let i = avail.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[avail[i], avail[j]] = [avail[j], avail[i]]; }
  unlocked.forEach((s, i) => { s.seatIndex = i < avail.length ? avail[i] : null; });
  saveState(); render(); toast('🎲 Seats shuffled!');
}

function autoAssign() {
  const cls = currentClass(), container = $('#seatsContainer'), rect = container.getBoundingClientRect();
  const positions = generatePositions(state.layout, rect.width, rect.height);
  const taken = new Set(cls.students.filter(s => s.seatIndex !== null && s.seatIndex !== undefined).map(s => s.seatIndex));
  const unassigned = cls.students.filter(s => s.seatIndex === null || s.seatIndex === undefined);
  let next = 0;
  unassigned.forEach(s => { while (next < positions.length && taken.has(next)) next++; if (next < positions.length) { s.seatIndex = next; taken.add(next); next++; } });
  saveState(); render(); toast('⚡ Students auto-assigned!');
}

function clearSeats() {
  currentClass().students.forEach(s => { if (!s.locked) s.seatIndex = null; });
  saveState(); render(); toast('🧹 Seats cleared');
}

// ─── Classes ───
function addClass() { const n = prompt('New class name:'); if (!n) return; const id = uid(); state.classes.push({ id, name: n, students: [], arrangements: {} }); state.currentClassId = id; saveState(); render(); toast(`Created "${n}"`); }
function renameClass() { const c = currentClass(), n = prompt('Rename class:', c.name); if (!n) return; c.name = n; saveState(); render(); }

// ─── Save/Load Arrangements ───
function openSaveModal() { $('#saveModal').classList.add('active'); $('#saveNameInput').value = ''; setTimeout(() => $('#saveNameInput').focus(), 100); }
function closeSaveModal() { $('#saveModal').classList.remove('active'); }
function confirmSave() {
  const n = $('#saveNameInput').value.trim(); if (!n) return;
  const c = currentClass(); if (!c.arrangements) c.arrangements = {};
  c.arrangements[n] = c.students.map(s => ({ id: s.id, seatIndex: s.seatIndex, locked: s.locked }));
  closeSaveModal(); saveState(); toast(`💾 Saved "${n}"`);
}
function toggleLoadDropdown() {
  const dd = $('#arrangementsDropdown'), c = currentClass(), arr = c.arrangements || {}, keys = Object.keys(arr);
  if (dd.classList.contains('show')) { dd.classList.remove('show'); return; }
  dd.innerHTML = keys.length === 0 ? '<div class="arr-empty">No saved arrangements</div>' :
    keys.map(k => `<div class="arr-item"><span class="arr-name" data-name="${k}">${k}</span><button class="arr-delete" data-name="${k}">🗑</button></div>`).join('');
  dd.querySelectorAll('.arr-name').forEach(el => el.addEventListener('click', () => loadArrangement(el.dataset.name)));
  dd.querySelectorAll('.arr-delete').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); deleteArrangement(el.dataset.name); }));
  dd.classList.add('show');
}
function loadArrangement(name) {
  const c = currentClass(), arr = c.arrangements?.[name]; if (!arr) return;
  arr.forEach(saved => { const s = c.students.find(st => st.id === saved.id); if (s) { s.seatIndex = saved.seatIndex; s.locked = saved.locked; } });
  $('#arrangementsDropdown').classList.remove('show'); saveState(); render(); toast(`📂 Loaded "${name}"`);
}
function deleteArrangement(name) { delete currentClass().arrangements[name]; saveState(); toggleLoadDropdown(); toast(`Deleted "${name}"`); }

// ═══════════════════════════════════════════
// RANDOM PICKER
// ═══════════════════════════════════════════
function renderPicker() {
  const hist = $('#pickerHistory');
  hist.innerHTML = pickerHistory.map(n => `<span class="picker-history-chip">${n}</span>`).join('');
}

function pickRandom() {
  const cls = currentClass();
  if (!cls || !cls.students.length || pickerAnimating) return;

  const exclude = $('#excludePicked').checked;
  let pool = cls.students.map(s => s.name);
  if (exclude) pool = pool.filter(n => !pickerHistory.includes(n));
  if (!pool.length) { toast('All students have been picked!'); return; }

  pickerAnimating = true;
  const card = $('#pickerCard');
  const nameEl = $('#pickerName');
  card.classList.remove('revealed');

  const target = pool[Math.floor(Math.random() * pool.length)];
  let interval = 40, elapsed = 0, maxTime = 2000;

  function cycle() {
    const random = cls.students[Math.floor(Math.random() * cls.students.length)].name;
    nameEl.textContent = random;
    elapsed += interval;

    if (elapsed >= maxTime) {
      nameEl.textContent = target;
      card.classList.add('revealed');
      pickerHistory.unshift(target);
      if (pickerHistory.length > 20) pickerHistory.pop();
      renderPicker();
      pickerAnimating = false;
      return;
    }
    interval = Math.min(interval * 1.08, 200);
    setTimeout(cycle, interval);
  }
  cycle();
}

function generateGroups() {
  const cls = currentClass();
  if (!cls || !cls.students.length) return;
  const size = parseInt($('#groupSizeInput').value) || 4;
  const names = [...cls.students.map(s => s.name)];

  // Shuffle
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }

  const groups = [];
  for (let i = 0; i < names.length; i += size) {
    groups.push(names.slice(i, i + size));
  }

  const grid = $('#groupsGrid');
  grid.innerHTML = groups.map((g, i) => `
    <div class="group-card" style="animation: fadeIn 0.3s ease ${i * 0.08}s both">
      <h4>Group ${i + 1}</h4>
      <ul>${g.map(n => `<li>${n}</li>`).join('')}</ul>
    </div>
  `).join('');

  toast(`👥 Created ${groups.length} groups of ~${size}`);
}

// ═══════════════════════════════════════════
// TIMER
// ═══════════════════════════════════════════
const CIRCUMFERENCE = 2 * Math.PI * 130; // ~816.8

function renderTimer() {
  const mins = Math.floor(timer.remaining / 60);
  const secs = timer.remaining % 60;
  $('#timerTime').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

  const progress = timer.duration > 0 ? timer.remaining / timer.duration : 0;
  const offset = CIRCUMFERENCE * (1 - progress);
  const ring = $('#timerProgress');
  ring.setAttribute('stroke-dashoffset', offset);

  // Traffic light colors
  ring.classList.remove('warning', 'danger');
  const container = $('#timerContainer');
  container.classList.remove('warning', 'danger', 'finished');

  if (progress <= 0 && timer.duration > 0) {
    container.classList.add('finished');
    ring.classList.add('danger');
  } else if (progress <= 0.2) {
    ring.classList.add('danger');
    container.classList.add('danger');
  } else if (progress <= 0.5) {
    ring.classList.add('warning');
    container.classList.add('warning');
  }

  // Label
  const label = $('#timerLabel');
  if (timer.running) label.textContent = 'Running';
  else if (timer.remaining <= 0) label.textContent = "Time's up!";
  else if (timer.remaining === timer.duration) label.textContent = 'Ready';
  else label.textContent = 'Paused';

  // Play button icon
  $('#timerPlayBtn').textContent = timer.running ? '⏸' : '▶';

  // Presets highlight
  $$('.preset-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.seconds) === timer.duration && !timer.running));
}

function startPauseTimer() {
  if (timer.running) {
    clearInterval(timer.interval);
    timer.running = false;
  } else {
    if (timer.remaining <= 0) { timer.remaining = timer.duration; }
    timer.running = true;
    timer.interval = setInterval(() => {
      timer.remaining--;
      if (timer.remaining <= 0) {
        timer.remaining = 0;
        clearInterval(timer.interval);
        timer.running = false;
        playTimerSound();
      }
      renderTimer();
    }, 1000);
  }
  renderTimer();
}

function resetTimer() {
  clearInterval(timer.interval);
  timer.running = false;
  timer.remaining = timer.duration;
  renderTimer();
}

function setTimerPreset(seconds) {
  clearInterval(timer.interval);
  timer.running = false;
  timer.duration = seconds;
  timer.remaining = seconds;
  renderTimer();
}

function addOneMinute() {
  timer.duration += 60;
  timer.remaining += 60;
  renderTimer();
}

function setCustomTime() {
  const m = parseInt($('#customMinutes').value) || 0;
  const s = parseInt($('#customSeconds').value) || 0;
  const total = m * 60 + s;
  if (total > 0) setTimerPreset(total);
}

function playTimerSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.3, 0.6].forEach(delay => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 800;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.25);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.25);
    });
  } catch (e) { /* audio not available */ }
}

// ═══════════════════════════════════════════
// BEHAVIOUR LOGGER
// ═══════════════════════════════════════════
function getBehaviourData(classId, studentId) {
  if (!state.behaviour[classId]) state.behaviour[classId] = {};
  if (!state.behaviour[classId][studentId]) state.behaviour[classId][studentId] = { merits: 0, concerns: 0, notes: [] };
  return state.behaviour[classId][studentId];
}

function renderBehaviour() {
  const cls = currentClass();
  if (!cls) return;

  let totalM = 0, totalC = 0;
  cls.students.forEach(s => {
    const d = getBehaviourData(cls.id, s.id);
    totalM += d.merits; totalC += d.concerns;
  });

  $('#behaviourStats').innerHTML = `
    <div class="behaviour-stat merits"><span class="val">${totalM}</span> merits</div>
    <div class="behaviour-stat concerns"><span class="val">${totalC}</span> concerns</div>`;

  const grid = $('#behaviourGrid');
  grid.innerHTML = cls.students.map(s => {
    const d = getBehaviourData(cls.id, s.id);
    const score = d.merits - d.concerns;
    const scoreClass = score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
    const noteCount = d.notes.length;
    return `<div class="behaviour-card">
      <span class="student-name">${s.name}</span>
      <div class="counters">
        <button class="counter-btn concern" data-id="${s.id}" data-type="concern" title="Add concern">−</button>
        <span class="score ${scoreClass}">${score >= 0 ? '+' : ''}${score}</span>
        <button class="counter-btn merit" data-id="${s.id}" data-type="merit" title="Add merit">+</button>
      </div>
      <button class="note-btn" data-id="${s.id}" data-name="${s.name}" title="Add note">
        📝${noteCount ? `<span class="note-count">(${noteCount})</span>` : ''}
      </button>
    </div>`;
  }).join('');

  grid.querySelectorAll('.counter-btn').forEach(b => b.addEventListener('click', () => {
    const d = getBehaviourData(cls.id, b.dataset.id);
    if (b.dataset.type === 'merit') d.merits++;
    else d.concerns++;
    saveState(); renderBehaviour();
  }));

  grid.querySelectorAll('.note-btn').forEach(b => b.addEventListener('click', () => {
    openNoteModal(b.dataset.id, b.dataset.name);
  }));
}

let noteTargetId = null;
function openNoteModal(id, name) {
  noteTargetId = id;
  $('#noteStudentName').textContent = `Student: ${name}`;
  const cls = currentClass();
  const d = getBehaviourData(cls.id, id);
  // Show existing notes
  const existingNotes = d.notes.length
    ? d.notes.map(n => `• ${n.text} (${new Date(n.time).toLocaleString()})`).join('\n')
    : '';
  $('#noteInput').value = '';
  $('#noteInput').placeholder = existingNotes ? `Previous notes:\n${existingNotes}\n\nAdd new note...` : 'Enter a note...';
  $('#noteModal').classList.add('active');
  setTimeout(() => $('#noteInput').focus(), 100);
}
function closeNoteModal() { $('#noteModal').classList.remove('active'); noteTargetId = null; }
function confirmNote() {
  const text = $('#noteInput').value.trim();
  if (!text || !noteTargetId) return;
  const cls = currentClass();
  const d = getBehaviourData(cls.id, noteTargetId);
  d.notes.push({ text, time: Date.now() });
  closeNoteModal(); saveState(); renderBehaviour();
  toast('📝 Note added');
}

function resetBehaviour() {
  if (!confirm('Reset all merits, concerns, and notes for this class?')) return;
  const cls = currentClass();
  state.behaviour[cls.id] = {};
  saveState(); renderBehaviour(); toast('🔄 Behaviour data reset');
}

function exportBehaviourCSV() {
  const cls = currentClass();
  if (!cls) return;
  let csv = 'Student,Merits,Concerns,Score,Notes\n';
  cls.students.forEach(s => {
    const d = getBehaviourData(cls.id, s.id);
    const notes = d.notes.map(n => n.text).join('; ');
    csv += `"${s.name}",${d.merits},${d.concerns},${d.merits - d.concerns},"${notes}"\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${cls.name}_behaviour_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  toast('📊 CSV exported');
}

// ═══════════════════════════════════════════
// PERSISTENCE
// ═══════════════════════════════════════════
function saveState() { localStorage.setItem('seatflow_state', JSON.stringify(state)); }
function loadState() {
  const saved = localStorage.getItem('seatflow_state');
  if (saved) { try { state = { ...state, ...JSON.parse(saved) }; } catch (e) { } }
  if (!state.classes.length) {
    const id = uid();
    state.classes.push({ id, name: 'My Class', students: [], arrangements: {} });
    state.currentClassId = id;
  }
  if (!state.currentClassId) state.currentClassId = state.classes[0].id;
  if (!state.behaviour) state.behaviour = {};
}

// ═══════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show', 'success');
  setTimeout(() => t.classList.remove('show', 'success'), 2400);
}

// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
function setup() {
  loadState();

  requestAnimationFrame(() => {
    render();
    renderTimer();

    let rt;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (state.currentTool === 'seating') renderSeats(); }, 150); });
  });

  // Navigation
  $$('.tool-nav button').forEach(b => b.addEventListener('click', () => switchTool(b.dataset.tool)));

  // Seating controls
  $('#shuffleBtn').addEventListener('click', shuffleSeats);
  $('#autoAssignBtn').addEventListener('click', autoAssign);
  $('#clearBtn').addEventListener('click', clearSeats);
  $('#saveBtn').addEventListener('click', openSaveModal);
  $('#loadBtn').addEventListener('click', toggleLoadDropdown);
  $('#printBtn').addEventListener('click', () => window.print());
  $('#viewToggle').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    state.view = b.dataset.view; saveState(); renderViewToggle();
  }));

  // Sidebar
  $('#addStudentsBtn').addEventListener('click', addStudents);
  $('#studentInput').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addStudents(); });
  $('#classSelect').addEventListener('change', e => { state.currentClassId = e.target.value; saveState(); render(); });
  $('#addClassBtn').addEventListener('click', addClass);
  $('#renameClassBtn').addEventListener('click', renameClass);

  // Picker
  $('#pickRandomBtn').addEventListener('click', pickRandom);
  $('#generateGroupsBtn').addEventListener('click', generateGroups);
  $('#clearHistoryBtn').addEventListener('click', () => { pickerHistory = []; renderPicker(); toast('History cleared'); });

  // Timer
  $('#timerPlayBtn').addEventListener('click', startPauseTimer);
  $('#timerResetBtn').addEventListener('click', resetTimer);
  $('#timerAddBtn').addEventListener('click', addOneMinute);
  $$('.preset-btn').forEach(b => b.addEventListener('click', () => setTimerPreset(parseInt(b.dataset.seconds))));
  $('#setCustomTimeBtn').addEventListener('click', setCustomTime);
  $('#customMinutes').addEventListener('keydown', e => { if (e.key === 'Enter') setCustomTime(); });
  $('#customSeconds').addEventListener('keydown', e => { if (e.key === 'Enter') setCustomTime(); });

  // Behaviour
  $('#resetBehaviourBtn').addEventListener('click', resetBehaviour);
  $('#exportBehaviourBtn').addEventListener('click', exportBehaviourCSV);

  // Modals
  $('#saveNameInput').addEventListener('keydown', e => { if (e.key === 'Enter') confirmSave(); if (e.key === 'Escape') closeSaveModal(); });
  $('#noteInput').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) confirmNote(); if (e.key === 'Escape') closeNoteModal(); });

  // Close dropdowns
  document.addEventListener('click', e => {
    const dd = $('#arrangementsDropdown');
    if (dd.classList.contains('show') && !dd.contains(e.target) && e.target.id !== 'loadBtn') dd.classList.remove('show');
  });

  // Sidebar drop target
  const roster = $('#roster');
  roster.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
  roster.addEventListener('drop', e => {
    e.preventDefault(); if (!dragData) return;
    const s = currentClass().students.find(s => s.id === dragData.studentId);
    if (s) { s.seatIndex = null; saveState(); render(); }
  });

  // Start on seating tool
  switchTool(state.currentTool || 'seating');
}

document.addEventListener('DOMContentLoaded', setup);
