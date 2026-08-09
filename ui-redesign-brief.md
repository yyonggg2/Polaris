# Perigee — 3D UI redesign brief

A doc to hand to Figma / Gemini (or any design tool) to ask for a new UI that
actually fits the app's theme. Part one is what the app *does* under the
hood, so the visuals can be grounded in real state instead of guesswork.
Part two is the creative direction we want to move toward.

## What the app is

Turn daily progress on a goal into a piece of music. You split a goal into
subtasks, log how each day went (effort + mood), and as subtasks get
completed or given up, the app composes a real, playable song — with
lyrics and exportable sheet music — out of that history.

## The data model (what the UI needs to represent)

- **Goal** — a name, and a list of subtasks.
- **Subtask** — a name, a status (`active` / `completed` / `given_up`), and
  a list of daily logs.
- **Daily log** — one entry per subtask per day: an **effort level** (4
  fixed tiers — barely / a little / a while / immersed — each with a
  default hour count, or a custom "other" amount) and a **mood** (1–4,
  worst to best).
- **Chord day** — when two or more subtasks get a log on the *same date*,
  that day is musically a chord instead of a single note. This is a
  meaningful, visually-worth-showing event: multiple things happening at once.

## How a day's data becomes music (functional summary, not code)

- Each subtask becomes its own **movement** in a suite, written in its own
  musical key/mode — chosen from the subtask's *average* mood across its
  days, plus a rotation rule that keeps the whole piece from being
  uniformly cheerful (variety is deliberate, not random).
- **Effort** shapes rhythm — how many notes and how dense that day's
  musical phrase is.
- **Mood** shapes pitch/brightness — darker mood, darker-sounding mode;
  brighter mood, brighter mode.
- When a subtask closes, it gets a real musical ending, not just a stop:
  - `completed` → a resolved, "arrived home" cadence.
  - `given_up` → an unresolved, "left hanging" cadence — it doesn't
    disappear, it just doesn't resolve.
  - still `active` → trails off like an open question.
- Once the whole goal is done, every movement stitches into one song, with
  generated lyrics (following the mood trend) and downloadable sheet music.

## Current UI (what's being replaced)

A flat, 2D "space" scene: starfield, nebula, a distant ringed planet,
drifting comets, aurora curtains — all purely decorative background behind
plain glass cards (subtask list, daily check-in form, a day-by-day
timeline, a song player with lyrics, and a sheet-music viewer with export
buttons). It doesn't visually represent the *data* at all — the cosmic
theme is atmosphere, not information.

## The new direction: an orbital metaphor

The app is named after **perigee** — the point in an orbit closest to what
you're circling. The redesign should make that literal:

- **The moon is the goal in motion.** Its orbit is the thing the whole UI
  centers on, in 3D.
- **Every time a subtask is completed, the moon's orbit nudges a little
  closer to perigee** — visibly, physically closer to the body it orbits.
- **Over the course of the whole goal, that accumulated movement should
  actually bend Earth's own path a bit** — the idea being that sustained
  effort doesn't just move you, it changes the shape of what you're
  orbiting around. That's the emotional payoff at the end of a finished
  goal.

## Open questions for the designer

These are intentionally unresolved — they're the actual design problem:

- What does a **`given_up`** subtask look like orbitally? A moon that
  drifts outward instead of inward? A path that goes slack?
- How should a single **day's effort/mood** register visually — glow
  color and intensity for mood, orbital speed or trail density for effort?
- What does a **chord day** (multiple subtasks progressing at once) look
  like — a second moon briefly in view? A pulse?
- How does **playing the song** relate to the orbital motion — does the
  moon actually move in real time as the music plays, or is the orbit a
  static "progress so far" view and playback is separate?
- Where do **lyrics and sheet music** live in a 3D scene without it
  turning back into a flat 2D panel bolted onto a 3D background?

## Ask

Given the above, propose a 3D UI (Figma concept or direct visual
direction) built around the Earth–Moon–perigee metaphor, that still
surfaces every piece of state listed above — subtasks, daily logs,
movement/cadence, chord days — as something the user can actually read at
a glance, not just something pretty in the background.
