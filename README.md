# Piano Trainer

A personal piano-practice PWA driven by a USB MIDI keyboard (built for the Arturia KeyLab Essential, works with any MIDI input). Desktop-first; runs in **Chrome or Edge** (Web MIDI). No backend and no accounts: everything is stored in the browser's IndexedDB.

The app has two areas, switched with the header tabs or **P** / **T**:

- **Play** (opens on launch): free playing. A live grand staff shows what you're holding (chords stacked), with the note names and, for three or more notes, the chord name (via tonal). Optional visualiser (V). Nothing is scored or recorded.
- **Study**: note reading. A note appears on the staff, you play it, and spaced repetition (FSRS) decides when you see it again. The header's due count is visible from both areas.

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
| `npm test` | Unit tests (Vitest): grading, card generation, scheduling, storage export/import |
| `npm run typecheck` | TypeScript only |

## Using it

### Play

| Key | Action |
| --- | --- |
| V | Visualiser on/off |
| N | Note names on every on-screen key |
| S | Settings |
| - / = / 0 | Zoom the keyboard out / in / fit |

The **visualiser** sits between the staff and the keyboard. A glowing bar rises from each key you press and grows while you hold it. When you let go it drifts upward and fades. The sustain pedal keeps bars held. Velocity makes bars slightly brighter and wider. Colours (Settings → Play): rainbow by pitch class (C red … B violet), a single colour, or finger colours (once fingering exists; until then the single colour). Sparks on note-on can be turned off. With the system's reduced-motion setting, bars fade in place and there are no sparks. It's the only place in the app that uses strong colour.

### Study

- **Today** shows how many cards are due and roughly how long they take. Press **Space** (or Start) to go through them back to back. When nothing is due, Space starts **Practise ahead** (a few unseen cards plus the soonest-due ones).
- Each note (clef + written pitch) is its own card. Grading is automatic: wrong = Again; correct in under 1 s = Easy, 1–3 s = Good, over 3 s = Hard. Hearing the note first (H) caps the grade at Hard.
- A wrong note flashes red on the key you played and marks the correct key; the card waits until you play it. Failed cards come back later in the same session.
- New cards are introduced up to a daily limit (default 10), starting at middle C and working outwards. C♯ and D♭ are separate cards (different staff positions) answered by the same key.

| Key | Action |
| --- | --- |
| Space | Start / pause |
| R | Restart the current card (resets the timer) |
| → | Skip the card (it moves to the end of the session) |
| H | Hear the correct note |
| Esc | Back to Today |
| S | Settings (from Today) |
| 1 / 2 / 3 | Practise the left hand / right hand / both |
| P / T | Go to Play / Study (on every screen) |
| ← | Previous card, replayed as ungraded practice |
| F | Fingertip numbers on/off (fingering) |
| - / = / 0 | Zoom the on-screen keyboard out / in / fit the full range |

The on-screen keys can also be clicked, which helps when no MIDI keyboard is connected.

**On-screen keyboard**: it shows the connected keyboard's keys, read from the device name (e.g. "KeyLab Essential 61" → 61 keys, C2–C7; 25/32/37/49/73/76/88-key names are recognised too). When the name doesn't say, it shows 61 keys. If the drill range goes beyond that, the view widens to include it. The zoom slider (top right of the keyboard, or - = 0) goes from fitting the full range down to about two octaves, and the level is remembered. When zoomed in, the view follows the current card's note and the keys you play. It only scrolls when a key leaves the view, and then recentres, so it doesn't jump on every note. Every C is labelled and middle C (C4) is emphasised. Zooming changes key width only, so nothing above the keyboard moves.

**Hand legend** (bottom right, beside the keyboard): click a hand, or press 1–3, to choose which hand you practise. The left hand reads the bass clef, the right hand the treble clef, and both hands the grand staff. Changing hands mid-session restarts the session with that hand's cards. The fingertips use the finger colours (thumb = 1 … little finger = 5), the same colours used for fingering on the keyboard and the staff; numbers on the fingertips can be turned off in Settings.

**Settings**: MIDI device (automatic by default; it skips the KeyLab's DAW/"MIDIIN2" port), hand (same as the legend), range per clef, ledger lines, accidentals, new cards per day, theme (system/light/dark), finger numbers, and JSON export/import of all data. Import merges by record, and the newer change wins.

## Controller buttons, pads and knobs (MIDI learn)

**Settings → Controls** maps controls on your controller to app actions. Click **Learn**, then press a pad or button or turn a knob; **Esc** cancels. Each row shows the learned control, with **Re-learn** and **Clear**. If a control was already mapped to another action, it moves to the new one and a warning says so.

- **Ports:** the app listens on every MIDI port of the connected device, including the KeyLab's DAW port ("MIDIIN2 …") where the transport buttons send Mackie Control notes. Only the keys port plays notes. Messages from other ports never make a sound.
- **What can be learned:** note-on pads, CC buttons (value above 63 is a press; only the press triggers), Mackie transport buttons, and HUI buttons (zone + port). Piano keys can't be learned. That means notes from the keys port within the keyboard's range, except on channel 10 where pads usually send. The sustain pedal can't be learned either.
- **Mapped controls only run actions:** they never also play a note or count as a drill answer.
- **Actions:** Play area, Study area, Start/pause, Restart card, Skip/next, Previous, Hear answer, Toggle visualiser, Toggle fingering, Left/Right/Both hands, Zoom in/out, Settings and Back. A mapped control does what the matching key does on the current screen; where that key does nothing, so does the control.
- **Knobs:** *Keyboard zoom (knob)* takes a knob. Its encoding (absolute, or one of three relative styles) is guessed from the first few values while you turn it. You can change it in the row if the guess is wrong. Tempo will be added here later.
- **Saving:** mappings are stored in settings and included in the JSON export. When there's room, the hint bar shows the mapped control next to each key.

## Offline

The app shell, fonts, icons and the VexFlow music font are precached by the service worker. The piano samples (smplr's Splendid Grand Piano, from `smpldsnds.github.io`) are cached as they load, so the app works offline after one online session. The app also asks the browser to keep its storage persistent.

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
    scheduler.ts   ts-fsrs wrapper, auto-grading, session queue
    storage.ts     the only IndexedDB module (cards, reviews, settings, export/import)
    fingering.ts   finger colours 1–5 and hand markers
    pitch.ts       note names, MIDI numbers, ledger lines
    settings.ts    settings shape and defaults
  modules/notes/ the note-drill module (card set, deck planning, drill controller)
  modules/play/  Play area: live staff and chord readout, chord detection, visualiser
  ui/            header, keyboard, hand legend, staff panel, Today, settings, hotkeys, app shell
  assets/        hand-right.svg (modified Vadivam "hand" icon)
  styles/        tokens.css (all design tokens), base.css, components.css
build/vadivam.ts Vite plugin that inlines the Vadivam icons listed in src/ui/icon-list.ts
```

Every stored record has a UUID `id` and an `updatedAt` timestamp so sync can be added later.

## Design

Third-party licences (including the Vadivam icons and the modified hand icon in `src/assets/hand-right.svg`) are listed in `THIRD_PARTY_NOTICES.md`.

Visual rules come from `docs/design-system.md`, adapted for an app: Chillax (weights 500–700) for UI text, a monospace stack with tabular figures for changing numbers, Vadivam icons only, achromatic UI apart from correct/wrong feedback and the five finger colours. All values are CSS custom properties in `src/styles/tokens.css`; the dark theme inverts the neutral scale and follows the OS by default.
