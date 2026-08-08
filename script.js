/* ══════════════════════════════════════════════════════════════
   Polaris — every goal becomes a song.

   Three layers, kept apart on purpose:
     LOGIC  — owns the data. Knows nothing about sound or the DOM.
     MUSIC  — takes Logic's data, makes a song. Exposes playSong().
     UI     — buttons and rendering. Calls Logic, then playSong().
   ══════════════════════════════════════════════════════════════ */


/* ══ LOGIC ═════════════════════════════════════════════════════ */

const EFFORT_HOURS = {
  barely:   0.5,
  a_little: 1,
  a_while:  2.5,
  immersed: 4,
};

const EFFORT_LABEL = {
  barely:   'Barely did anything',
  a_little: 'Touched on it a little',
  a_while:  'Worked on it for a while',
  immersed: 'Fully immersed',
};

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

const STORAGE_KEY = 'polaris.goal.v1';

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
  return d.toLocaleDateString(undefined, opts);
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
 * effort: 'barely' | 'a_little' | 'a_while' | 'immersed'
 * hours:  defaults to the effort level's hours, but the user can override
 * mood:   1–4
 */
function addDailyLog(taskId, date, effort, hours, mood) {
  const task = findSubtask(taskId);
  if (!task) return false;

  const iso = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayISO();
  const entry = {
    date: iso,
    effort: EFFORT_HOURS[effort] !== undefined ? effort : 'a_little',
    hours: hours === undefined || hours === null || hours === ''
      ? EFFORT_HOURS[effort]
      : Math.max(0, Number(hours)),
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

/*  How the data becomes sound:
      effort  → note length + how many notes fire that day (density)
      mood    → pitch height, and major vs minor for the whole song
      1 entry on a day → single note ·  2+ entries → chord
      completed subtask → V–I cadence, it lands home
      given up subtask  → suspended chord left hanging, no resolution   */

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

const EFFORT_SHAPE = {
  barely:   { dur: 0.30, density: 1, gain: 0.10 },
  a_little: { dur: 0.45, density: 1, gain: 0.14 },
  a_while:  { dur: 0.65, density: 2, gain: 0.18 },
  immersed: { dur: 0.90, density: 3, gain: 0.22 },
};

const MOOD_DEGREE = { 1: 0, 2: 2, 3: 4, 4: 6 };

const ROOT_MIDI = 60;   // middle C

let audioCtx = null;
let masterGain = null;
let activeNodes = [];

/**
 * The one function the UI needs. Takes Logic's data (or fetches it),
 * builds the whole song, and plays it.
 */
function playSong(goalData) {
  const data = goalData || getFullGoalData();
  const score = composeSong(data);

  if (!score.events.length) {
    uiSongMessage('Nothing to play yet — log a day first.', true);
    return null;
  }

  stopSong();
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') ctx.resume();

  const start = ctx.currentTime + 0.12;
  score.events.forEach((ev) => scheduleEvent(ctx, ev, start));

  uiSongMessage(
    `Playing ${score.isFull ? 'the full song' : 'the song so far'} — ` +
    `${score.mode}, ${score.dayCount} day${score.dayCount === 1 ? '' : 's'}, ` +
    `${score.chordDays} chord day${score.chordDays === 1 ? '' : 's'}, ` +
    `${score.duration.toFixed(1)}s.`
  );

  return score;
}

/** Cut everything off immediately. */
function stopSong() {
  activeNodes.forEach((n) => {
    try { n.stop(); } catch (e) { /* already stopped */ }
  });
  activeNodes = [];
}

/**
 * Build the score without playing it: one segment per subtask, in order,
 * each ending in its own cadence, stitched into a single timeline.
 */
function composeSong(goalData) {
  const events = [];
  const allLogs = goalData.subtasks.flatMap((t) => t.dailyLogs);

  if (!allLogs.length) {
    return { events, duration: 0, mode: 'major', dayCount: 0, chordDays: 0, isFull: false };
  }

  // The overall mood of the goal decides the key the whole song lives in.
  const avgMood = allLogs.reduce((s, l) => s + l.mood, 0) / allLogs.length;
  const scale = avgMood >= 2.5 ? MAJOR : MINOR;
  const mode = avgMood >= 2.5 ? 'major' : 'minor';

  // Which dates had more than one subtask logged → chords.
  const dayCounts = {};
  allLogs.forEach((l) => { dayCounts[l.date] = (dayCounts[l.date] || 0) + 1; });

  let t = 0;
  const chordDaySet = new Set();

  goalData.subtasks.forEach((task) => {
    if (!task.dailyLogs.length && task.status === 'active') return;

    const segStart = t;

    task.dailyLogs.forEach((log, i) => {
      const shape = EFFORT_SHAPE[log.effort] || EFFORT_SHAPE.a_little;
      const isChord = dayCounts[log.date] > 1;
      if (isChord) chordDaySet.add(log.date);

      const rootMidi = ROOT_MIDI + degreeToSemitone(scale, MOOD_DEGREE[log.mood] + (i % 3));
      const midis = isChord
        ? [rootMidi, rootMidi + degreeSpan(scale, 2), rootMidi + degreeSpan(scale, 4)]
        : [rootMidi];

      // Effort density: the harder the day, the more notes it fires.
      const step = shape.dur / shape.density;
      for (let d = 0; d < shape.density; d++) {
        events.push({
          time: t + d * step,
          midis: midis.map((m) => (d > 0 ? m + 12 * (d % 2) : m)),
          dur: step * 0.9,
          gain: shape.gain * (d === 0 ? 1 : 0.62),
          wave: 'triangle',
        });
      }

      t += shape.dur + 0.14;
    });

    // A quiet root drone under the whole segment holds it together.
    if (t > segStart) {
      events.push({
        time: segStart,
        midis: [ROOT_MIDI - 24],
        dur: t - segStart + 0.5,
        gain: 0.07,
        wave: 'sine',
      });
    }

    t += appendCadence(events, t, scale, task.status);
  });

  const duration = events.reduce((max, e) => Math.max(max, e.time + e.dur), 0);
  const isFull = goalData.subtasks.length > 0 &&
    goalData.subtasks.every((s) => s.status !== 'active');

  return {
    events,
    duration,
    mode,
    dayCount: new Set(allLogs.map((l) => l.date)).size,
    chordDays: chordDaySet.size,
    isFull,
  };
}

/**
 * End of a subtask.
 *   completed → V then I. It resolves; you hear it land.
 *   given up  → a sus4 with a rubbed second, left hanging. No resolution,
 *               but still a sound — giving up leaves a trace.
 *   active    → a short breath, the segment isn't over yet.
 * Returns how much time the cadence consumed.
 */
function appendCadence(events, t, scale, status) {
  if (status === 'completed') {
    const dominant = [4, 6, 8].map((d) => ROOT_MIDI + degreeToSemitone(scale, d));
    const tonic    = [0, 2, 4].map((d) => ROOT_MIDI + degreeToSemitone(scale, d));

    events.push({ time: t,        midis: dominant, dur: 0.55, gain: 0.16, wave: 'triangle' });
    events.push({ time: t + 0.60, midis: tonic,    dur: 1.20, gain: 0.19, wave: 'triangle' });
    events.push({ time: t + 0.60, midis: [ROOT_MIDI - 12], dur: 1.30, gain: 0.10, wave: 'sine' });
    return 2.1;
  }

  if (status === 'given_up') {
    const sus = [
      ROOT_MIDI + degreeToSemitone(scale, 0),
      ROOT_MIDI + degreeToSemitone(scale, 3),   // the 4th, never falling to the 3rd
      ROOT_MIDI + degreeToSemitone(scale, 4),
      ROOT_MIDI + degreeToSemitone(scale, 1) + 12,
    ];
    events.push({ time: t, midis: sus, dur: 1.60, gain: 0.15, wave: 'triangle' });
    return 2.0;
  }

  events.push({
    time: t,
    midis: [ROOT_MIDI + degreeToSemitone(scale, 4)],
    dur: 0.5,
    gain: 0.09,
    wave: 'triangle',
  });
  return 1.0;
}

/* ── Lyrics ────────────────────────────────────────────────── */

/**
 * Lyrics follow the mood trend and the length of the goal:
 * more days → more lines. Each subtask gets its own couplet, coloured
 * by how it felt and by how it ended.
 */
function generateLyrics(goalData) {
  const data = goalData || getFullGoalData();
  const allLogs = data.subtasks.flatMap((t) => t.dailyLogs);
  if (!allLogs.length) return '';

  const dates = [...new Set(allLogs.map((l) => l.date))].sort((a, b) => a.localeCompare(b));
  const days = dates.length;
  // Real dates mean duration is the calendar span, not the number of
  // days worked — a goal with gaps in it genuinely took longer.
  const span = daysBetween(dates[0], dates[days - 1]);
  const avg = allLogs.reduce((s, l) => s + l.mood, 0) / allLogs.length;
  const trend = moodTrend(allLogs);
  const goal = data.goalName || 'this thing';

  const lines = [];

  lines.push(`[ ${goal} ]`);
  lines.push(`${formatDay(dates[0])} — ${formatDay(dates[days - 1])}`);
  lines.push('');
  // Two openers lead with {goal}; the user's own casing shouldn't start a line lowercase.
  const opener = pick(OPENERS[trend], days).replace('{goal}', goal);
  lines.push(opener.charAt(0).toUpperCase() + opener.slice(1));
  lines.push(span > days
    ? `${days} day${days === 1 ? '' : 's'} worked out of ${span}, and I kept the tally.`
    : `${days} day${days === 1 ? '' : 's'} of it, and I kept the tally.`);
  lines.push('');

  data.subtasks.forEach((task, i) => {
    if (!task.dailyLogs.length) return;

    const taskAvg = task.dailyLogs.reduce((s, l) => s + l.mood, 0) / task.dailyLogs.length;
    const hours = task.dailyLogs.reduce((s, l) => s + l.hours, 0);
    const band = taskAvg >= 3.5 ? 'high' : taskAvg >= 2.5 ? 'mid' : taskAvg >= 1.5 ? 'low' : 'dark';

    lines.push(`— ${task.taskName} —`);
    lines.push(pick(VERSE[band], i));
    lines.push(`${hours.toFixed(1)} hours in, ${task.dailyLogs.length} day${task.dailyLogs.length === 1 ? '' : 's'} marked.`);
    lines.push(pick(ENDING[task.status], i));
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
    lines.push('Not finished. The song stops mid-phrase,');
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

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.9;
    masterGain.connect(audioCtx.destination);
  }
  return audioCtx;
}

function scheduleEvent(ctx, ev, start) {
  const at = start + ev.time;

  ev.midis.forEach((midi) => {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = ev.wave;
    osc.frequency.value = midiToFreq(midi);

    const peak = ev.gain / Math.sqrt(ev.midis.length);
    const attack = Math.min(0.04, ev.dur * 0.2);

    env.gain.setValueAtTime(0.0001, at);
    env.gain.linearRampToValueAtTime(peak, at + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, at + ev.dur);

    osc.connect(env);
    env.connect(masterGain);
    osc.start(at);
    osc.stop(at + ev.dur + 0.05);

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

/** Scale degree → semitones, wrapping into higher octaves past the 7th. */
function degreeToSemitone(scale, degree) {
  const octave = Math.floor(degree / scale.length);
  const idx = ((degree % scale.length) + scale.length) % scale.length;
  return scale[idx] + 12 * octave;
}

function degreeSpan(scale, degrees) {
  return degreeToSemitone(scale, degrees);
}


/* ══ UI ════════════════════════════════════════════════════════ */

let pendingEffort = null;   // set by setEffort()
let pendingMood = null;     // set by setMood()

/** Render the subtask list, what's been logged against it, and its actions. */
function renderSubtaskList() {
  const list = document.getElementById('subtaskList');
  const empty = document.getElementById('subtaskEmpty');
  const current = getCurrentSubtask();

  list.innerHTML = '';
  empty.style.display = state.subtasks.length ? 'none' : 'block';

  state.subtasks.forEach((task) => {
    const logged = loggedHours(task.taskId);
    const days = task.dailyLogs.length;
    const isCurrent = current && current.taskId === task.taskId;

    const li = document.createElement('li');
    li.className = `subtask ${task.status}${isCurrent ? ' current' : ''}`;
    li.innerHTML = `
      <div class="subtask-head">
        <span class="subtask-name"></span>
        <span class="badge ${task.status}">${statusLabel(task.status)}</span>
        <span class="subtask-meta">${logged.toFixed(1)} h · ${days} day${days === 1 ? '' : 's'}</span>
      </div>
      <div class="subtask-actions"></div>
    `;
    li.querySelector('.subtask-name').textContent = task.taskName;

    const actions = li.querySelector('.subtask-actions');
    if (task.status === 'active') {
      actions.appendChild(actionButton('Mark complete', 'ghost', () => {
        completeSubtask(task.taskId);
        render();
      }));
      actions.appendChild(actionButton('Give up', 'ghost danger', () => {
        giveUpSubtask(task.taskId);
        render();
      }));
    } else {
      // Closed by mistake, or picked back up — either way, undo it.
      actions.appendChild(actionButton('↩ Reopen', 'ghost', () => {
        reopenSubtask(task.taskId);
        render();
        uiMessage(`"${task.taskName}" is active again — its logs were kept.`);
      }));
    }
    actions.appendChild(actionButton('Delete', 'ghost danger small', () => {
      if (confirm(`Delete "${task.taskName}" and its ${task.dailyLogs.length} log(s)?`)) {
        deleteSubtask(task.taskId);
        render();
      }
    }));

    list.appendChild(li);
  });
}

/** Effort button click: remember the level, pre-fill the editable hours. */
function setEffort(level, defaultHours) {
  pendingEffort = level;
  document.getElementById('hoursInput').value =
    defaultHours !== undefined ? defaultHours : EFFORT_HOURS[level];

  document.querySelectorAll('#effortGrid .chip').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.effort === level);
  });
}

/** Build the four mood buttons from MOODS, so the faces have one home. */
function renderMoodGrid() {
  const grid = document.getElementById('moodGrid');
  grid.innerHTML = MOODS.map((m) => `
    <button class="chip mood" data-mood="${m.score}" title="${m.label}"
            aria-label="${m.label}" onclick="setMood(${m.score})">
      ${moodFace(m.score)}
      <span class="mood-word">${m.word}</span>
    </button>
  `).join('');
}

/** Mood button click: remember the score until submit. */
function setMood(score) {
  pendingMood = Number(score);
  document.querySelectorAll('#moodGrid .chip').forEach((btn) => {
    btn.classList.toggle('selected', Number(btn.dataset.mood) === pendingMood);
  });
}

/** Read the check-in form and hand it to Logic. */
function submitDailyLog() {
  const taskId = document.getElementById('logTask').value;
  const hours = document.getElementById('hoursInput').value;

  if (!taskId) return uiMessage('Add a subtask before logging a day.', true);
  if (!pendingEffort) return uiMessage('Pick an effort level.', true);
  if (!pendingMood) return uiMessage('Pick a mood.', true);

  addDailyLog(taskId, state.currentDate, pendingEffort, hours, pendingMood);

  const task = findSubtask(taskId);
  const dayData = getDataForDay(state.currentDate);
  uiMessage(
    `Logged ${formatDay(state.currentDate)} for "${task.taskName}" — ` +
    `${dayData.isChord ? `${dayData.entries.length} subtasks that day, that's a chord` : 'a single note'}.`
  );

  clearCheckin();
  render();
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
  renderSong();
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
  pendingEffort = null;
  pendingMood = null;
  document.getElementById('hoursInput').value = 0;
  document.querySelectorAll('#effortGrid .chip, #moodGrid .chip')
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
                  ` ${escapeHtml(e.taskName)} · ${EFFORT_LABEL[e.effort]} · ${e.hours}h</div>`)
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
  const lyricsEl = document.getElementById('lyrics');

  const ready = hasAnyLogs();
  const finished = isGoalFinished() && ready;

  btn.disabled = !ready;
  btn.textContent = finished ? '▶ Play the full song' : '▶ Play the song so far';

  if (!ready) {
    stateLine.textContent = 'Log a day to start writing the song.';
    lyricsEl.textContent = '';
    return;
  }

  stateLine.textContent = finished
    ? 'Every subtask is closed out — the segments are stitched into one full song.'
    : 'Still in progress. This plays what exists so far; the full song arrives when every subtask is completed or given up.';

  lyricsEl.textContent = generateLyrics();
}

function uiMessage(text, isError) {
  const el = document.getElementById('checkinMsg');
  el.textContent = text;
  el.className = `msg${isError ? ' error' : ''}`;
}

function uiSongMessage(text, isError) {
  const el = document.getElementById('songState');
  el.textContent = text;
  el.style.color = isError ? 'var(--rose)' : '';
}

function actionButton(label, className, onClick) {
  const btn = document.createElement('button');
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function statusLabel(status) {
  return { active: 'Active', completed: 'Completed', given_up: 'Given up' }[status] || status;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function render() {
  renderSubtaskList();
  renderCheckin();
  renderTimeline();
  renderSong();
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

  renderMoodGrid();
  render();
});
