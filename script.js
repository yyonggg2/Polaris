/* ══════════════════════════════════════════════════════════════
   Perigee — every goal becomes a song.

   Four layers, kept apart on purpose:
     LOGIC  — owns the data. Knows nothing about sound or the DOM.
     MUSIC  — turns Logic's data into a real score: keys, modes,
              rhythm, cadences. Plays it.
     SHEET  — the same score engraved, and written out as MusicXML,
              MIDI and SVG you can download.
     UI     — buttons, rendering, and the reward that fires when a
              movement closes.
   ══════════════════════════════════════════════════════════════ */


/* ══ LOGIC ═════════════════════════════════════════════════════ */

/* The four levels and the hours each one pre-fills. 'other' is a level too,
   but it carries no default — the user types the number themselves. */
const EFFORT_HOURS = {
  barely:   0.5,
  a_little: 1,
  a_while:  2.5,
  immersed: 4,
  other:    null,
};

const EFFORT_LABEL = {
  barely:   'Barely did anything',
  a_little: 'Touched on it a little',
  a_while:  'Worked on it for a while',
  immersed: 'Fully immersed',
  other:    'Other',
};

/* An 'other' day has hours but no level, and the music and the rarity both
   want a level. Read one back off the clock, using the four defaults as the
   midpoints of their bands. */
function effortBand(log) {
  if (log.effort !== 'other') return log.effort;
  const h = log.hours;
  if (h < 0.75) return 'barely';
  if (h < 1.75) return 'a_little';
  if (h < 3.25) return 'a_while';
  return 'immersed';
}

/* Moods are drawn, not typed: each one is a bubble lifted out of the
   scene with a face in it, tinted along the reef palette — rose down
   at the bottom, gold at the top. Faces live here as SVG so the picker
   and the timeline can't drift apart. */
const MOODS = [
  { score: 1, word: 'rough', label: 'A rough day' },
  { score: 2, word: 'flat',  label: 'A flat day' },
  { score: 3, word: 'good',  label: 'A good day' },
  { score: 4, word: 'great', label: 'A great day' },
];

const MOOD_LABEL = MOODS.reduce((m, x) => ({ ...m, [x.score]: x.label }), {});

/* Eyes and mouth only — the bubble around them is shared. Everything is
   a stroke, including the eyes (a zero-length round-capped path is a dot),
   so one CSS rule controls the whole line weight. */
const MOOD_FEATURES = {
  1: '<path d="M16 19.5v.01"/><path d="M28 19.5v.01"/><path d="M15.5 30q6.5-5.5 13 0"/>',
  2: '<path d="M16 19.5v.01"/><path d="M28 19.5v.01"/><path d="M16 28h12"/>',
  3: '<path d="M16 19v.01"/><path d="M28 19v.01"/><path d="M15.5 26.5q6.5 5.5 13 0"/>',
  4: '<path d="M13.6 20.5q2.9-3.4 5.8 0"/><path d="M24.6 20.5q2.9-3.4 5.8 0"/>' +
     '<path d="M14 25.5q8 8 16 0"/>',
};

/** One mood face, ready to drop into markup. */
function moodFace(score) {
  const spark = score === 4
    ? '<path class="mf-spark" d="M36 6.5 37.2 10.3 41 11.5 37.2 12.7 36 16.5 34.8 12.7 31 11.5 34.8 10.3Z"/>'
    : '';
  return `<svg class="mood-face" viewBox="0 0 44 44" aria-hidden="true">
      <circle class="mf-bubble" cx="22" cy="22" r="16.5"/>
      <ellipse class="mf-shine" cx="14.2" cy="12.2" rx="4.6" ry="2.9"
               transform="rotate(-30 14.2 12.2)"/>
      <g class="mf-ink">${MOOD_FEATURES[score] || MOOD_FEATURES[3]}</g>
      ${spark}
    </svg>`;
}

const STORAGE_KEY = 'perigee.goal.v1';

let state = {
  goalName: '',
  subtasks: [],   // { taskId, taskName, status, dailyLogs[] }
  currentDate: '',   // ISO 'YYYY-MM-DD'; set to today on boot
};

/* ── Dates ─────────────────────────────────────────────────────
   Days are real calendar dates, stored as ISO 'YYYY-MM-DD'. That
   string sorts chronologically on its own, so ordering stays simple.
   Everything below builds Dates at *local* midnight — going through
   toISOString() would shift the date by a day in western timezones. */

function toISO(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function fromISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function todayISO() {
  return toISO(new Date());
}

function shiftISO(iso, days) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

/** Inclusive calendar span between two dates, in days. */
function daysBetween(a, b) {
  return Math.round((fromISO(b) - fromISO(a)) / 86400000) + 1;
}

/** 'Fri Aug 8' — with the year appended when it isn't the current one. */
function formatDay(iso) {
  const d = fromISO(iso);
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
}

/** Add a subtask. Returns the new taskId. */
function addSubtask(taskName) {
  const name = String(taskName || '').trim();
  if (!name) return null;

  const taskId = makeTaskId(name);

  state.subtasks.push({
    taskId,
    taskName: name,
    status: 'active',
    dailyLogs: [],
  });

  save();
  return taskId;
}

/** Delete a subtask and everything logged against it. */
function deleteSubtask(taskId) {
  const before = state.subtasks.length;
  state.subtasks = state.subtasks.filter((t) => t.taskId !== taskId);
  save();
  return state.subtasks.length < before;
}

/** Mark a subtask done — always a manual decision, never automatic. */
function completeSubtask(taskId) {
  const task = findSubtask(taskId);
  if (!task) return false;
  task.status = 'completed';
  save();
  return true;
}

/** Give up on a subtask. The logs stay — they still become music. */
function giveUpSubtask(taskId) {
  const task = findSubtask(taskId);
  if (!task) return false;
  task.status = 'given_up';
  save();
  return true;
}

/**
 * Undo a complete / give-up: put the subtask back to active.
 * Nothing is lost either way — the daily logs were never touched.
 */
function reopenSubtask(taskId) {
  const task = findSubtask(taskId);
  if (!task || task.status === 'active') return false;
  task.status = 'active';
  save();
  return true;
}

/**
 * Log a day against a subtask.
 * date:   ISO 'YYYY-MM-DD' (defaults to today)
 * effort: 'barely' | 'a_little' | 'a_while' | 'immersed' | 'other'
 * hours:  defaults to the effort level's hours, but the user can override —
 *         'other' has no default, so the hours come from the user
 * mood:   1–4
 */
function addDailyLog(taskId, date, effort, hours, mood) {
  const task = findSubtask(taskId);
  if (!task) return false;

  const iso = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayISO();
  const level = effort in EFFORT_HOURS ? effort : 'a_little';
  const blank = hours === undefined || hours === null || hours === '';
  const entry = {
    date: iso,
    effort: level,
    // 'other' has no default to fall back on, so a blank one is simply zero.
    hours: blank ? (EFFORT_HOURS[level] || 0) : Math.max(0, Number(hours)),
    mood: Math.min(4, Math.max(1, Math.round(Number(mood) || 3))),
  };

  // One log per subtask per day — a second submit overwrites the first.
  const existing = task.dailyLogs.findIndex((l) => l.date === iso);
  if (existing >= 0) task.dailyLogs[existing] = entry;
  else task.dailyLogs.push(entry);

  task.dailyLogs.sort((a, b) => a.date.localeCompare(b.date));
  save();
  return true;
}

/**
 * Everything logged on one day, across all subtasks.
 * More than one entry → Music plays a chord instead of a single note.
 */
function getDataForDay(date) {
  const entries = [];

  state.subtasks.forEach((task) => {
    task.dailyLogs.forEach((log) => {
      if (log.date !== date) return;
      entries.push({
        taskId: task.taskId,
        taskName: task.taskName,
        status: task.status,
        effort: log.effort,
        hours: log.hours,
        mood: log.mood,
      });
    });
  });

  return { date, entries, isChord: entries.length > 1 };
}

/** Total hours logged against a subtask. */
function loggedHours(taskId) {
  const task = findSubtask(taskId);
  if (!task) return 0;
  return task.dailyLogs.reduce((sum, l) => sum + l.hours, 0);
}

/** The whole journey, ordered — this is what Music turns into a song. */
function getFullGoalData() {
  return {
    goalName: state.goalName || 'Untitled goal',
    subtasks: state.subtasks.map((task) => ({
      taskId: task.taskId,
      taskName: task.taskName,
      status: task.status,
      dailyLogs: task.dailyLogs.map((l) => ({ ...l })),
    })),
  };
}

/* ── Logic helpers ─────────────────────────────────────────── */

function findSubtask(taskId) {
  return state.subtasks.find((t) => t.taskId === taskId) || null;
}

function makeTaskId(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'task';
  let id = base;
  let n = 2;
  while (findSubtask(id)) id = `${base}-${n++}`;
  return id;
}

/** The subtask the app is currently on — the first one still active. */
function getCurrentSubtask() {
  return state.subtasks.find((t) => t.status === 'active') || null;
}

/** Every date that has at least one log, chronologically. */
function getLoggedDays() {
  const days = new Set();
  state.subtasks.forEach((t) => t.dailyLogs.forEach((l) => days.add(l.date)));
  return [...days].sort((a, b) => a.localeCompare(b));
}

function isGoalFinished() {
  return state.subtasks.length > 0 && state.subtasks.every((t) => t.status !== 'active');
}

function hasAnyLogs() {
  return state.subtasks.some((t) => t.dailyLogs.length > 0);
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    /* storage unavailable — the session still works, it just won't persist */
  }
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.subtasks)) state = migrate(parsed);
  } catch (e) {
    /* corrupt save — start fresh rather than block the app */
  }
}

/**
 * Saves from the day-number era stored { day: 1, 2, 3… } with no real
 * dates. Rather than drop those logs, anchor the highest day number to
 * today and count backwards, which preserves the spacing between days.
 */
function migrate(data) {
  const logs = (data.subtasks || []).flatMap((t) => t.dailyLogs || []);
  const old = logs.filter((l) => l.date === undefined && typeof l.day === 'number');

  if (old.length) {
    const maxDay = Math.max(...old.map((l) => l.day));
    old.forEach((l) => {
      l.date = shiftISO(todayISO(), l.day - maxDay);
      delete l.day;
    });
    (data.subtasks || []).forEach((t) => {
      (t.dailyLogs || []).sort((a, b) => a.date.localeCompare(b.date));
    });
  }

  if (!data.currentDate) data.currentDate = todayISO();
  delete data.currentDay;

  if (old.length) {
    const saved = state;
    state = data;
    save();
    state = saved;
  }
  return data;
}


/* ══ MUSIC ═════════════════════════════════════════════════════ */

/*  How the work becomes a piece of music.

    A goal is a suite. Every subtask that got worked on is one movement,
    and each movement is written in its own key and its own church mode,
    picked from how those particular days actually felt:

      mood   → which mode the movement lives in (Lydian ↔ Phrygian),
               and how high the melody sits inside it
      effort → the rhythm of the day: how many notes, and how long
      1 entry on a day  → a single note
      2+ entries on a day → a chord, built in thirds out of that mode

    Endings are real cadences, not just "a nice chord":
      completed → authentic, V–I. The leading tone is raised even in the
                  minor modes so the dominant actually pulls, and a minor
                  movement lands on a Picardy third. You hear it arrive.
      given up  → deceptive, V–vi. Everything sets up the tonic and then
                  the floor moves. It's left ringing, unresolved — but it
                  is still a sound, which is the whole point.
      still open→ half cadence. The movement stops on the dominant, which
                  is a question, not a full stop.

    Which family a movement lands in is not left entirely to the data.
    Mood picks the *shade* — how dark or bright inside a family — but the
    *family* is on a rota: every third movement is a shadow movement, even
    when those particular days were fine. A suite that stays bright the
    whole way through has nowhere to fall and nothing to come back from,
    so about a third of the work is written minor on purpose.

    The data still outranks the pattern in one direction: a movement whose
    days were genuinely bad goes to shadow wherever it sits in the rota.
    Nothing gets written cheerful just because it was its turn.            */

