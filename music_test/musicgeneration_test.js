// A chromatic table counted in semitones from the root (C4), used to turn a semitone distance into an actual note name
const CHROMATIC_FROM_ROOT = [
  "C4", "Db4", "D4", "Eb4", "E4", "F4", "Gb4", "G4", "Ab4", "A4", "Bb4", "B4", "C5",
];

// mood -> melodic contour, expressed as semitone distances from the root instead of
// "which scale degree of major/minor". Smaller semitone distance = smaller movement/
// more "stuck"; larger distance and more notes = more movement/more alive
const MOOD_CONFIG = {
  1: [0, 1], // very bad: barely moves a half-step, deliberately outside the scale for an unsettled feeling
  2: [0, 3], // bad: moves between the root and the minor 3rd
  3: [0, 4, 7], // okay: root, major 3rd, 5th
  4: [0, 2, 4, 5, 7, 9, 11, 12], // great: climbs the whole major scale up to the octave
};

// effort -> how many notes fill the measure, how long each one is, how loud
const EFFORT_CONFIG = {
  barely: { duration: "1n", count: 1, velocity: 0.3 },
  a_little: { duration: "2n", count: 2, velocity: 0.5 },
  a_while: { duration: "4n", count: 4, velocity: 0.7 },
  immersed: { duration: "8n", count: 8, velocity: 1.0 },
};

// Turns one day's { mood, effort } into a full measure: an ordered array of
// notes to play back-to-back, each with its own duration and velocity.
function moodEffortToMeasure(mood, effort) {
  const contour = MOOD_CONFIG[mood];
  const { duration, count, velocity } = EFFORT_CONFIG[effort];

  const notes = [];
  for (let i = 0; i < count; i++) {
    const semitoneOffset = contour[i % contour.length];
    notes.push({
      note: CHROMATIC_FROM_ROOT[semitoneOffset],
      duration,
      velocity,
    });
  }

  // Special case: on the worst-mood, least-effort day, let the sound trail off into silence for the second half of the measure
  if (mood === 1 && effort === "barely") {
    return [
      { note: notes[0].note, duration: "2n", velocity: notes[0].velocity },
      { note: null, duration: "2n", velocity: 0 }, // note: null means a rest — takes up time but plays nothing
    ];
  }

  return notes;
}

console.log(moodEffortToMeasure(1, "immersed"));
console.log(moodEffortToMeasure(4, "barely"));
console.log(moodEffortToMeasure(4, "immersed"));
