# Piano Trainer

A personal piano-practice PWA driven by a USB MIDI keyboard (built for the Arturia KeyLab Essential, works with any MIDI input). Desktop-first; runs in **Chrome or Edge** (Web MIDI). No backend and no accounts: everything is stored in the browser's IndexedDB.

The app has three areas, switched with the header tabs or **P** / **T** / **L**:

- **Play** (opens on launch): free playing. A live grand staff shows what you're holding (chords stacked), with the note names and, for three or more notes, the chord name (via tonal). Optional visualiser (V). Nothing is scored or recorded.
- **Study**: notes, chords and scales with spaced repetition (FSRS). A card appears, you play it, and FSRS decides when you see it again. There's also free practice. The header's due count is visible from every area.
- **Library** (**L**): every chord and scale. Browse, search, hear it and play along, see its fingering, add it to review, and build decks.

## Setup

Requires Node 20+ (CI uses Node 24).

```bash
npm install
npm run dev
```

Open the printed URL (http://localhost:5173/piano-trainer/). Plug in the keyboard before or after opening the app; it connects automatically, and Chrome asks once for MIDI permission. Click or press any key once so the browser allows audio.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Typecheck, then build the production app into `dist/` (with service worker) |
| `npm run preview` | Serve the production build locally |
| `npm test` | Unit tests (Vitest): chord recognition, spelling, scale checking, fingering, search/deck filters, grading, scheduling, storage (including database upgrades) |
| `npm run typecheck` | TypeScript only |

## Using it

### Play

| Key | Action |
| --- | --- |
| V | Visualiser on/off |
| O | Staff overlay on/off (with the visualiser) |
| N | Note names on every on-screen key |
| S | Settings |
| - / = / 0 | Zoom the keyboard out / in / fit |

With the visualiser off, the Play card fills the stage and the staff is sized to the card's shape.

With the **visualiser** on (V), it becomes the stage: everything between the header and the keyboard, always dark, even in light theme. The staff and note readout shrink to a translucent overlay in the top-left corner (O hides it; remembered).

- **Bars:** rounded pills about 80% of the key's width, drawn as a near-white core inside a soft glow in the note's colour. Each is born at the keyboard edge and grows while the key, or the sustain pedal, holds it. On release it rises at a steady speed off the top, fading only in the top 15% of the stage. Striking a key again while its bar is still attached leaves a small gap.
- **Keyboard edge:** a thin glowing horizon line runs along the keyboard's top edge and flashes in each new note's colour. Pressed keys light up in that colour: white keys tinted, black keys more strongly.
- **Particles** (a separate setting): embers burst from the key on note-on (more at higher velocity) and trickle up while it's held. They drift, flicker, shrink and fade over 1–2 s.
- **Colour presets** (Settings → Play): Rainbow by pitch class (C red … B violet), Neon (hot pink), Ice (cyan/blue) or a single accent colour.
- **Reduced motion:** with the system's reduced-motion setting, bars fade in place and there are no particles.

It's the only place in the app that uses strong colour. Glow is pre-rendered once per colour into small sprites and drawn with additive blending (no per-frame blur). Particles are capped at 600, and the canvas is limited to 2× pixel density.

### Study

- **Today** shows how many cards are due and roughly how long they take. Press **Space** (or Start) to go through them back to back. When nothing is due, Space starts **Practise ahead** (a few unseen cards plus the soonest-due ones).
- **Free practice** (the tab next to Today, or **E**) drills whatever you choose, in random order with no limit:
  - **What to drill:** Notes, Chords or Scales, in the hand you pick.
    - Notes: a range per clef (with ledger-line and accidental options), or specific keys picked by playing or clicking them; doing it again removes them.
    - Chords: by quality, root and inversion.
    - Scales: by type, tonic and octaves.
  - **Nothing changes your schedule:** attempts are logged, marked as free practice, in a separate `attempts` store and included in the export.
  - **Remembered:** your last selection is kept, and 1/2/3 switch its hand.
  - **From the Library:** "Practise now" and a deck's "Practise" use free practice too.
- **The legend's hand decides which cards come up.** Left hand reads the bass clef and right the treble; chord and scale cards are made for a hand. "Both" means hands together: the chord in each hand, or the scale in parallel octaves.
- **Notes:** each note (clef + written pitch) is its own card.
  - Wrong = Again; correct in under 1 s = Easy, 1–3 s = Good, over 3 s = Hard.
  - A wrong note flashes red on the key you played and marks the correct key; the card waits until you play it.
- **Chords:** the card shows the chord name, plus the staff if you turn that on in Settings.
  - Play it anywhere: pitch classes are compared, so any voicing or octave counts, but the inversion's bass must be lowest.
  - A note outside the chord is wrong at once, and so is letting go without the whole chord. The missing keys (or the bass) are marked and the card waits for the chord.
  - Correct in under 2.5 s = Easy, up to 6 s = Good, longer = Hard.
- **Scales:** the card shows the scale name; play it ascending, or up and down (Settings).
  - Notes are checked in order. A wrong note is marked and counted, and you carry on from the note that was expected.
  - Graded at the end: more than two wrong notes = Again; otherwise speed per note decides. Fingering is shown on the keys unless F hides it.
- **Thresholds:** all grading thresholds are in one config, `src/core/grading.ts`. Hearing the answer first (H) caps the grade at Hard. Failed cards come back later in the same session.
- **New cards:** each kind has its own daily limit for new cards (Settings → Study; defaults notes 10, chords 5, scales 3), so adding a big deck never crowds out the rest. Due reviews are never limited. New notes start at middle C and work outwards; chords and scales come in the order you added them. C♯ and D♭ are separate note cards (different staff positions) answered by the same key.
- **Identity:** a chord card is root + quality + inversion + hand; a scale card is tonic + type + hand + octaves.

| Key | Action |
| --- | --- |
| Space | Start / pause |
| R | Restart the current card (resets the timer) |
| → | Skip the card (it moves to the end of the session) |
| H | Hear the answer (note, chord, scale) |
| Esc | Back to Today (or wherever the drill was started) |
| S | Settings (from Today) |
| 1 / 2 / 3 | Practise the left hand / right hand / both |
| P / T / L | Go to Play / Study / Library (on every screen) |
| E | Free practice |
| ← | Previous card, replayed as ungraded practice |
| F | Fingering on/off everywhere (keys, staff, hand legend) |
| - / = / 0 | Zoom the on-screen keyboard out / in / fit the full range |

The on-screen keys can also be clicked, which helps when no MIDI keyboard is connected.

**On-screen keyboard**: it shows the connected keyboard's keys, read from the device name (e.g. "KeyLab Essential 61" → 61 keys, C2–C7; 25/32/37/49/73/76/88-key names are recognised too). When the name doesn't say, it shows 61 keys. If the drill range goes beyond that, the view widens to include it. The zoom slider (top right of the keyboard, or - = 0) goes from fitting the full range down to about two octaves, and the level is remembered. When zoomed in, the view follows the current card's note and the keys you play. It only scrolls when a key leaves the view, and then recentres, so it doesn't jump on every note. Every C is labelled and middle C (C4) is emphasised. Zooming changes key width only, so nothing above the keyboard moves.

**Hand legend** (bottom right, beside the keyboard): click a hand, or press 1–3, to choose which hand you practise. The left hand reads the bass clef, the right hand the treble clef, and both hands the grand staff. Changing hands mid-session restarts the session with that hand's cards. The fingertips use the finger colours (thumb = 1 … little finger = 5), the same colours used for fingering on the keyboard and the staff; numbers on the fingertips can be turned off in Settings.

### Library

| Key | Action |
| --- | --- |
| / | Search: "F#m7", "Bb maj7 1st inv", "C/E", "D dorian", "add9", "half diminished" |
| ↑ / ↓ | Previous / next result |
| H | Hear it: a chord as a block, a scale up and down |
| A | Hear a chord as an arpeggio |
| Space | Practise now (free practice with just this item) |
| R | Add to / remove from review |
| 1 / 2 / 3 | Left / right / both hands |
| Esc | Clear the search |

- **Contents:** 15 chord qualities with every inversion (major, minor, diminished, augmented, sus2, sus4, 6, m6, 7, maj7, m7, m7♭5, dim7, add9, 9) and 15 scale types (major, natural/harmonic/melodic minor, the seven modes, major and minor pentatonic, blues, chromatic). That's 947 items, generated with tonal.
- **Spelling:** roots use key spelling, with both spellings offered where both are common (C♯/D♭ and F♯/G♭ major, D♯/E♭ minor). Chromatic scales are spelled with sharps (flats from flat tonics). The blues ♭5 is written ♯4 where it would need a double flat.
- **Filters:** type, chord quality, inversion, scale type, root, hand and scale octaves. Search works within the filters; if they hide everything, the list offers to clear them.
- **Detail panel:** the name, the formula as degrees (1–♭3–5), the notes, a grand staff sized to the panel, and the item's keys marked on the keyboard. Fingering is shown in the finger colours on the keys; scales also show it above (right hand) or below (left hand) each note. Chord fingering stays on the keys, since numbers stacked over a chord are too small to read.
- **Review:** whether the item is in review for the current hand, and when it's next due. "Remove from review" keeps the card's history, so adding it again picks up where it left off.
- **Play along:** play the item on your keyboard and a quiet tick appears. Nothing is scored.
- **Decks** (in the sidebar) are saved filters.
  - Save the current filters as a deck, rename it, point it at the current filters again, or delete it. Click a deck to show it.
  - Each deck shows its progress (items · in review · due) and can add all its items to review or be practised freely.
  - Starter decks are added on first run (major triads in C/G/F/D, minor triads in A/E/D, dominant 7ths, minor 7ths in flat keys, major scales with sharps / flats, harmonic minor scales). None of them go into review until you ask.

**Fingering** (`src/core/fingerings.ts`, stored as data so songs can reuse it):
- **Scales:** all 12 major and the natural/harmonic/melodic minor scales, both hands, one or two octaves, using the usual published fingerings (including the black-key-start exceptions). Also the chromatic scale.
- **No fingering:** modes, pentatonics and blues have no standard fingering, so none is shown (ionian and aeolian use major and natural minor).
- **Triads:** RH 1-3-5 (first inversion 1-2-5); LH 5-3-1 (second inversion 5-2-1).
- **Four-note chords:** RH 1-2-3-5 or 1-2-4-5, and LH 5-3-2-1 or 5-4-2-1, depending on where the second falls.
- **Ninths:** all five fingers.
- **F** hides fingering everywhere.

**Settings**: MIDI device (automatic by default; it skips the KeyLab's DAW/"MIDIIN2" port), hand (same as the legend), range per clef, ledger lines, accidentals, new notes/chords/scales per day, chord staff, scale direction, theme (system/light/dark), fingering, and JSON export/import of all data (cards, reviews, attempts, decks, settings). Import merges by record, and the newer change wins.

## Controller buttons, pads and knobs (MIDI learn)

**Settings → Controls** maps controls on your controller to app actions. Click **Learn**, then press a pad or button or turn a knob; **Esc** cancels. Each row shows the learned control, with **Re-learn** and **Clear**. If a control was already mapped to another action, it moves to the new one and a warning says so.

- **Ports:** the app listens on every MIDI port of the connected device, including the KeyLab's DAW port ("MIDIIN2 …") where the transport buttons send Mackie Control notes. Only the keys port plays notes. Messages from other ports never make a sound.
- **What can be learned:** note-on pads, CC buttons (value above 63 is a press; only the press triggers), Mackie transport buttons, and HUI buttons (zone + port). Piano keys can't be learned. That means notes from the keys port within the keyboard's range, except on channel 10 where pads usually send. The sustain pedal can't be learned either.
- **Mapped controls only run actions:** they never also play a note or count as a drill answer.
- **Actions:** Play area, Study area, Library, Start/pause, Restart card, Skip/next, Previous, Hear answer, Toggle visualiser, Toggle fingering, Left/Right/Both hands, Zoom in/out, Settings and Back. A mapped control does what the matching key does on the current screen; where that key does nothing, so does the control.
- **Knobs:** *Keyboard zoom (knob)* takes a knob. Its encoding (absolute, or one of three relative styles) is guessed from the first few values while you turn it. You can change it in the row if the guess is wrong. Tempo will be added here later.
- **Saving:** mappings are stored in settings and included in the JSON export. When there's room, the hint bar shows the mapped control next to each key. The hint bar never clips: when space is short it drops the mapped controls, then the less important hints, then the descriptions (keys only, with the description as a tooltip).

## Offline and updates

The service worker precaches the hashed JS and CSS (which includes VexFlow's music font), the Chillax variable font, the icon and the manifest: 6 entries, about 940 KiB. Source maps aren't built.

- **The page:** `index.html` is fetched network-first with a 3-second timeout and falls back to the cached copy offline, so a new deploy is picked up as soon as you're online.
- **Piano samples:** smplr's Splendid Grand Piano, from `smpldsnds.github.io`. They live in their own cache-first cache (`piano-samples`), filled as they load. App updates never clear it, so after one online session the app works fully offline.
- **Updates:** a new version installs in the background and waits. A quiet "Update available — Reload" toast appears; press **U** or click Reload to switch. If the update is found within 10 seconds of opening the app and no drill is running, it's applied straight away. An open app checks for updates hourly and whenever it comes back to the foreground. Old precaches are cleaned up.
- **Your data is safe:** IndexedDB (cards, reviews, settings) is never touched by an update. The app also asks the browser to keep its storage persistent.
- **Version:** shown under Settings → Data (the build time), so you can tell when an update has landed.

To try the production build and its service worker locally:

```bash
npm run build && npm run preview
```

## Deploying to GitHub Pages

The workflow in `.github/workflows/deploy.yml` tests, builds and deploys on every push to `main`.

1. In the repository on GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to `main` (or run the workflow manually from the Actions tab).
3. The app is served at `https://<user>.github.io/piano-trainer/`.

Vite's `base` is set to `/piano-trainer/` in `vite.config.ts`. If the repository is renamed, change `BASE` there.

## Project layout

```
src/
  core/          UI-agnostic services
    midi.ts        Web MIDI: auto-connect, hot-plug, all ports of the device, note/CC events, status
    controls.ts    MIDI learn: actions, learned controls, HUI and knob decoding
    audio.ts       smplr piano, velocity, sustain pedal, AudioContext resume
    notation.ts    VexFlow drawing: notes and chords on treble, bass, grand staff
    scheduler.ts   ts-fsrs wrapper, session queue
    grading.ts     grading thresholds for notes, chords and scales (one config)
    storage.ts     the only IndexedDB module (cards, reviews, settings, attempts, decks, export/import)
    chords.ts      chord qualities, roots, spelling, inversions, formulas, voicings
    scales.ts      scale types, tonics, spelling, played sequences
    fingerings.ts  standard fingerings as data (scales, chords, both hands)
    fingering.ts   finger colours 1–5 and hand markers
    pitch.ts       note names, MIDI numbers, ledger lines
    settings.ts    settings shape and defaults
  modules/notes/ note cards, today's plan, free practice selection
  modules/drill/ the drill (one card at a time), tasks for notes/chords/scales, chord/scale checking, sources
  modules/library/ catalog and search, Library view, decks, review status
  modules/play/  Play area: live staff and chord readout, chord detection, visualiser
  ui/            header, keyboard, hand legend, staff panel, Today, settings, hotkeys, app shell
  assets/        hand-right.svg (modified Vadivam "hand" icon)
  styles/        tokens.css (all design tokens), base.css, components.css
build/vadivam.ts Vite plugin that inlines the Vadivam icons listed in src/ui/icon-list.ts
```

Every stored record has a UUID `id` and an `updatedAt` timestamp so sync can be added later. Stores: `cards`, `reviews` (FSRS reviews), `settings`, `attempts` (free practice; added in database version 2) and `decks` (version 3). Each upgrade only creates what an older database is missing.

## Design

Third-party licences (including the Vadivam icons and the modified hand icon in `src/assets/hand-right.svg`) are listed in `THIRD_PARTY_NOTICES.md`.

Visual rules come from `docs/design-system.md`, adapted for an app: Chillax (weights 500–700) for UI text, with accidentals (♯ ♭ ♮ 𝄪 𝄫) drawn in the Bravura music font through one helper (`src/ui/note-text.ts`) because Chillax has no such glyphs, a monospace stack with tabular figures for changing numbers, Vadivam icons only, achromatic UI apart from correct/wrong feedback and the five finger colours. All values are CSS custom properties in `src/styles/tokens.css`; the dark theme inverts the neutral scale and follows the OS by default.