/* Church modes, darkest to brightest. `offset` is how many positions the
   mode sits from Ionian on the circle of fifths, which is exactly what
   the key signature needs. */
const MODES = {
  phrygian:   { steps: [0, 1, 3, 5, 7, 8, 10], offset: -4, name: 'Phrygian',   feel: 'dread',           family: 'shadow' },
  aeolian:    { steps: [0, 2, 3, 5, 7, 8, 10], offset: -3, name: 'Aeolian',    feel: 'plain sorrow',    family: 'shadow' },
  dorian:     { steps: [0, 2, 3, 5, 7, 9, 10], offset: -2, name: 'Dorian',     feel: 'a hopeful ache',  family: 'shadow' },
  mixolydian: { steps: [0, 2, 4, 5, 7, 9, 10], offset: -1, name: 'Mixolydian', feel: 'warm, unhurried', family: 'bright' },
  ionian:     { steps: [0, 2, 4, 5, 7, 9, 11], offset:  0, name: 'Ionian',     feel: 'clear daylight',  family: 'bright' },
  lydian:     { steps: [0, 2, 4, 6, 7, 9, 11], offset:  1, name: 'Lydian',     feel: 'weightless',      family: 'bright' },
};

const MODE_ORDER = ['phrygian', 'aeolian', 'dorian', 'mixolydian', 'ionian', 'lydian'];

/* Two ladders of three, darkest rung first. Mood picks the rung; the
   rota picks which ladder you climb. */
const SHADOW_LADDER = ['phrygian', 'aeolian', 'dorian'];
const BRIGHT_LADDER = ['mixolydian', 'ionian', 'lydian'];

/* The suite walks these tonics in order, so no two neighbouring movements
   sit in the same key. Their own position on the circle of fifths is
   stored here — mode offset gets added to it to get the key signature. */
const TONICS = [
  { pc: 0,  fifths:  0, name: 'C'  },
  { pc: 7,  fifths:  1, name: 'G'  },
  { pc: 5,  fifths: -1, name: 'F'  },
  { pc: 2,  fifths:  2, name: 'D'  },
  { pc: 10, fifths: -2, name: 'B♭' },
  { pc: 9,  fifths:  3, name: 'A'  },
  { pc: 3,  fifths: -3, name: 'E♭' },
];

/* Effort becomes rhythm. `notes` are note lengths in beats; `bar` is how
   much of the bar the whole day takes up, so 'barely' leaves a hesitation
   of rest after its one short note and 'immersed' fills a whole measure. */
const EFFORT_RHYTHM = {
  barely:   { notes: [0.5],                bar: 1, vel: 0.36 },
  a_little: { notes: [1],                  bar: 1, vel: 0.50 },
  a_while:  { notes: [0.5, 1.5],           bar: 2, vel: 0.66 },
  immersed: { notes: [0.5, 0.5, 1, 2],     bar: 4, vel: 0.82 },
};

/* Mood picks where in the mode the day sits. Good days sit high. */
const MOOD_DEGREE = { 1: 0, 2: 2, 3: 4, 4: 7 };

/* And which chord a shared day builds, when two subtasks land together:
   i, vi, iv, V — the four chords most of western music runs on. */
const MOOD_CHORD_ROOT = { 1: 0, 2: 5, 3: 3, 4: 4 };

const BEATS_PER_MEASURE = 4;
const ROOT_MIDI = 60;   // middle C — the tonic of the first movement

let audioCtx = null;
let master = null;
let activeNodes = [];
let currentScore = null;   // rebuilt on every render; downloads read it
let isPlaying = false;
let playEndTimer = null;

/** Swap the hero play button between ▶ and ❙❙, and its tooltip to match. */
function updatePlayIcon() {
  const hotspot = document.getElementById('playHotspot');
  const icon = document.getElementById('playIcon');
  if (!hotspot || !icon) return;
  const tip = isPlaying ? 'Stop' : 'Play the song';
  icon.innerHTML = isPlaying
    ? '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'
    : '<path d="M8 5v14l11-7z"/>';
  hotspot.dataset.tip = tip;
  hotspot.setAttribute('aria-label', tip);
}

/** The hero play button calls this -- open the listening view if idle,
 * close it if already going. */
function togglePlay() {
  if (isPlaying) closePlayer();
  else openPlayer();
}

/* ── The player — a full-screen listening view ────────────────────────
   Opens when the hero play button is pressed: the lavender moon spins in
   place while notes fly out of it, timed to the music. With the diary
   toggle on, each new day's worth of notes also surfaces the real logged
   state for that day -- task, mood, effort -- so the notes can be read
   against what was actually going on, not an invented caption. */
let playerVisualTimers = [];
let lastDiaryKey = null;

function openPlayer(goalData) {
  const score = composeScore(goalData || getFullGoalData());
  if (!score.melody.length) {
    uiSongMessage('Nothing to play yet — log a day first.', true);
    return;
  }

  stopSong();
  stopPlayerVisuals();

  document.getElementById('playerTitle').textContent = score.title;
  document.getElementById('playerSub').textContent = score.subtitle;
  document.getElementById('playerNotes').innerHTML = '';
  const diaryEl = document.getElementById('playerDiary');
  diaryEl.textContent = '';
  diaryEl.classList.remove('show');
  lastDiaryKey = null;

  const overlay = document.getElementById('playerOverlay');
  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add('open'));

  if (window.startPlayerMoon) window.startPlayerMoon(document.getElementById('playerMoonCanvas'));

  playScore(score);
  isPlaying = true;
  updatePlayIcon();
  schedulePlayerVisuals(score);

  clearTimeout(playEndTimer);
  playEndTimer = setTimeout(() => { isPlaying = false; updatePlayIcon(); }, score.duration * 1000);
}

function closePlayer() {
  const overlay = document.getElementById('playerOverlay');
  overlay.classList.remove('open');
  setTimeout(() => { overlay.hidden = true; }, 260);

  stopSong();
  stopPlayerVisuals();
  if (window.stopPlayerMoon) window.stopPlayerMoon();
}

function toggleDiary() {
  const btn = document.getElementById('diaryToggle');
  const on = btn.getAttribute('aria-pressed') !== 'true';
  btn.setAttribute('aria-pressed', String(on));
  btn.dataset.tip = on ? 'Close the diary' : 'Open the diary';
  if (!on) {
    const diary = document.getElementById('playerDiary');
    diary.classList.remove('show');
    lastDiaryKey = null;
  }
}

/** One setTimeout per note, matching playScore()'s own audio-clock math
 * (same 0.12s lookahead) closely enough that the visuals read as synced. */
function schedulePlayerVisuals(score) {
  const spb = 60 / score.tempo;
  score.melody.forEach((ev) => {
    const delay = (ev.beat * spb + 0.12) * 1000;
    playerVisualTimers.push(setTimeout(() => spawnNoteVisual(ev), delay));
  });
}

function stopPlayerVisuals() {
  playerVisualTimers.forEach(clearTimeout);
  playerVisualTimers = [];
}

// A generous ~3-octave window around the tonic (ROOT_MIDI=60) -- covers
// the range composeScore() actually writes into without hard failing on
// anything that lands outside it (clamped below).
const PLAYER_PITCH_LOW = 45;
const PLAYER_PITCH_HIGH = 90;

/** 0 (lowest notes in range) .. 1 (highest) -- what ties a spark's
 * launch direction and the staff's pulse reach back to the real pitch. */
function pitchNorm(ev) {
  const avg = ev.midis.reduce((s, m) => s + m, 0) / ev.midis.length;
  return Math.min(1, Math.max(0, (avg - PLAYER_PITCH_LOW) / (PLAYER_PITCH_HIGH - PLAYER_PITCH_LOW)));
}

/** Rings light up from the centre outward, one note at a time -- how
 * many of the five reach depends on how high the note actually is, so
 * a low note barely stirs the middle while a high one runs the ring. */
function pulseStaff(norm) {
  const rings = document.querySelectorAll('.player-ring');
  const reach = Math.max(1, Math.round(norm * rings.length));
  rings.forEach((ring, i) => {
    if (i >= reach) return;
    setTimeout(() => {
      ring.classList.remove('pulse');
      void ring.offsetWidth; // restart the transition if it's still mid-fade
      ring.classList.add('pulse');
      setTimeout(() => ring.classList.remove('pulse'), 420);
    }, i * 45);
  });
}

function spawnNoteVisual(ev) {
  const norm = pitchNorm(ev);
  const wrap = document.getElementById('playerNotes');
  if (wrap) {
    // Thrown from the moon's own surface, not from an arbitrary point in
    // the middle of the stage -- the note reads as coming out of it. The
    // launch direction leans up for high notes, down for low ones, so
    // the throw itself carries the pitch, not just a random scatter.
    const moonRadius = wrap.getBoundingClientRect().width * 0.21;
    const baseAngle = Math.PI / 2 - norm * Math.PI; // low -> down, high -> up
    const angle = baseAngle + (Math.random() - 0.5) * 1.1;
    const dist = 60 + Math.random() * 90;
    const sx = Math.cos(angle) * moonRadius;
    const sy = Math.sin(angle) * moonRadius;
    const s = document.createElement('span');
    s.className = 'player-note-spark';
    s.textContent = ev.midis.length > 1 ? '♫' : '♪';
    s.style.setProperty('--sx', `${sx}px`);
    s.style.setProperty('--sy', `${sy}px`);
    s.style.setProperty('--dx', `${Math.cos(angle) * (moonRadius + dist)}px`);
    s.style.setProperty('--dy', `${Math.sin(angle) * (moonRadius + dist)}px`);
    wrap.appendChild(s);
    setTimeout(() => s.remove(), 1100);
  }

  pulseStaff(norm);

  const diaryOn = document.getElementById('diaryToggle').getAttribute('aria-pressed') === 'true';
  if (!diaryOn) return;

  // One line per day actually logged -- not a generated caption. Notes
  // from the same day share a key, so the line holds still while that
  // day's run of notes plays and only moves on with a new day.
  const key = `${ev.taskId}|${ev.date}`;
  if (key === lastDiaryKey) return;
  lastDiaryKey = key;

  const task = findSubtask(ev.taskId);
  const log = task && task.dailyLogs.find((l) => l.date === ev.date);
  if (!task || !log) return;

  const diary = document.getElementById('playerDiary');
  diary.textContent = `${formatDay(ev.date)} — ${task.taskName} · ` +
    `${MOOD_LABEL[log.mood]} · ${EFFORT_LABEL[effortBand(log)]}, ${log.hours}h`;
  diary.classList.remove('show');
  void diary.offsetWidth; // restart the fade-in even if the text is changing mid-transition
  diary.classList.add('show');
}

/** Bookmark tab click -- pulls the goal/subtask/check-in drawer out from
 * the left edge, or tucks it back away if it's already open. */
function toggleHeroDrawer() {
  const drawer = document.getElementById('heroDrawer');
  const tab = document.getElementById('bookmarkTab');
  const isOpen = drawer.classList.toggle('open');
  tab.setAttribute('aria-expanded', String(isOpen));
  tab.setAttribute('aria-label', isOpen ? 'Close panel' : 'Open panel');
}

/**
 * The one function the UI needs. Takes Logic's data (or fetches it),
 * builds the whole score, and plays it.
 */
function playSong(goalData) {
  const score = composeScore(goalData || getFullGoalData());

  if (!score.melody.length) {
    uiSongMessage('Nothing to play yet — log a day first.', true);
    return null;
  }

  stopSong();
  playScore(score);
  isPlaying = true;
  updatePlayIcon();
  clearTimeout(playEndTimer);
  playEndTimer = setTimeout(() => { isPlaying = false; updatePlayIcon(); }, score.duration * 1000);

  const bright = score.movements.filter((m) => m.family === 'bright').length;
  const shadow = score.movements.length - bright;

  uiSongMessage(
    `Playing ${score.isFull ? 'the full suite' : 'the suite so far'} — ` +
    `${score.movements.length} movement${score.movements.length === 1 ? '' : 's'}, ` +
    `${bright} bright / ${shadow} shadow, ` +
    `${score.dayCount} day${score.dayCount === 1 ? '' : 's'}, ` +
    `${score.chordDays} chord day${score.chordDays === 1 ? '' : 's'}, ` +
    `♩=${score.tempo}, ${score.duration.toFixed(1)}s.`
  );

  return score;
}

/** Cut everything off immediately. */
function stopSong() {
  activeNodes.forEach((n) => {
    try { n.stop(); } catch (e) { /* already stopped */ }
  });
  activeNodes = [];
  clearTimeout(playEndTimer);
  isPlaying = false;
  updatePlayIcon();
}

/* ── Choosing a key ────────────────────────────────────────── */

/** Average mood over a set of logs; 2.5 (dead centre) when there are none. */
function averageMood(logs) {
  if (!logs.length) return 2.5;
  return logs.reduce((s, l) => s + l.mood, 0) / logs.length;
}

/**
 * Some tonic + mode pairs need more than seven sharps or flats to write
 * down. Rather than invent double accidentals, step the mode one shade
 * brighter until the key signature is notatable.
 */
function fitMode(tonic, key) {
  let i = MODE_ORDER.indexOf(key);
  while (i < MODE_ORDER.length - 1 &&
         Math.abs(tonic.fifths + MODES[MODE_ORDER[i]].offset) > 7) i++;
  return MODE_ORDER[i];
}

/**
 * The key of one movement. `index` is its position in the suite, which
 * decides both the tonic and whether the every-third-movement shadow
 * rule applies.
 */
function movementKey(task, index) {
  const avg = averageMood(task.dailyLogs);

  // Mood picks the rung: 0 is the darkest shade of whichever family the
  // movement lands in, 2 the brightest.
  let rung = avg < 2.2 ? 0 : avg < 3.2 ? 1 : 2;

  // Walking away from something darkens it by one rung.
  if (task.status === 'given_up') rung = Math.max(0, rung - 1);

  // The rota: every third movement is written in shadow whatever the days
  // were like. And genuinely bad days go to shadow wherever they sit —
  // the pattern can darken a movement, but it can never brighten one.
  const rota = index % 3 === 2;
  const grim = avg < 1.8;
  const shadow = rota || grim;

  const tonic = TONICS[index % TONICS.length];
  const key = fitMode(tonic, (shadow ? SHADOW_LADDER : BRIGHT_LADDER)[rung]);

  // Worth saying out loud in the UI: this one is minor because it was its
  // turn, not because the work went badly.
  const turned = rota && !grim;

  return {
    key,
    mode: MODES[key],
    tonic,
    fifths: tonic.fifths + MODES[key].offset,
    family: MODES[key].family,
    avgMood: avg,
    turned,
  };
}

/* ── Composing ─────────────────────────────────────────────── */

/**
 * Build the whole suite as data — no sound, no DOM. Everything downstream
 * (playback, engraving, MusicXML, MIDI) reads this one object.
 *
 * Times are in beats, not seconds, so the same numbers can be turned into
 * either a schedule or a set of note values.
 */
function composeScore(goalData) {
  const data = goalData || getFullGoalData();
  const melody = [];
  const bass = [];
  const movements = [];

  const allLogs = data.subtasks.flatMap((t) => t.dailyLogs);
  const avgAll = averageMood(allLogs);
  const tempo = Math.round(64 + (avgAll - 1) * 13);   // 64 … 103 bpm

  // Which dates carry more than one subtask → chords.
  const dayCounts = {};
  allLogs.forEach((l) => { dayCounts[l.date] = (dayCounts[l.date] || 0) + 1; });
  const chordDays = new Set();

  let beat = 0;
  let index = 0;

  data.subtasks.forEach((task) => {
    if (!task.dailyLogs.length) return;   // nothing logged, nothing to write

    const k = movementKey(task, index);
    const steps = k.mode.steps;
    const root = ROOT_MIDI + k.tonic.pc;
    const bassRoot = root - 24;
    const falling = k.family === 'shadow';   // sad days walk down, good days climb
    const start = beat;
    const firstNote = melody.length;

    task.dailyLogs.forEach((log, d) => {
      const r = EFFORT_RHYTHM[effortBand(log)] || EFFORT_RHYTHM.a_little;
      const isChord = dayCounts[log.date] > 1;
      if (isChord) chordDays.add(log.date);

      let at = beat;
      r.notes.forEach((dur, n) => {
        // The run inside a day steps away from the mood's home degree —
        // upward in a bright mode, downward in a shadow one.
        const drift = falling ? -n : n;
        const deg = clamp(MOOD_DEGREE[log.mood] + drift + (d % 2), -2, 9);

        const midis = isChord
          ? [0, 2, 4].map((x) =>
              root + degreeToSemitone(steps, MOOD_CHORD_ROOT[log.mood] + x))
          : [root + degreeToSemitone(steps, deg)];

        melody.push({ beat: at, beats: dur, midis, vel: r.vel, date: log.date, taskId: task.taskId });
        at += dur;
      });

      beat += r.bar;
    });

    // Movements start and end on barlines, so the suite reads cleanly.
    beat = Math.ceil(beat / BEATS_PER_MEASURE) * BEATS_PER_MEASURE;

    // A slow pedal underneath, alternating tonic and fifth — the ground
    // the movement is standing on.
    for (let m = start; m < beat; m += BEATS_PER_MEASURE) {
      const odd = ((m - start) / BEATS_PER_MEASURE) % 2;
      bass.push({
        beat: m,
        beats: BEATS_PER_MEASURE,
        midis: [bassRoot + (odd ? degreeToSemitone(steps, 4) : 0)],
      });
    }

    beat += appendCadence(melody, bass, beat, k, root, bassRoot, task.status);

    // Words are hung under the first notes of the movement, so the sheet
    // you download reads as a song and not just as pitches.
    const band = k.avgMood >= 3.5 ? 'high' : k.avgMood >= 2.5 ? 'mid'
               : k.avgMood >= 1.5 ? 'low' : 'dark';
    const phrase = pick(VERSE[band], index).replace(/[.,]/g, '').split(/\s+/);
    phrase.forEach((word, i) => {
      const note = melody[firstNote + i];
      if (note) note.lyric = word;
    });

    movements.push({
      taskId: task.taskId,
      taskName: task.taskName,
      status: task.status,
      key: k.key,
      modeName: k.mode.name,
      feel: k.mode.feel,
      family: k.family,
      turned: k.turned,
      tonicName: k.tonic.name,
      fifths: k.fifths,
      startBeat: start,
      endBeat: beat,
      noteCount: melody.length - firstNote,
      days: task.dailyLogs.length,
      hours: task.dailyLogs.reduce((s, l) => s + l.hours, 0),
      avgMood: k.avgMood,
      cadence: CADENCE_NAME[task.status] || 'open',
      phrase: phrase.join(' '),
    });

    index++;
  });

  const dates = [...new Set(allLogs.map((l) => l.date))].sort((a, b) => a.localeCompare(b));

  return {
    title: data.goalName || 'Untitled goal',
    subtitle: dates.length
      ? `${formatDay(dates[0])} — ${formatDay(dates[dates.length - 1])}`
      : '',
    tempo,
    melody,
    bass,
    movements,
    totalBeats: beat,
    measureCount: Math.max(1, Math.ceil(beat / BEATS_PER_MEASURE)),
    duration: beat * (60 / tempo),
    dayCount: dates.length,
    chordDays: chordDays.size,
    dates,
    isFull: data.subtasks.length > 0 && data.subtasks.every((s) => s.status !== 'active'),
  };
}

const CADENCE_NAME = {
  completed: 'authentic (V–I)',
  given_up:  'deceptive (V–vi)',
  active:    'half (…–V)',
};

/**
 * The two measures that close a movement. Returns how many beats it used.
 *
 * The dominant gets a raised third in the shadow modes — that's the
 * leading tone, and without it a minor V has no pull at all. Completed
 * minor movements then land on a Picardy third: the last chord turns
 * major. It's an old trick and it still works.
 */
function appendCadence(melody, bass, t, k, root, bassRoot, status) {
  const steps = k.mode.steps;
  const shadow = k.family === 'shadow';
  const at = (deg, lift) => root + degreeToSemitone(steps, deg) + (lift || 0);

  // V, with a real leading tone whatever the mode.
  const dominant = [at(4), at(6, shadow ? 1 : 0), at(8)];

  if (status === 'completed') {
    const tonic = [at(0), at(2, shadow ? 1 : 0), at(4)];   // Picardy third in the shadow modes
    melody.push({ beat: t,     beats: 4, midis: dominant, vel: 0.62 });
    melody.push({ beat: t + 4, beats: 4, midis: tonic,    vel: 0.78 });
    bass.push({ beat: t,     beats: 4, midis: [bassRoot + degreeToSemitone(steps, 4)] });
    bass.push({ beat: t + 4, beats: 4, midis: [bassRoot] });
    return 8;
  }

  if (status === 'given_up') {
    // Deceptive: everything points at the tonic, and then vi arrives
    // instead. Nothing is wrong with the chord — it just isn't home.
    const submediant = [at(5), at(7), at(9)];
    melody.push({ beat: t,     beats: 4, midis: dominant,   vel: 0.60 });
    melody.push({ beat: t + 4, beats: 4, midis: submediant, vel: 0.52 });
    bass.push({ beat: t,     beats: 4, midis: [bassRoot + degreeToSemitone(steps, 4)] });
    bass.push({ beat: t + 4, beats: 4, midis: [bassRoot + degreeToSemitone(steps, 5)] });
    return 8;
  }

  // Half cadence — the movement stops on the dominant. A question mark.
  const predominant = [at(1), at(3), at(5)];
  melody.push({ beat: t,     beats: 4, midis: predominant, vel: 0.48 });
  melody.push({ beat: t + 4, beats: 4, midis: dominant,    vel: 0.56 });
  bass.push({ beat: t,     beats: 4, midis: [bassRoot + degreeToSemitone(steps, 1)] });
  bass.push({ beat: t + 4, beats: 4, midis: [bassRoot + degreeToSemitone(steps, 4)] });
  return 8;
}

/** Scale degree → semitones, wrapping into higher octaves past the 7th. */
function degreeToSemitone(scale, degree) {
  const octave = Math.floor(degree / scale.length);
  const idx = ((degree % scale.length) + scale.length) % scale.length;
  return scale[idx] + 12 * octave;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/* ── Lyrics ────────────────────────────────────────────────── */

/**
 * Lyrics follow the mood trend and the length of the goal: more days →
 * more lines. Each movement gets its own couplet, headed by the key it
 * ended up in, and coloured by how it felt and how it ended.
 */
function generateLyrics(goalData, score) {
  const data = goalData || getFullGoalData();
  const s = score || composeScore(data);
  const allLogs = data.subtasks.flatMap((t) => t.dailyLogs);
  if (!allLogs.length) return '';

  const dates = s.dates;
  const days = dates.length;
  // Real dates mean duration is the calendar span, not the number of
  // days worked — a goal with gaps in it genuinely took longer.
  const span = daysBetween(dates[0], dates[days - 1]);
  const avg = averageMood(allLogs);
  const trend = moodTrend(allLogs);
  const goal = data.goalName || 'this thing';

  const lines = [];

  lines.push(`[ ${goal} ]`);
  lines.push(`${s.subtitle}  ·  ♩=${s.tempo}`);
  lines.push('');
  // Two openers lead with {goal}; the user's own casing shouldn't start a line lowercase.
  const opener = pick(OPENERS[trend], days).replace('{goal}', goal);
  lines.push(opener.charAt(0).toUpperCase() + opener.slice(1));
  lines.push(span > days
    ? `${days} day${days === 1 ? '' : 's'} worked out of ${span}, and I kept the tally.`
    : `${days} day${days === 1 ? '' : 's'} of it, and I kept the tally.`);
  lines.push('');

  s.movements.forEach((m, i) => {
    const band = m.avgMood >= 3.5 ? 'high' : m.avgMood >= 2.5 ? 'mid'
               : m.avgMood >= 1.5 ? 'low' : 'dark';

    lines.push(`— ${m.taskName} · ${m.tonicName} ${m.modeName} —`);
    lines.push(pick(VERSE[band], i));
    lines.push(`${m.hours.toFixed(1)} hours in, ${m.days} day${m.days === 1 ? '' : 's'} marked.`);
    lines.push(pick(ENDING[m.status], i));
    if (m.turned) lines.push('(written in shadow on purpose — the suite needed a fall here)');
    lines.push('');
  });

  // Longer goals earn a bridge — measured in calendar time.
  if (span > 7) {
    lines.push('[ bridge ]');
    lines.push(pick(BRIDGE[trend], span));
    lines.push('Somewhere in the middle it stopped being new,');
    lines.push('and that was the part that counted.');
    lines.push('');
  }

  const gaveUp = data.subtasks.filter((t) => t.status === 'given_up').length;
  const done = data.subtasks.filter((t) => t.status === 'completed').length;

  lines.push('[ outro ]');
  if (!isGoalFinished()) {
    lines.push('Not finished. The song stops on the dominant,');
    lines.push('because that is honestly where I am.');
  } else if (gaveUp === 0) {
    lines.push(`All ${done} of them, closed out.`);
    lines.push(avg >= 3 ? 'And it sounded the way I hoped it would.' : 'It cost more than I said it would. I finished anyway.');
  } else if (done === 0) {
    lines.push('I put every one of them down.');
    lines.push('The song still plays. Nothing here disappeared without a sound.');
  } else {
    lines.push(`${done} finished, ${gaveUp} put down.`);
    lines.push('Both are in here. One resolves, one just stops ringing.');
  }

  return lines.join('\n');
}

const OPENERS = {
  rising:  ['I started {goal} not knowing how it would go.', 'The first day of {goal} was the hardest one to name.'],
  falling: ['{goal} started loud and got quieter.', 'I had a lot to say about {goal} on day one.'],
  steady:  ['{goal}, one day at a time, no drama.', 'I showed up for {goal}. That was most of it.'],
};

const VERSE = {
  high: ['This one moved. Hours went somewhere I did not notice.', 'Good days. The kind you do not have to talk yourself into.'],
  mid:  ['Some of it worked. Some of it just took the time it took.', 'Not thrilling, not bad. It went.'],
  low:  ['I had to sit down for this one every single time.', 'It pulled. Every hour here was an hour I argued for.'],
  dark: ['This one was heavy the whole way through.', 'I do not have a kind line for this part.'],
};

const ENDING = {
  completed: ['And then it was done, and it landed.', 'Closed. It resolves.'],
  given_up:  ['I stopped here. It hangs, unfinished, and it still counts.', 'I let this one go. It does not resolve, but it is still in the song.'],
  active:    ['Still open. Still going.', 'Not done with this one yet.'],
};

const BRIDGE = {
  rising:  ['It got better slowly, which is the only way it ever gets better.'],
  falling: ['It got heavier as it went, and I kept the tally anyway.'],
  steady:  ['Same weight most days. That is its own kind of hard.'],
};

function moodTrend(logs) {
  if (logs.length < 4) return 'steady';
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date));
  const half = Math.floor(sorted.length / 2);
  const first = sorted.slice(0, half).reduce((s, l) => s + l.mood, 0) / half;
  const second = sorted.slice(half).reduce((s, l) => s + l.mood, 0) / (sorted.length - half);
  if (second - first > 0.4) return 'rising';
  if (first - second > 0.4) return 'falling';
  return 'steady';
}

function pick(arr, seed) {
  return arr[Math.abs(seed) % arr.length];
}

/* ── Audio plumbing ────────────────────────────────────────── */

/* Everything runs through one reverb. It's a synthetic impulse — noise
   under an exponential decay — which is enough to stop the oscillators
   sounding like a test tone and put them in a room instead. */
function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    master = audioCtx.createGain();
    master.gain.value = 0.8;
    master.connect(audioCtx.destination);

    const wet = audioCtx.createGain();
    wet.gain.value = 0.32;
    const verb = audioCtx.createConvolver();
    verb.buffer = impulseResponse(audioCtx, 2.8, 2.6);

    master.connect(wet);
    wet.connect(verb);
    verb.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function impulseResponse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

/** Schedule a whole score against the audio clock. */
function playScore(score, opts) {
  const o = opts || {};
  const ctx = getAudioContext();
  const spb = 60 / score.tempo;
  const start = ctx.currentTime + 0.12;
  const from = o.fromBeat || 0;
  const to = o.toBeat === undefined ? Infinity : o.toBeat;

  score.melody.forEach((ev) => {
    if (ev.beat < from || ev.beat >= to) return;
    voice(ctx, ev.midis, start + (ev.beat - from) * spb,
          ev.beats * spb * 0.92, 0.20 * ev.vel, 'triangle');
  });

  score.bass.forEach((ev) => {
    if (ev.beat < from || ev.beat >= to) return;
    voice(ctx, ev.midis, start + (ev.beat - from) * spb,
          ev.beats * spb * 0.98, 0.09, 'sine');
  });
}

/** One chord: an oscillator per pitch, under a shared envelope shape. */
function voice(ctx, midis, at, dur, gain, wave) {
  midis.forEach((midi) => {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = wave;
    osc.frequency.value = midiToFreq(midi);

    const peak = gain / Math.sqrt(midis.length);
    const attack = Math.min(0.05, dur * 0.2);

    env.gain.setValueAtTime(0.0001, at);
    env.gain.linearRampToValueAtTime(peak, at + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);

    osc.connect(env);
    env.connect(master);
    osc.start(at);
    osc.stop(at + dur + 0.05);

    activeNodes.push(osc);
    osc.onended = () => {
      activeNodes = activeNodes.filter((n) => n !== osc);
      try { env.disconnect(); } catch (e) { /* already gone */ }
    };
  });
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/* ── The chime ─────────────────────────────────────────────────
   Struck metal, not a beep: a bell's partials are inharmonic, so the
   overtones sit at odd ratios of the fundamental and each one decays
   faster than the one below it. Four partials is enough to read as a
   bell. The reward arpeggio is built out of the mode the movement was
   actually written in, so the sound you get is the music you earned. */

function bell(ctx, freq, at, dur, gain) {
  const PARTIALS = [1, 2.00, 2.76, 5.40];
  const WEIGHT   = [1, 0.42, 0.26, 0.11];
  const DECAY    = [1, 0.72, 0.50, 0.30];

  PARTIALS.forEach((mult, i) => {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq * mult;

    const d = dur * DECAY[i];
    env.gain.setValueAtTime(0.0001, at);
    env.gain.linearRampToValueAtTime(gain * WEIGHT[i], at + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, at + d);

    osc.connect(env);
    env.connect(master);
    osc.start(at);
    osc.stop(at + d + 0.05);
    activeNodes.push(osc);
    osc.onended = () => {
      activeNodes = activeNodes.filter((n) => n !== osc);
      try { env.disconnect(); } catch (e) { /* already gone */ }
    };
  });
}

/* Which degrees of the earned mode the chime arpeggiates. */
const CHIME_FIGURE = {
  completed: [0, 2, 4, 7],            // up through the triad and home
  given_up:  [7, 4, 2, 1],            // down, and it stops on the 2nd
  goal:      [0, 4, 2, 7, 9, 11],     // the whole thing opening out
  silent:    [4, 4],
};

/**
 * Play the reward chime. `key` is a mode name, so a movement written in
 * Phrygian rewards you with a Phrygian chime.
 */
function playChime(kind, key, tonicPc) {
  const ctx = getAudioContext();
  const steps = (MODES[key] || MODES.ionian).steps;
  const root = 72 + (tonicPc || 0);
  const figure = CHIME_FIGURE[kind] || CHIME_FIGURE.completed;
  const gap = kind === 'given_up' ? 0.15 : 0.105;
  const t0 = ctx.currentTime + 0.05;

  figure.forEach((deg, i) => {
    const midi = root + degreeToSemitone(steps, deg);
    bell(ctx, midiToFreq(midi), t0 + i * gap, 2.1 - i * 0.12, 0.22);
    // A quiet octave above each strike — the sparkle on top.
    bell(ctx, midiToFreq(midi + 12), t0 + i * gap + 0.012, 0.9, 0.055);
  });

  const tail = t0 + figure.length * gap + 0.06;

  if (kind === 'given_up') {
    // A suspension left hanging: the 4th never falls to the 3rd.
    [0, 3, 4].forEach((deg) => {
      bell(ctx, midiToFreq(root - 12 + degreeToSemitone(steps, deg)), tail, 3.4, 0.10);
    });
  } else {
    [0, 2, 4, 7].forEach((deg) => {
      bell(ctx, midiToFreq(root - 12 + degreeToSemitone(steps, deg)), tail, 3.0, 0.09);
    });
  }
}


/* ══ SHEET ═════════════════════════════════════════════════════ */

/*  The same score, written down. Everything here works off the beat
    timeline in composeScore(), chopped into measures once and then
    handed to three writers: MusicXML (which is what MuseScore reads),
    MIDI, and an SVG engraving for the page itself.                     */

const DIVISIONS = 4;   // MusicXML ticks per quarter note → 16th resolution

/* Beat length → note value. Anything else is built by tying these. */
const DUR_TABLE = [
  [4,    'whole',   0],
  [3,    'half',    1],
  [2,    'half',    0],
  [1.5,  'quarter', 1],
  [1,    'quarter', 0],
  [0.75, 'eighth',  1],
  [0.5,  'eighth',  0],
  [0.25, '16th',    0],
];

function round4(n) {
  return Math.round(n * 4) / 4;
}

/** Break an arbitrary length into writable note values, largest first. */
function splitDuration(beats) {
  const out = [];
  let left = round4(beats);
  DUR_TABLE.forEach(([v]) => {
    while (left >= v - 1e-9) { out.push(v); left = round4(left - v); }
  });
  return out.length ? out : [0.25];
}

function noteInfo(v) {
  return DUR_TABLE.find((d) => Math.abs(d[0] - v) < 1e-9) || DUR_TABLE[7];
}

/**
 * Chop one voice's events into measures. Gaps become rests, anything
 * crossing a barline is split and tied, and anything that isn't a plain
 * note value is split and tied too. Events in a voice never overlap,
 * which is what lets a single cursor do the work.
 */
function buildMeasures(events, totalBeats) {
  const count = Math.max(1, Math.ceil(totalBeats / BEATS_PER_MEASURE - 1e-9));
  const bins = Array.from({ length: count }, () => []);

  events.forEach((ev) => {
    let b = ev.beat;
    let left = ev.beats;
    let first = true;

    while (left > 1e-9) {
      const m = Math.min(count - 1, Math.floor(b / BEATS_PER_MEASURE + 1e-9));
      const take = Math.min(left, (m + 1) * BEATS_PER_MEASURE - b);
      bins[m].push({
        off: round4(b - m * BEATS_PER_MEASURE),
        beats: round4(take),
        midis: ev.midis,
        lyric: first ? ev.lyric : null,
        tieStart: left - take > 1e-9,
        tieStop: !first,
      });
      b += take;
      left = round4(left - take);
      first = false;
    }
  });

  return bins.map((items) => {
    items.sort((a, b) => a.off - b.off);
    const out = [];
    let cursor = 0;

    const rest = (beats) => splitDuration(beats).forEach((p) => out.push({ rest: true, beats: p }));

    items.forEach((it) => {
      if (it.off > cursor + 1e-9) rest(round4(it.off - cursor));
      const pieces = splitDuration(it.beats);
      pieces.forEach((p, i) => out.push({
        midis: it.midis,
        beats: p,
        lyric: i === 0 ? it.lyric : null,
        tieStop: it.tieStop || i > 0,
        tieStart: it.tieStart || i < pieces.length - 1,
      }));
      cursor = round4(it.off + it.beats);
    });

    if (cursor < BEATS_PER_MEASURE - 1e-9) rest(round4(BEATS_PER_MEASURE - cursor));
    return out;
  });
}

/* ── Spelling ──────────────────────────────────────────────── */

const SHARP_SPELL = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0],
                     ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const FLAT_SPELL  = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0],
                     ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];

const STEP_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

/** A MIDI number as a written note, spelled to match the key signature. */
function spell(midi, fifths) {
  const pc = ((midi % 12) + 12) % 12;
  const [step, alter] = (fifths < 0 ? FLAT_SPELL : SHARP_SPELL)[pc];
  return { step, alter, octave: Math.floor(midi / 12) - 1 };
}

/** Which letters the key signature already alters, and by how much. */
function keyAlterMap(fifths) {
  const sharps = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  const flats  = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
  const map = {};
  if (fifths > 0) sharps.slice(0, fifths).forEach((s) => { map[s] = 1; });
  if (fifths < 0) flats.slice(0, -fifths).forEach((s) => { map[s] = -1; });
  return map;
}

/* ── MusicXML ──────────────────────────────────────────────────
   The format MuseScore, Sibelius, Finale and Dorico all read. Element
   order inside <note> is fixed by the DTD, so it's spelled out here
   rather than assembled loosely. Accidentals are left off deliberately:
   <alter> plus the key signature is enough, and the notation program
   draws them the way its own house style wants. */

function toMusicXML(score) {
  const mel = buildMeasures(score.melody, score.totalBeats);
  const bas = buildMeasures(score.bass, score.totalBeats);
  const count = Math.max(mel.length, bas.length);

  // Where each movement begins, keyed by measure number.
  const starts = new Map();
  score.movements.forEach((m) => starts.set(Math.round(m.startBeat / BEATS_PER_MEASURE), m));

  const part = (measures, id, clefSign, clefLine, voice) => {
    let fifths = null;
    const body = [];

    for (let i = 0; i < count; i++) {
      const items = measures[i] || [{ rest: true, beats: 4 }];
      const mv = starts.get(i);
      const attrs = [];

      if (i === 0) {
        attrs.push(`<divisions>${DIVISIONS}</divisions>`);
      }
      if (mv || i === 0) {
        fifths = mv ? mv.fifths : 0;
        attrs.push(`<key><fifths>${fifths}</fifths><mode>${
          mv && mv.family === 'shadow' ? 'minor' : 'major'}</mode></key>`);
      }
      if (i === 0) {
        attrs.push(`<time><beats>${BEATS_PER_MEASURE}</beats><beat-type>4</beat-type></time>`);
        attrs.push(`<clef><sign>${clefSign}</sign><line>${clefLine}</line></clef>`);
      }

      const dirs = [];
      if (i === 0) {
        dirs.push(
          '<direction placement="above"><direction-type><metronome>' +
          `<beat-unit>quarter</beat-unit><per-minute>${score.tempo}</per-minute>` +
          `</metronome></direction-type><sound tempo="${score.tempo}"/></direction>`
        );
      }
      if (mv && id === 'P1') {
        dirs.push(
          '<direction placement="above"><direction-type>' +
          `<words font-weight="bold">${xmlEscape(mv.taskName)}</words>` +
          '</direction-type></direction>',
          '<direction placement="above"><direction-type>' +
          `<words font-style="italic">${xmlEscape(
            `${mv.tonicName} ${mv.modeName} — ${mv.feel} — ${mv.cadence}`)}</words>` +
          '</direction-type></direction>'
        );
      }

      body.push(
        `    <measure number="${i + 1}">\n` +
        (attrs.length ? `      <attributes>${attrs.join('')}</attributes>\n` : '') +
        dirs.map((d) => `      ${d}\n`).join('') +
        items.map((it) => `      ${noteXML(it, fifths || 0, voice)}\n`).join('') +
        '    </measure>'
      );
    }

    return `  <part id="${id}">\n${body.join('\n')}\n  </part>`;
  };

  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" ' +
    '"http://www.musicxml.org/dtds/partwise.dtd">\n' +
    '<score-partwise version="3.1">\n' +
    `  <work><work-title>${xmlEscape(score.title)}</work-title></work>\n` +
    '  <identification>\n' +
    '    <creator type="composer">Perigee</creator>\n' +
    `    <creator type="lyricist">${xmlEscape(score.title)}</creator>\n` +
    `    <rights>${xmlEscape(score.subtitle)}</rights>\n` +
    '    <encoding><software>Perigee</software>' +
    `<encoding-date>${todayISO()}</encoding-date></encoding>\n` +
    '  </identification>\n' +
    '  <part-list>\n' +
    '    <score-part id="P1"><part-name>The days</part-name>\n' +
    '      <score-instrument id="P1-I1"><instrument-name>Celesta</instrument-name></score-instrument>\n' +
    '      <midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>9</midi-program></midi-instrument>\n' +
    '    </score-part>\n' +
    '    <score-part id="P2"><part-name>The ground</part-name>\n' +
    '      <score-instrument id="P2-I1"><instrument-name>Warm pad</instrument-name></score-instrument>\n' +
    '      <midi-instrument id="P2-I1"><midi-channel>2</midi-channel><midi-program>90</midi-program></midi-instrument>\n' +
    '    </score-part>\n' +
    '  </part-list>\n' +
    part(mel, 'P1', 'G', 2, 1) + '\n' +
    part(bas, 'P2', 'F', 4, 1) + '\n' +
    '</score-partwise>\n';
}

function noteXML(item, fifths, voice) {
  const info = noteInfo(item.beats);
  const dur = Math.round(item.beats * DIVISIONS);
  const dots = '<dot/>'.repeat(info[2]);

  if (item.rest) {
    return `<note><rest/><duration>${dur}</duration>` +
           `<voice>${voice}</voice><type>${info[1]}</type>${dots}</note>`;
  }

  return item.midis.map((midi, i) => {
    const p = spell(midi, fifths);
    const ties = (item.tieStop ? '<tie type="stop"/>' : '') +
                 (item.tieStart ? '<tie type="start"/>' : '');
    const tied = (item.tieStop ? '<tied type="stop"/>' : '') +
                 (item.tieStart ? '<tied type="start"/>' : '');
    const lyric = i === 0 && item.lyric
      ? `<lyric number="1"><syllabic>single</syllabic><text>${xmlEscape(item.lyric)}</text></lyric>`
      : '';

    return '<note>' +
      (i ? '<chord/>' : '') +
      `<pitch><step>${p.step}</step>${p.alter ? `<alter>${p.alter}</alter>` : ''}` +
      `<octave>${p.octave}</octave></pitch>` +
      `<duration>${dur}</duration>${ties}<voice>${voice}</voice><type>${info[1]}</type>${dots}` +
      (tied ? `<notations>${tied}</notations>` : '') +
      lyric +
      '</note>';
  }).join('');
}

function xmlEscape(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]
  ));
}

/* ── MIDI ──────────────────────────────────────────────────────
   A standard type-1 file, written by hand: one meta track for tempo and
   title, then one track per voice. Nothing here needs a library — the
   format is a header chunk and some delta-timed bytes. */

function toMIDI(score) {
  const TPQ = 480;

  const meta = [];
  pushText(meta, 0x03, score.title);
  const usPerQuarter = Math.round(60000000 / score.tempo);
  meta.push(0, 0xFF, 0x51, 0x03,
    (usPerQuarter >> 16) & 0xFF, (usPerQuarter >> 8) & 0xFF, usPerQuarter & 0xFF);
  meta.push(0, 0xFF, 0x58, 0x04, BEATS_PER_MEASURE, 2, 24, 8);

  const voiceTrack = (events, channel, program, name) => {
    const out = [];
    pushText(out, 0x03, name);
    out.push(0, 0xC0 | channel, program);

    const timed = [];
    events.forEach((ev) => {
      const on = Math.round(ev.beat * TPQ);
      const off = Math.round((ev.beat + ev.beats) * TPQ) - 4;
      ev.midis.forEach((m) => {
        const vel = Math.round(28 + (ev.vel === undefined ? 0.5 : ev.vel) * 84);
        timed.push({ tick: on, bytes: [0x90 | channel, m & 0x7F, vel] });
        timed.push({ tick: Math.max(on + 1, off), bytes: [0x80 | channel, m & 0x7F, 0] });
      });
    });
    // Note-offs sort before note-ons at the same tick, so repeated pitches
    // don't cut each other short.
    timed.sort((a, b) => a.tick - b.tick || (a.bytes[0] & 0xF0) - (b.bytes[0] & 0xF0));

    let last = 0;
    timed.forEach((e) => {
      pushVarLen(out, e.tick - last);
      out.push(...e.bytes);
      last = e.tick;
    });
    return out;
  };

  const chunks = [
    chunk('MTrk', meta.concat([0, 0xFF, 0x2F, 0x00])),
    chunk('MTrk', voiceTrack(score.melody, 0, 9, 'The days').concat([0, 0xFF, 0x2F, 0x00])),
    chunk('MTrk', voiceTrack(score.bass, 1, 90, 'The ground').concat([0, 0xFF, 0x2F, 0x00])),
  ];

  const header = chunk('MThd', [0, 1, 0, chunks.length, (TPQ >> 8) & 0xFF, TPQ & 0xFF]);
  return new Uint8Array([].concat(header, ...chunks));

  function chunk(id, data) {
    const len = data.length;
    return [...id].map((c) => c.charCodeAt(0))
      .concat([(len >> 24) & 0xFF, (len >> 16) & 0xFF, (len >> 8) & 0xFF, len & 0xFF], data);
  }

  function pushVarLen(out, value) {
    let v = Math.max(0, Math.round(value));
    const bytes = [v & 0x7F];
    v >>= 7;
    while (v > 0) { bytes.unshift((v & 0x7F) | 0x80); v >>= 7; }
    out.push(...bytes);
  }

  function pushText(out, type, text) {
    const bytes = [...String(text)].map((c) => c.charCodeAt(0) & 0x7F).slice(0, 120);
    out.push(0, 0xFF, type);
    pushVarLen(out, bytes.length);
    out.push(...bytes);
  }
}

/* ── Engraving ─────────────────────────────────────────────────
   White ink on indigo paper, the way ref2 has it. Only the melody staff
   is drawn — the ground moves too slowly to be worth the vertical space
   on screen, and the downloads carry both parts.

   Vertical position is diatonic, not chromatic: octave×7 + letter. On a
   treble staff the top line is F5, and every diatonic step is half a
   space, so one subtraction places any note. */

const STAFF_SPACE = 8;          // distance between staff lines
const HALF = STAFF_SPACE / 2;   // one diatonic step
const TOP_DIA = 38;             // F5, the top line of a treble staff
const SHARP_DIA = [38, 35, 39, 36, 33, 37, 34];   // F C G D A E B
const FLAT_DIA  = [34, 37, 33, 36, 32, 35, 31];   // B E A D G C F

function diaOf(p) {
  return p.octave * 7 + STEP_INDEX[p.step];
}

function engrave(score, opts) {
  const o = opts || {};
  const width = o.width || 1120;
  const maxMeasures = o.maxMeasures || Infinity;
  const pad = 44;
  const inner = width - pad * 2;

  const all = buildMeasures(score.melody, score.totalBeats);
  const measures = all.slice(0, Math.min(all.length, maxMeasures));
  const truncated = all.length - measures.length;

  const starts = new Map();
  score.movements.forEach((m) => starts.set(Math.round(m.startBeat / BEATS_PER_MEASURE), m));

  // How wide each measure wants to be, plus room for any clef/key it carries.
  const widths = measures.map((items) =>
    Math.max(104, items.reduce((s, it) => s + 26 + it.beats * 20, 22)));
  const leads = measures.map((_, i) => {
    const mv = starts.get(i);
    return (i === 0 ? 0 : 0) + (mv ? 16 + Math.abs(mv.fifths) * 9 : 0);
  });
  const CLEF_W = 52;

  // Greedy line-breaking into systems.
  const systems = [];
  let cur = { first: 0, count: 0, used: CLEF_W };
  measures.forEach((_, i) => {
    const w = widths[i] + leads[i];
    if (cur.count && cur.used + w > inner) {
      systems.push(cur);
      cur = { first: i, count: 0, used: CLEF_W };
    }
    cur.count++;
    cur.used += w;
  });
  if (cur.count) systems.push(cur);

  const SYS_H = 122;
  const height = 74 + systems.length * SYS_H + (truncated ? 34 : 0);
  const out = [];

  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
           `width="${width}" height="${height}" class="engraving" ` +
           `font-family="Iowan Old Style, Palatino, Georgia, serif">`);
  out.push(`<rect width="${width}" height="${height}" fill="#332830"/>`);
  out.push(`<text x="${pad}" y="34" fill="#f1e7dd" font-size="21" ` +
           `font-style="italic">${xmlEscape(score.title)}</text>`);
  out.push(`<text x="${width - pad}" y="34" fill="#c9b8b3" font-size="12" ` +
           `text-anchor="end">${xmlEscape(score.subtitle)} · ♩=${score.tempo}</text>`);

  let keyFifths = 0;

  systems.forEach((sys, si) => {
    const top = 74 + si * SYS_H;
    const bottom = top + STAFF_SPACE * 4;
    // Stretch the system so its right edge lines up with every other one.
    const content = sys.used - CLEF_W;
    const scale = content > inner * 0.55 ? (inner - CLEF_W) / content : 1;

    for (let l = 0; l < 5; l++) {
      const y = top + l * STAFF_SPACE;
      out.push(`<line x1="${pad}" y1="${y}" x2="${width - pad}" y2="${y}" ` +
               `stroke="#ffffff" stroke-opacity="0.55" stroke-width="1"/>`);
    }

    out.push(`<text x="${pad + 6}" y="${bottom + 10}" fill="#ffffff" ` +
             `font-size="46" font-family="Bravura, Zapf Dingbats, Apple Symbols, ` +
             `STIXGeneral, serif">𝄞</text>`);

    let x = pad + CLEF_W;

    for (let i = sys.first; i < sys.first + sys.count; i++) {
      const mv = starts.get(i);

      if (mv) {
        keyFifths = mv.fifths;
        out.push(`<text x="${x}" y="${top - 12}" fill="#8fb8b0" font-size="12.5" ` +
                 `font-weight="600">${xmlEscape(mv.taskName)}</text>`);
        out.push(`<text x="${x}" y="${top - 12}" dx="${
                   Math.min(240, mv.taskName.length * 7 + 12)}" fill="#c9b8b3" ` +
                 `font-size="11" font-style="italic">${
                   xmlEscape(`${mv.tonicName} ${mv.modeName}`)}</text>`);
        x += drawKeySignature(out, x, top, keyFifths) + 10;
      }

      const items = measures[i];
      const alterMap = keyAlterMap(keyFifths);
      const placed = [];

      items.forEach((it) => {
        const w = (26 + it.beats * 20) * scale;
        const cx = x + w * 0.42;
        if (it.rest) drawRest(out, cx, top, it.beats);
        else placed.push({ x: cx, item: it, y: drawNote(out, cx, top, it, keyFifths, alterMap) });
        x += w;
      });

      // Ties: an arc from a note to whatever follows it in this system.
      placed.forEach((p, n) => {
        if (!p.item.tieStart || !placed[n + 1]) return;
        const y = p.y + 9;
        out.push(`<path d="M${p.x + 6} ${y} Q${(p.x + placed[n + 1].x) / 2} ${y + 7} ` +
                 `${placed[n + 1].x - 6} ${y}" fill="none" stroke="#ffffff" ` +
                 `stroke-opacity="0.6" stroke-width="1.3"/>`);
      });

      const bar = i === sys.first + sys.count - 1 ? width - pad : x;
      out.push(`<line x1="${bar}" y1="${top}" x2="${bar}" y2="${bottom}" ` +
               `stroke="#ffffff" stroke-opacity="0.5" stroke-width="1"/>`);
      x = bar;
    }
  });

  if (truncated) {
    out.push(`<text x="${pad}" y="${height - 12}" fill="#a99590" font-size="12" ` +
             `font-style="italic">…and ${truncated} more measure${truncated === 1 ? '' : 's'}. ` +
             `The download has all of them.</text>`);
  }

  out.push('</svg>');
  return out.join('');
}

function drawKeySignature(out, x, top, fifths) {
  const glyphs = fifths >= 0 ? SHARP_DIA : FLAT_DIA;
  const sign = fifths >= 0 ? '♯' : '♭';
  const n = Math.min(7, Math.abs(fifths));
  for (let i = 0; i < n; i++) {
    const y = top + (TOP_DIA - glyphs[i]) * HALF;
    out.push(`<text x="${x + i * 9}" y="${y + 4.5}" fill="#ffffff" font-size="17" ` +
             `font-family="Apple Symbols, STIXGeneral, serif">${sign}</text>`);
  }
  return n * 9;
}

/** Draw one note or chord. Returns the y of its lowest head. */
function drawNote(out, cx, top, item, fifths, alterMap) {
  const info = noteInfo(item.beats);
  const hollow = info[1] === 'whole' || info[1] === 'half';
  const spelled = item.midis.map((m) => spell(m, fifths));
  const dias = spelled.map(diaOf);
  const ys = dias.map((d) => top + (TOP_DIA - d) * HALF);
  const lowY = Math.max(...ys);
  const highY = Math.min(...ys);

  // Ledger lines, above and below, for the outermost heads only.
  const maxDia = Math.max(...dias);
  const minDia = Math.min(...dias);
  for (let d = 40; d <= maxDia; d += 2) ledger(out, cx, top + (TOP_DIA - d) * HALF);
  for (let d = 28; d >= minDia; d -= 2) ledger(out, cx, top + (TOP_DIA - d) * HALF);

  spelled.forEach((p, i) => {
    const y = ys[i];
    if (p.alter !== (alterMap[p.step] || 0)) {
      const glyph = p.alter === 1 ? '♯' : p.alter === -1 ? '♭' : '♮';
      out.push(`<text x="${cx - 17}" y="${y + 4.5}" fill="#ffffff" font-size="15" ` +
               `font-family="Apple Symbols, STIXGeneral, serif">${glyph}</text>`);
    }
    out.push(`<ellipse cx="${cx}" cy="${y}" rx="5.4" ry="4" ` +
             `transform="rotate(-21 ${cx} ${y})" fill="${hollow ? 'none' : '#ffffff'}" ` +
             `stroke="#ffffff" stroke-width="${hollow ? 1.6 : 1}"/>`);
  });

  // Dots sit to the right of the head, nudged into a space.
  if (info[2]) {
    out.push(`<circle cx="${cx + 10}" cy="${lowY - 4}" r="1.6" fill="#ffffff"/>`);
  }

  if (info[1] !== 'whole') {
    const up = Math.max(...dias) < 34;   // stems point away from the middle line
    const x = cx + (up ? 5.1 : -5.1);
    const y1 = up ? highY : lowY;
    const y2 = up ? lowY - 27 : highY + 27;
    out.push(`<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" ` +
             `stroke="#ffffff" stroke-width="1.3"/>`);

    if (info[1] === 'eighth' || info[1] === '16th') {
      const dir = up ? 1 : -1;
      out.push(`<path d="M${x} ${y2} q7 ${5 * dir} 6 ${13 * dir} q-1 ${-6 * dir} -6 ${-8 * dir}Z" ` +
               `fill="#ffffff"/>`);
      if (info[1] === '16th') {
        out.push(`<path d="M${x} ${y2 + 8 * dir} q7 ${5 * dir} 6 ${13 * dir} ` +
                 `q-1 ${-6 * dir} -6 ${-8 * dir}Z" fill="#ffffff"/>`);
      }
    }
  }

  return lowY;
}

function ledger(out, cx, y) {
  out.push(`<line x1="${cx - 9}" y1="${y}" x2="${cx + 9}" y2="${y}" ` +
           `stroke="#ffffff" stroke-opacity="0.75" stroke-width="1"/>`);
}

function drawRest(out, cx, top, beats) {
  const mid = top + STAFF_SPACE * 2;
  if (beats >= 4) {
    out.push(`<rect x="${cx - 6}" y="${top + STAFF_SPACE - 4}" width="12" height="4" ` +
             `fill="#ffffff" fill-opacity="0.75"/>`);
  } else if (beats >= 2) {
    out.push(`<rect x="${cx - 6}" y="${mid}" width="12" height="4" ` +
             `fill="#ffffff" fill-opacity="0.75"/>`);
  } else {
    out.push(`<path d="M${cx - 3} ${mid - 9} q6 4 2 8 q-5 4 1 9 q-7 -3 -3 -9 q4 -4 0 -8Z" ` +
             `fill="#ffffff" fill-opacity="0.8"/>`);
  }
}

/* ── Downloads ─────────────────────────────────────────────────
   Every file is named after the project it came from, so a new goal
   produces a new set of sheets rather than overwriting the last one. */

function projectSlug() {
  const base = (state.goalName || 'untitled-goal')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled-goal';
  return `perigee-${base}-${todayISO()}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function downloadSheet(kind) {
  const score = currentScore || composeScore(getFullGoalData());
  if (!score.melody.length) return uiSheetMessage('Log a day first — there is nothing to write down yet.', true);

  const name = projectSlug();

  if (kind === 'musicxml') {
    downloadBlob(new Blob([toMusicXML(score)], { type: 'application/vnd.recordare.musicxml+xml' }),
                 `${name}.musicxml`);
    uiSheetMessage(`Saved ${name}.musicxml — open it in MuseScore.`);
  } else if (kind === 'midi') {
    downloadBlob(new Blob([toMIDI(score)], { type: 'audio/midi' }), `${name}.mid`);
    uiSheetMessage(`Saved ${name}.mid.`);
  } else if (kind === 'svg') {
    downloadBlob(new Blob([engrave(score, { width: 1120 })], { type: 'image/svg+xml' }),
                 `${name}.svg`);
    uiSheetMessage(`Saved ${name}.svg — the engraved sheet.`);
  } else if (kind === 'lyrics') {
    const text = `${score.title}\n${score.subtitle}\n\n${generateLyrics(null, score)}\n`;
    downloadBlob(new Blob([text], { type: 'text/plain' }), `${name}-lyrics.txt`);
    uiSheetMessage(`Saved ${name}-lyrics.txt.`);
  }
}

/** One-click PDF export -- rasterizes the same engraved sheet the .svg
 * download uses, then wraps it in a single-page PDF sized to fit it
 * exactly (jsPDF, loaded from a CDN in index.html since this is a
 * client-only app with no build step / bundled dependencies). */
function downloadSheetPdf() {
  const score = currentScore || composeScore(getFullGoalData());
  if (!score.melody.length) {
    return uiSheetMessage('Log a day first — there is nothing to write down yet.', true);
  }
  if (!window.jspdf) {
    return uiSheetMessage('PDF export is still loading -- try again in a moment.', true);
  }

  const svgUrl = URL.createObjectURL(
    new Blob([engrave(score, { width: 1400 })], { type: 'image/svg+xml' }),
  );
  const img = new Image();
  img.onload = () => {
    const scale = 2; // crisp at print size
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth * scale;
    canvas.height = img.naturalHeight * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#332830'; // the engraving's own background -- JPEG has no alpha
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(svgUrl);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: img.naturalWidth >= img.naturalHeight ? 'landscape' : 'portrait',
      unit: 'pt',
      format: [img.naturalWidth, img.naturalHeight],
    });
    // JPEG over PNG: this page is mostly flat colour, so JPEG comes out a
    // fraction of the size with no visible loss on the staff/notes.
    doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, img.naturalWidth, img.naturalHeight);
    doc.save(`${projectSlug()}.pdf`);
    uiSheetMessage(`Saved ${projectSlug()}.pdf.`);
  };
  img.onerror = () => uiSheetMessage('Could not render the sheet for PDF export.', true);
  img.src = svgUrl;
}


/* ══ UI ════════════════════════════════════════════════════════ */

let pendingHours = 1;       // set by setEffortHours() -- the slider always has a value
let pendingMood = null;     // set by setMood()

/** Render the subtask list, what's been logged against it, and its actions. */
function renderSubtaskList() {
  const list = document.getElementById('subtaskList');
  const empty = document.getElementById('subtaskEmpty');
  const current = getCurrentSubtask();

  list.innerHTML = '';
  empty.style.display = state.subtasks.length ? 'none' : 'block';

  state.subtasks.forEach((task) => {
    const isCurrent = current && current.taskId === task.taskId;

    const li = document.createElement('li');
    li.className = `subtask ${task.status}${isCurrent ? ' current' : ''}`;
    li.innerHTML = `
      <div class="subtask-head">
        <span class="subtask-name"></span>
        ${statusBadge(task.status)}
      </div>
      <div class="subtask-actions"></div>
    `;
    li.querySelector('.subtask-name').textContent = task.taskName;

    const actions = li.querySelector('.subtask-actions');
    if (task.status === 'active') {
      actions.appendChild(iconActionButton('check', 'Finished', 'complete', () => {
        completeSubtask(task.taskId);
        render();
        celebrate(task.taskId, 'completed');
      }));
      actions.appendChild(iconActionButton('cross', 'Give up', 'give-up', () => {
        giveUpSubtask(task.taskId);
        render();
        celebrate(task.taskId, 'given_up');
      }));
    } else {
      // Closed by mistake, or picked back up — either way, undo it.
      actions.appendChild(iconActionButton('reopen', 'Reopen', 'reopen', () => {
        reopenSubtask(task.taskId);
        render();
        uiMessage(`"${task.taskName}" is active again — its logs were kept.`);
      }));
    }
    actions.appendChild(iconActionButton('trash', 'Delete', 'delete', () => {
      if (confirm(`Delete "${task.taskName}" and its ${task.dailyLogs.length} log(s)?`)) {
        deleteSubtask(task.taskId);
        render();
      }
    }));

    list.appendChild(li);
  });
}

/**
 * Effort slider input: the dragged value IS the hours, full stop -- it's
 * what feeds effortBand() and, from there, note density. No separate
 * "Other" field, no preset levels to pick between.
 */
function setEffortHours(hours) {
  pendingHours = Number(hours);
  document.getElementById('effortReadout').textContent = `${pendingHours.toFixed(1)}h`;
}

// Four fixed points along a rising arc (echoes the hero's orbit curve),
// hand-picked to sit on the quadratic curve M20,72 Q140,-10 260,18 --
// see .mood-arc-line in styles.css for the matching decorative path.
const MOOD_ARC_POS = [
  { x: 7.1,  y: 80 },
  { x: 35.7, y: 32.8 },
  { x: 64.2, y: 12.8 },
  { x: 92.9, y: 20 },
];

/** Build the four mood dots from MOODS -- color alone carries the mood. */
function renderMoodGrid() {
  const grid = document.getElementById('moodGrid');
  grid.innerHTML = `
    <svg class="mood-arc-line" viewBox="0 0 280 90" preserveAspectRatio="none" aria-hidden="true">
      <path d="M20,72 Q140,-10 260,18" />
    </svg>
    ${MOODS.map((m, i) => `
      <button class="mood-point" data-mood="${m.score}" data-tip="${m.label}"
              aria-label="${m.label}" onclick="setMood(${m.score})"
              style="left:${MOOD_ARC_POS[i].x}%; top:${MOOD_ARC_POS[i].y}%"></button>
    `).join('')}
  `;
}

/** Mood dot click: remember the score until submit. */
function setMood(score) {
  pendingMood = Number(score);
  document.querySelectorAll('#moodGrid .mood-point').forEach((btn) => {
    btn.classList.toggle('selected', Number(btn.dataset.mood) === pendingMood);
  });
}

/** Read the check-in form and hand it to Logic. */
function submitDailyLog() {
  const taskId = document.getElementById('logTask').value;

  if (!taskId) return uiMessage('Add a subtask before logging a day.', true);
  if (!pendingMood) return uiMessage('Pick a mood.', true);

  addDailyLog(taskId, state.currentDate, 'other', pendingHours, pendingMood);

  const task = findSubtask(taskId);
  const dayData = getDataForDay(state.currentDate);
  uiMessage(
    `Logged ${formatDay(state.currentDate)} for "${task.taskName}" — ` +
    `${dayData.isChord ? `${dayData.entries.length} subtasks that day, that's a chord` : 'a single note'}.`
  );

  clearCheckin();

  // Demo convenience: move the working date forward a day after every
  // submit, so running through a demo doesn't require touching the date
  // picker between entries.
  state.currentDate = shiftISO(state.currentDate, 1);
  document.getElementById('dateInput').value = state.currentDate;
  save();

  render();
}

/* ── The reward ────────────────────────────────────────────────
   Closing a movement is the only moment in this app that's worth an
   interruption, so it gets the full treatment: rays, a rarity, the
   engraved card, a chime built from the mode you just earned. */

const RARITIES = [
  { key: 'legendary', at: 7.2, label: 'Legendary', glyph: '𝄞' },
  { key: 'epic',      at: 5.2, label: 'Epic',      glyph: '♬' },
  { key: 'rare',      at: 3.2, label: 'Rare',      glyph: '♫' },
  { key: 'common',    at: -99, label: 'Common',    glyph: '♪' },
];

/**
 * How much this movement is worth. Time spent counts most, then how many
 * separate days it took, then how it felt — and finishing is worth a full
 * point over walking away, without wiping the rest of it out.
 */
function rarityFor(task) {
  const logs = task.dailyLogs;
  const hours = logs.reduce((s, l) => s + l.hours, 0);
  const immersed = logs.filter((l) => effortBand(l) === 'immersed').length;

  const score =
    Math.min(4, hours / 2.5) +
    Math.min(3, logs.length * 0.5) +
    (averageMood(logs) - 1) +
    immersed * 0.4 +
    (task.status === 'completed' ? 1 : -1);

  return { ...RARITIES.find((r) => score >= r.at), score };
}

const FLAVOUR = {
  completed_bright: 'It set up the tonic and then it went there. That is the whole feeling.',
  completed_shadow: 'A minor movement that lands on a major chord. Old trick, still lands.',
  given_up_bright:  'Everything pointed home and then the floor moved. It is still a chord.',
  given_up_shadow:  'It stops without arriving. That is a real ending, just not a happy one.',
  silent:           'Nothing was logged here, so it is written as a rest. Rests are notated too.',
};

function celebrate(taskId, status) {
  const task = findSubtask(taskId);
  if (!task) return;

  const overlay = document.getElementById('rewardOverlay');
  const card = document.getElementById('rewardCard');
  const mv = (currentScore ? currentScore.movements : []).find((m) => m.taskId === taskId);
  const finale = isGoalFinished();
  const rarity = rarityFor(task);

  const silent = !mv;
  const family = mv ? mv.family : 'shadow';
  const flavour = silent ? FLAVOUR.silent : FLAVOUR[`${status}_${family}`];

  // Rarity lives on the overlay so the card, the gem and the flying
  // notes all pick the same glow colour up off one custom property.
  overlay.className = `reward-overlay ${rarity.key} ${status}${finale ? ' finale' : ''}`;
  card.className = `reward-card ${rarity.key} ${status}${finale ? ' finale' : ''}`;

  document.getElementById('rewardKicker').textContent = finale
    ? 'THE SUITE IS FINISHED'
    : status === 'completed' ? 'MOVEMENT COMPLETE' : 'MOVEMENT LEFT OPEN';

  document.getElementById('rewardRarity').textContent = rarity.label;
  document.getElementById('rewardGlyph').textContent = rarity.glyph;

  document.getElementById('rewardTitle').textContent = silent
    ? 'A movement of rest'
    : `${mv.tonicName} ${mv.modeName}`;

  document.getElementById('rewardSub').textContent = silent
    ? task.taskName
    : `${task.taskName} — ${mv.feel}`;

  const hours = loggedHours(taskId);
  const stats = [
    ['Days marked', String(task.dailyLogs.length)],
    ['Hours', hours.toFixed(1)],
    ['Notes written', silent ? '0' : String(mv.noteCount)],
    ['Cadence', silent ? 'none' : mv.cadence],
    ['Colour', silent ? '—' : (family === 'shadow' ? 'shadow' : 'bright')],
  ];
  document.getElementById('rewardStats').innerHTML = stats
    .map(([k, v]) => `<div class="rw-stat"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`)
    .join('');

  document.getElementById('rewardFlavor').textContent = flavour;

  const note = document.getElementById('rewardTurned');
  note.hidden = !(mv && mv.turned);
  note.textContent = 'Every third movement is written in shadow on purpose — ' +
                     'this one was turned even though the days were fine.';

  const finaleBlock = document.getElementById('rewardFinale');
  finaleBlock.hidden = !finale;
  if (finale && currentScore) {
    const bright = currentScore.movements.filter((m) => m.family === 'bright').length;
    finaleBlock.innerHTML =
      `<strong>${escapeHtml(currentScore.title)}</strong> is complete — ` +
      `${currentScore.movements.length} movement${currentScore.movements.length === 1 ? '' : 's'}, ` +
      `${bright} bright and ${currentScore.movements.length - bright} in shadow, ` +
      `${currentScore.measureCount} measures. The sheet is ready to download.`;
  }

  burst(rarity.key);
  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add('open'));

  rewardChime = silent
    ? { kind: 'silent', key: 'aeolian', pc: 0 }
    : {
        kind: finale ? 'goal' : status,
        key: mv.key,
        pc: TONICS.find((t) => t.name === mv.tonicName).pc,
      };
  replayRewardChime();

  document.getElementById('rewardClaim').focus();
}

let rewardChime = null;

function replayRewardChime() {
  if (rewardChime) playChime(rewardChime.kind, rewardChime.key, rewardChime.pc);
}

/** Note glyphs thrown outward from the middle of the card. */
function burst(rarityKey) {
  const wrap = document.getElementById('rewardBurst');
  const glyphs = ['♪', '♫', '♬', '♩', '✦', '𝄞'];
  const count = { legendary: 34, epic: 26, rare: 20, common: 14 }[rarityKey] || 16;

  wrap.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 120 + Math.random() * 190;
    const s = document.createElement('span');
    s.className = 'rw-spark';
    s.textContent = glyphs[Math.floor(Math.random() * glyphs.length)];
    s.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    s.style.setProperty('--dy', `${Math.sin(angle) * dist - 40}px`);
    s.style.setProperty('--rot', `${(Math.random() * 2 - 1) * 220}deg`);
    s.style.setProperty('--delay', `${Math.random() * 0.22}s`);
    s.style.fontSize = `${12 + Math.random() * 16}px`;
    wrap.appendChild(s);
  }
}

function closeReward() {
  const overlay = document.getElementById('rewardOverlay');
  overlay.classList.remove('open');
  setTimeout(() => { overlay.hidden = true; }, 260);
}

/* ── UI helpers ────────────────────────────────────────────── */

function uiAddSubtask() {
  const nameEl = document.getElementById('subtaskName');

  const id = addSubtask(nameEl.value);
  if (!id) return uiMessage('Give the subtask a name first.', true);

  nameEl.value = '';
  nameEl.focus();
  render();
}

function setGoalName(value) {
  state.goalName = value;
  save();
  // renderSong()/renderSheet() are paused -- their cards were pulled out
  // of this page. Logic is intact; re-enable once they're wired up again.
}

function setCurrentDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;   // mid-typing in the picker
  state.currentDate = value;
  save();
  renderCheckin();
}

/** Jump straight back to today, however far the date has wandered. */
function goToToday() {
  state.currentDate = todayISO();
  document.getElementById('dateInput').value = state.currentDate;
  save();
  clearCheckin();
  renderCheckin();
  uiMessage(`Back to today, ${formatDay(state.currentDate)}.`);
}

function clearCheckin() {
  pendingMood = null;
  const slider = document.getElementById('effortSlider');
  slider.value = 1;
  setEffortHours(slider.value);
  document.querySelectorAll('#moodGrid .mood-point')
    .forEach((b) => b.classList.remove('selected'));
}

function renderCheckin() {
  const select = document.getElementById('logTask');
  const previous = select.value;
  const current = getCurrentSubtask();

  select.innerHTML = '';
  state.subtasks
    .filter((t) => t.status === 'active')
    .forEach((task) => {
      const opt = document.createElement('option');
      opt.value = task.taskId;
      opt.textContent = task.taskName;
      select.appendChild(opt);
    });

  if (!select.options.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = state.subtasks.length ? 'No active subtasks left' : 'Add a subtask first';
    select.appendChild(opt);
  } else if (previous && findSubtask(previous) && findSubtask(previous).status === 'active') {
    select.value = previous;
  } else if (current) {
    select.value = current.taskId;
  }
}

function renderTimeline() {
  const wrap = document.getElementById('timeline');
  const empty = document.getElementById('timelineEmpty');
  const days = getLoggedDays();

  wrap.innerHTML = '';
  empty.style.display = days.length ? 'none' : 'block';

  days.forEach((date) => {
    const data = getDataForDay(date);
    const row = document.createElement('div');
    row.className = 'day-row';

    const entries = data.entries
      .map((e) => `<div><span class="mood-dot" data-mood="${e.mood}" title="${MOOD_LABEL[e.mood]}">${moodFace(e.mood)}</span>` +
                  ` ${escapeHtml(e.taskName)} · ${EFFORT_LABEL[effortBand(e)]} · ${e.hours}h</div>`)
      .join('');

    row.innerHTML = `
      <span class="day-num">${escapeHtml(formatDay(date))}</span>
      <div class="day-entries">${entries}</div>
      <span class="day-kind ${data.isChord ? 'chord' : 'note'}">${data.isChord ? '♬ Chord' : '♪ Note'}</span>
    `;
    wrap.appendChild(row);
  });

  wrap.scrollTop = wrap.scrollHeight;
}

function renderSong() {
  const btn = document.getElementById('playBtn');
  const stateLine = document.getElementById('songState');

  const ready = hasAnyLogs();
  const finished = isGoalFinished() && ready;

  btn.disabled = !ready;
  btn.textContent = finished ? '▶ Play the full song' : '▶ Play the song so far';

  if (!ready) {
    stateLine.textContent = 'Log a day to start writing the song.';
    return;
  }

  stateLine.textContent = finished
    ? 'Every subtask is closed out — the movements are stitched into one suite.'
    : 'Still in progress. This plays what exists so far; the full suite arrives when every subtask is completed or given up.';
}

/** The engraved sheet, plus the download row. */
function renderSheet() {
  const card = document.getElementById('sheetCard');
  const paper = document.getElementById('sheetPaper');
  const empty = document.getElementById('sheetEmpty');
  const meta = document.getElementById('sheetMeta');

  const ready = currentScore && currentScore.melody.length > 0;
  card.classList.toggle('idle', !ready);
  empty.style.display = ready ? 'none' : 'block';
  document.querySelectorAll('#sheetActions button').forEach((b) => { b.disabled = !ready; });

  if (!ready) {
    paper.innerHTML = '';
    meta.textContent = '';
    return;
  }

  const bright = currentScore.movements.filter((m) => m.family === 'bright').length;
  const shadow = currentScore.movements.length - bright;

  meta.innerHTML =
    `<strong>${escapeHtml(currentScore.title)}</strong> · ${escapeHtml(currentScore.subtitle)} · ` +
    `${currentScore.measureCount} measures · ♩=${currentScore.tempo} · ` +
    `${bright} bright, ${shadow} shadow · files named <code>${escapeHtml(projectSlug())}</code>`;

  // The preview is capped; the download always carries the whole thing.
  paper.innerHTML = engrave(currentScore, { width: 1120, maxMeasures: 40 });
}

function uiMessage(text, isError) {
  const el = document.getElementById('checkinMsg');
  el.textContent = text;
  el.className = `msg${isError ? ' error' : ''}`;
}

function uiSongMessage(text, isError) {
  const el = document.getElementById('songState');
  if (!el) return; // the song card isn't on this page right now
  el.textContent = text;
  el.style.color = isError ? 'var(--rose)' : '';
}

function uiSheetMessage(text, isError) {
  const el = document.getElementById('sheetMsg');
  if (!el) return; // the sheet card isn't on this page right now
  el.textContent = text;
  el.className = `msg${isError ? ' error' : ''}`;
}

const ICON_PATHS = {
  check: 'M5 13l4 4L19 7',
  cross: 'M6 6l12 12M18 6L6 18',
  trash: 'M4 7h16M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7m2 0v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V7h10Z',
  reopen: 'M9 14 4 9l5-5M4 9h10a5 5 0 0 1 0 10h-1',
};

/** A small round icon button — used where a text label would be too loud
 * (mark complete / give up / delete / reopen). A fast custom tooltip
 * (data-tip, see styles.css) is the only label -- no native title="",
 * its hover delay is too slow to feel responsive. */
function iconActionButton(icon, tip, className, onClick) {
  const btn = document.createElement('button');
  btn.className = `icon-btn ${className}`;
  btn.dataset.tip = tip;
  btn.setAttribute('aria-label', tip);
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round"><path d="${ICON_PATHS[icon]}"/></svg>`;
  btn.addEventListener('click', onClick);
  return btn;
}

function statusLabel(status) {
  return { active: 'Active', completed: 'Completed', given_up: 'Given up' }[status] || status;
}

/** completed/active read as a same-size teal icon (ring+check / dot);
 * given_up keeps the text pill -- it's the one state worth reading at a
 * glance, not just scanning for. */
function statusBadge(status) {
  if (status === 'given_up') {
    return `<span class="badge given_up">${statusLabel(status)}</span>`;
  }
  const icon = status === 'completed'
    ? '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L15.5 9"/>'
    : '<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>';
  return `<span class="badge-icon ${status}" data-tip="${statusLabel(status)}">` +
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round">${icon}</svg></span>`;
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function render() {
  // One compose per render — every panel below reads the same score.
  currentScore = composeScore(getFullGoalData());
  renderSubtaskList();
  renderCheckin();
  // renderTimeline()/renderSong()/renderSheet() are paused -- their cards
  // were pulled out of this page. Logic is intact; re-enable once they're
  // wired up again.
}

/* ── Demo + reset ──────────────────────────────────────────── */

function loadDemo() {
  if (hasAnyLogs() && !confirm('This replaces the current goal. Continue?')) return;

  // Six days back up to today, so the demo always looks recent.
  const day = (n) => shiftISO(todayISO(), n - 6);

  state = { goalName: 'Build a robot', subtasks: [], currentDate: todayISO() };

  const cad = addSubtask('CAD the robot');
  const wiring = addSubtask('Wire the circuit');
  const software = addSubtask('Write the control software');

  addDailyLog(cad, day(1), 'a_while', 2.5, 3);
  addDailyLog(cad, day(2), 'immersed', 3, 4);
  completeSubtask(cad);

  addDailyLog(wiring, day(4), 'a_while', 2.5, 2);
  addDailyLog(software, day(4), 'immersed', 4, 4);   // same date as wiring → chord
  addDailyLog(wiring, day(5), 'barely', 0.5, 1);
  giveUpSubtask(wiring);

  document.getElementById('goalName').value = state.goalName;
  document.getElementById('dateInput').value = state.currentDate;
  save();
  render();
  uiMessage(`Demo loaded — ${formatDay(day(4))} has two subtasks, so it plays as a chord.`);
}

function resetAll() {
  if (!confirm('Delete the goal, every subtask, and every log?')) return;
  stopSong();
  state = { goalName: '', subtasks: [], currentDate: todayISO() };
  save();
  document.getElementById('goalName').value = '';
  document.getElementById('dateInput').value = state.currentDate;
  clearCheckin();
  render();
  uiMessage('Cleared.');
}

/* ── Boot ──────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  load();
  if (!state.currentDate) state.currentDate = todayISO();
  document.getElementById('goalName').value = state.goalName;
  document.getElementById('dateInput').value = state.currentDate;

  document.getElementById('subtaskName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') uiAddSubtask();
  });

  document.getElementById('rewardOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'rewardOverlay') closeReward();
  });

  document.getElementById('playerOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'playerOverlay') closePlayer();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!document.getElementById('rewardOverlay').hidden) closeReward();
    if (!document.getElementById('playerOverlay').hidden) closePlayer();
  });

  renderMoodGrid();
  render();
});
