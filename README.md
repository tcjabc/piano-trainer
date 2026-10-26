# Piano Trainer

A personal piano-practice PWA driven by a USB MIDI keyboard (built for the Arturia KeyLab Essential, works with any MIDI input). Desktop-first; runs in **Chrome or Edge** (Web MIDI). No backend and no accounts: everything is stored in the browser's IndexedDB.

The app has three areas, switched with the header tabs or **P** / **T** / **L**:

- **Play** (opens on launch): free playing. A live grand staff shows what you're holding (chords stacked), with the note names and, for three or more notes, the chord name (via tonal). Optional visualiser (V). Nothing is scored or recorded.
- **Study**: notes, chords and scales with spaced repetition (FSRS). A card appears, you play it, and FSRS decides when you see it again. There's also free practice, and **Songs** (**G**): import MIDI or MusicXML and learn them section by section with falling notes or the score. The header's due count is visible from every area.
- **Library** (**L**): every chord and scale (browse, search, hear it and play along, see its fingering, add it to review, build decks).

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
| `npm test` | Unit tests (Vitest): automatic fingering, song import (MIDI, MusicXML, a MuseScore .mxl), hand splitting, sections, wait-mode matching, timing judgement, learning path, theory notes and templating, metronome timing and tap tempo, chord recognition, spelling, scale checking, fingering, search/deck filters, grading, scheduling, storage (including database upgrades), key finding, practice stats (play counting, active time, chord counting, rankings, streaks, charts) |
| `npm run typecheck` | TypeScript only |

## Using it

### Play

| Key | Action |
| --- | --- |
| V | Visualiser on/off |
| O | Staff overlay on/off (with the visualiser) |
| N | Note names on every on-screen key |
| Q | Settings |
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
- **Songs** (the third tab, or **G** from any screen): the song list and player, described under [Songs](#songs-study--songs-g). Song sections you add to review come up in Today with the other cards.
- **The legend's hand decides which cards come up.** Left hand reads the bass clef and right the treble; chord and scale cards are made for a hand. "Both" means hands together: the chord in each hand, or the scale in parallel octaves.
- **Notes:** each note (clef + written pitch) is its own card.
  - Wrong = Again; correct in under 1 s = Easy, 1–3 s = Good, over 3 s = Hard.
  - A wrong note flashes the key you played with a ✕ and a short shake, and marks the correct key; the card waits until you play it. A right answer gets a ✓.
  - Feedback is neutral (white/grey) and told by shape, since red and green are finger colours. It's the same in drills, Library play-along and the song player; the shake is off with reduced motion.
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
- **Theory reminders** (Settings → Study, off by default): after a chord or scale card, one line on what it is, e.g. "C minor — a root, a minor third (3 semitones) and a perfect fifth (7)". It stays in view while the next card is shown, so it never holds you up.

| Key | Action |
| --- | --- |
| Space | Start / pause |
| R | Restart the current card (resets the timer) |
| → | Skip the card (it moves to the end of the session) |
| H | Hear the answer (note, chord, scale) |
| Esc | Back to Today (or wherever the drill was started) |
| Q | Settings (from Today) |
| 1 / 2 / 3 | Practise the left hand / right hand / both |
| P / T / L / S | Go to Play / Study / Library / Stats (on every screen) |
| E | Free practice |
| G | Songs (on every screen) |
| ← | Previous card, replayed as ungraded practice |
| F | Fingering on/off everywhere (keys, staff, hand legend) |
| - / = / 0 | Zoom the on-screen keyboard out / in / fit the full range |

The on-screen keys can also be clicked, which helps when no MIDI keyboard is connected.

**On-screen keyboard**: it shows the connected keyboard's keys, read from the device name (e.g. "KeyLab Essential 61" → 61 keys, C2–C7; 25/32/37/49/73/76/88-key names are recognised too). When the name doesn't say, it shows 61 keys. If the drill range goes beyond that, the view widens to include it. The zoom slider (top right of the keyboard, or - = 0) goes from fitting the full range down to about two octaves, and the level is remembered. When zoomed in, the view follows the current card's note and the keys you play. It only scrolls when a key leaves the view, and then recentres, so it doesn't jump on every note. Every C is labelled and middle C (C4) is emphasised. Zooming changes key width only, so nothing above the keyboard moves.

**Hand legend** (bottom right, beside the keyboard): click a hand, or press 1–3, to choose which hand you practise. The left hand reads the bass clef, the right hand the treble clef, and both hands the grand staff. Changing hands mid-session restarts the session with that hand's cards. The fingertips use the finger colours in rainbow order (1 thumb red, 2 orange, 3 yellow, 4 green, 5 little finger blue), the same colours used for fingering on the keyboard and the staff; numbers on the fingertips can be turned off in Settings. Each hand is outlined in its hand colour (left cyan, right magenta).

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
- **About** (under the formula, collapsible; remembered): a few lines of theory for the chord quality or scale type.
  - It covers how it's built, why it's called that and how it differs from its neighbours, how it sounds and where it's used, and a few well-known pieces it's heard in.
  - Note names are filled in for the current root: "In E♭: E♭–G–B♭", "E♭ Dorian uses the notes of D♭ major".
  - The text is in one data file, `src/data/theory.ts`, written to be edited by hand.
- **Compare** buttons (e.g. "vs minor" on a major chord, "vs natural minor" on harmonic minor) play the item and then the other one on the same root.
  - The notes that differ are marked in lime on the staff (both shown, separated by a barline) and on the keys, with a line naming them.
  - **Done**, or choosing another item, ends the comparison.
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

**Settings**: MIDI device (automatic by default; it skips the KeyLab's DAW/"MIDIIN2" port), hand (same as the legend), range per clef, ledger lines, accidentals, new notes/chords/scales per day, chord staff, scale direction, theme (system/light/dark), fingering, and JSON export/import of all data (cards, reviews, attempts, decks, settings, stats, and imported songs with their fingering edits, sections and learning progress). Import merges by record, and the newer change wins. Bundled songs aren't exported, since every device adds its own; their progress and review cards are matched to that copy.

### Songs (Study → Songs, **G**)

**Import** a song with **Import song** (**I**) or by dropping files on the list:
- **Formats:** `.mid`/`.midi` (read with @tonejs/midi), and MusicXML as `.musicxml`/`.xml` or compressed `.mxl`.
- **Storage:** songs live in IndexedDB.
- **MusicXML hands:** a two-staff piano part is split by staff (right hand on top). Separate parts go by their clef.
- **MusicXML details:** fingering, ties, chords, tempo marks, rehearsal marks and double bars are read. Repeats are played straight through.
- **MIDI hands:** when a file has exactly two tracks with notes, the lower track is the left hand. Otherwise you choose a split key (middle C by default) with a preview, a piano roll coloured by hand.
- **Bundled songs:** three public-domain pieces, arranged here for two hands with fingering on every note: *Twinkle, Twinkle, Little Star*, *Ode to Joy* (Beethoven) and *Minuet in G* (Christian Petzold). Their scores are in `src/data/songs/`.

**Continue** (at the top of the list, or **Space**) opens the song and section you last played, straight back where you were.

**The list** shows title and artist (both renamable), length, key, tempo, and progress per section (one pip per section, filling along the learning path). You can delete a song, which also deletes its progress and review cards.

**The player** (click a song):
- **Views (V, remembered):**
  - *Falling notes*: notes fall onto their keys, drawn like the Play visualiser, which shares its renderer and colour presets. They're coloured by finger where fingering is known, by hand, or with the visualiser's colours, with finger numbers and optional note names. Coloured by finger, a note is filled with its finger's colour inside a thin rim and glow in its hand's colour, so both read at once; the cores are mostly colour rather than the visualiser's near-white, so hues stay saturated. A small legend in the player says "cyan = left · magenta = right".
  - *Notation*: the score with a cursor that follows the song, drawn by OpenSheetMusicDisplay. It's MusicXML only and loads on first use.
- **The keyboard** always shows the next keys to play, with finger numbers where known, and a marker in the hand's colour (cyan left, magenta right).
- **Modes:**
  - **Wait** (the default for learning): the song stops at each step until you play its notes; a chord's notes can come in any order. Wrong notes flash and are counted, nothing more. The pass ends as soon as the last note is played.
  - **Play-along**: the song runs at tempo with the metronome, after a bar of count-in. Each note is marked on time, early, late or missed. The windows (±100 ms on time, ±250 ms a hit) are in `src/core/grading.ts`.
  - **Listen**: the app plays the chosen hands.
- **Hands:** the hand legend (1 2 3) picks the hands you play here. The choice stays with the player (it starts from Study's hand): practising a step, or changing hands here, never changes Study's hand setting. The other hand is played by the app, muted, or hidden (Options).
- **Tempo:** 25–150% (, and . change it by 5%; a learned tempo knob works too).
  - **+5% after a clean pass** raises the tempo after each clean pass of the loop, up to 100%.
- **Loops:** the current section loops. You can also set loop points with **[** (A) and **]** (B), at the current bar's beat; **\\** clears them.

**Sections and the learning path:**
- **Automatic sections:** songs are split at rehearsal marks, at double bars and repeats, or else into four-bar sections (eight-bar sections for songs over 64 bars). A pickup bar joins the first section.
- **Editing sections:** rename, split at the current bar, or merge with the next.
- **The path:** each section follows right hand slow → left hand slow → hands together slow, all in wait mode at 60%, then up to tempo in play-along, 5% faster after each clean pass until a clean pass at 100%.
  - A slow step is done after two clean passes in a row.
  - Clean means 95%+ of notes right, and in play-along also 90%+ on time.
  - Any pass that is at least as demanding as the step counts (same hands, the same mode or play-along, at least as fast).
  - **Practise this step** sets it all up.
- **Stats** per section: last and best accuracy, best tempo of a clean pass, passes and last practised.
- **Review:** **Add to review** makes the section a card in Today, with its own daily limit (Settings, default 2).
  - In a session it plays once at the step it has reached, and the pass counts towards its path.
  - **H** plays the section first (listen mode at the card's tempo), then it's your turn. Like hearing the answer on other cards, this caps the grade at Hard.
  - Grades: under 80% right is Again; a pass that isn't clean is Hard; a clean pass is Good, or Easy when perfect (wait mode) or 95%+ on time (play-along).

**Fingering:** taken from the MusicXML where present (from `<notations><technical><fingering>`, as MuseScore, Finale, Sibelius and Dorico write it). Click a falling note while stopped to set or clear its finger (1–5). It's saved with the song and written into its score, so the notation shows it too.

- **Without fingering**, notes are coloured by hand: cyan (left) and magenta (right), clear of the five finger colours. The player says so.
- **Automatic fingering** (`src/core/autofinger.ts`): when a song is imported, notes without a finger get a suggested one. This is on by default; turn it off with the checkbox in the Songs tab.
  - The player's Options can **Suggest fingering** for an existing song, or **Clear suggested fingering**.
  - Fingering from the file, and fingers you set, are never changed. Setting a suggested finger makes it yours.
  - Suggestions use the same colours, with an italic number on falling notes, dotted on the keys, and in brackets, like editorial fingering, in the score. The stored score isn't changed.
  - The scale and chord tables in `src/core/fingerings.ts` stay the source for Library drills.
- **How it works:** for each hand, dynamic programming (Viterbi) over the fingers each step could take, minimising an ergonomic cost model in the style of Parncutt et al. (1997), written from scratch.
  - It uses practical, comfortable and relaxed spans for each finger pair, and penalties for weak fingers (half Parncutt's weight), the thumb or little finger on black keys, 3 followed by 4, the same finger on another note, and hand-position changes.
  - Passing the thumb is cheapest from a finger on a black key to the thumb on a white one.
  - Chord fingers go in pitch order, about one finger per scale step apart, and nothing beyond a practical span is chosen.
  - The left hand mirrors the right.
- **How well it does:**
  - It reproduces the standard one-octave fingering of C, G, F, D and E♭ major in both hands, and B♭ major apart from its first note in the right hand.
  - On the bundled songs with their fingering removed, it agrees with the written fingering for 87% of notes: Twinkle 62% (right) and 89% (left), Ode to Joy 98% and 74%, Minuet in G 94% and 100%.
  - A song of thousands of notes takes milliseconds.

| Key | Action |
| --- | --- |
| Space | Play / pause |
| R | Restart the section (or loop) |
| ← / → | Previous / next section |
| [ / ] / \\ | Loop start (A) / end (B) / clear |
| , / . | Tempo −5% / +5% |
| W | Wait mode ↔ play-along |
| V | Falling notes ↔ notation |
| 1 / 2 / 3 | Left / right / both hands |
| Esc | Back to the song list |

### Stats (S)

Practice history, worked out when the tab opens. Nothing extra runs while you play: counters are added up in memory and saved every 15 seconds (and when the tab is hidden or closed). Nothing is logged note by note.

- **Days:** current and longest streak (a streak still stands today until the day is over), total practice time, notes played, and a calendar of the last six months shaded by practice time.
- **Songs, chords, scales:** most played, most practised, and most accurate (only with 5 plays or 200 notes). Chords count by name (any inversion or hand), scales by tonic and type.
- **Song detail:** pick a song to see its most missed bars, with **Loop** (opens the song looping that bar within its section) and **Own section** (makes the bar a section of its own); clean-tempo progress for the whole song and each section; and accuracy by hand.
- **Lately:** what you choose to practise, with recent time counting most (a 30-day half-life).
- **Keys and chords:** preferred key (songs by their key, plus major and minor scales), favourite chord (held in Play), most missed chord, and what was played instead ("Cmaj7 → C7 ×9").
- **Keys pressed:** every key pressed, anywhere in the app, as heat on a keyboard.

How it's counted:

- **Plays:** one per visit (a drill, a song opened, a visit to Play or the Library) for each thing you played. It counts at the first completed pass, or else when you leave.
- **Time:** only active time, wherever you play: Play, Today's reviews (song sections included), free practice, the Library's play-along and the song player in wait and play-along modes. A gap between key presses counts if it's 30 seconds or less, and none of a longer one; hidden-tab time never counts, and neither does time while the app plays a song to you (listen mode, or hearing a review card first with H), even if you play along. Song time goes to the day (streak, calendar and totals) and to the song and its section. Today's reviews are practice time but not chosen time.
- **Hits and misses:** every chord attempt and every scale note in drills, Study and the Library play-along. In songs, every judged note by hand, with misses per bar; a wrong key counts against its bar but neither hand.
- **Play:** a chord counts once it's held for 300 ms, and again only after a release.
- **Clean tempo:** clean passes with both hands in play-along, over a whole section or the whole song. A new record is kept each time it improves.
- **Songs' keys:** from the key signature, or found from the notes (Krumhansl-Schmuckler) when the file has none or doesn't say major or minor.

### Metronome

The metronome pill in the header works on every screen: start/stop, the tempo, and beat dots that light in time (the first beat's dot is larger). Click the tempo for a small popover with every option; Esc or a click outside closes it.

| Key | Action |
| --- | --- |
| M | Start / stop |
| , / . | Tempo −1 / +1 (with Shift: −5 / +5) |
| B | Tap tempo (the average of the last four taps; a two-second pause starts again) |
| K | Metronome options (/ is the Library's search) |

- **Tempo** 30–240 BPM. The BPM counts the beat: a quarter note in 2/4–5/4, a dotted quarter in 6/8 and 12/8, an eighth in 7/8.
- **Time signatures:** 2/4, 3/4, 4/4, 5/4, 6/8, 7/8, 12/8. The first beat is accented. 6/8 and 12/8 click the dotted-quarter beats. 7/8 is counted 2+2+3, with lighter accents on 3 and 5.
- **Subdivisions:** none, 8ths, triplets, 16ths, as quieter clicks. They are note values, so in 6/8 "8ths" gives the three eighths of each beat.
- **Sounds:** click or woodblock, synthesised (no samples), with a volume of their own, independent of the piano.
- **Count-in:** an optional bar of beats before bar 1 (the dots show it outlined).
- **Visualiser pulse:** an optional setting; the horizon line brightens briefly on each beat while the visualiser is on.
- **Reduced motion:** nothing pulses; the dots just change state.
- **Never interferes:** the metronome never touches MIDI input, the piano or grading. Its settings are remembered.

**Timing.** Clicks are scheduled on the AudioContext clock by a lookahead scheduler: a 25 ms timer schedules every click due in the next 100 ms. A busy main thread delays the scheduling, not the clicks. After a stall the scheduler looks further ahead (1.5 × the longest recent gap, up to 0.5 s), then eases back. Click times are the start time plus a whole number of click lengths, so they never drift. Tempo and subdivision changes start at the next beat; a time-signature change starts at the next bar.

Measured in Chrome over 30 s at 120 BPM, by detecting each click's onset in the rendered audio with an AudioWorklet:
- **Drift** was 0.
- **Jitter** between heard clicks was ±0.021 ms (one sample at 48 kHz).
- **Onset** came 0.10–0.13 ms after the scheduled time (the detector's threshold).
- **Under load** (150 ms main-thread blocks every 400 ms) the results were the same.
- **Beat dots** follow the sound by about 3 ms on average, or up to the length of a block on a busy main thread. They are display only.

**API** (`metronome` in `src/core/audio.ts`; `src/core/metronome.ts`), for timed drills:
- `start({ countIn })` returns the AudioContext time of the first downbeat.
- `countIn()` starts with a bar of count-in and returns the downbeat time.
- `stop()` stops.
- `onBeat(fn)` reports beats for display.
- `on('scheduled', fn)` reports each click with its exact time, ahead of time.
- `nextBeatTime()` gives the time of the next beat.
- `toPerformanceTime(t)` converts a click time to compare with MIDI event times.

## Controller buttons, pads and knobs (MIDI learn)

**Settings → Controls** maps controls on your controller to app actions. Click **Learn**, then press a pad or button or turn a knob; **Esc** cancels. Each row shows the learned control, with **Re-learn** and **Clear**. If a control was already mapped to another action, it moves to the new one and a warning says so.

- **Ports:** the app listens on every MIDI port of the connected device, including the KeyLab's DAW port ("MIDIIN2 …") where the transport buttons send Mackie Control notes. Only the keys port plays notes. Messages from other ports never make a sound.
- **What can be learned:** note-on pads, CC buttons (value above 63 is a press; only the press triggers), Mackie transport buttons, and HUI buttons (zone + port). Piano keys can't be learned. That means notes from the keys port within the keyboard's range, except on channel 10 where pads usually send. The sustain pedal can't be learned either.
- **Mapped controls only run actions:** they never also play a note or count as a drill answer.
- **Actions:** Play area, Study area, Library, Start/pause, Restart card, Skip/next, Previous, Hear answer, Toggle visualiser, Toggle fingering, Left/Right/Both hands, Zoom in/out, Settings, Back, Metronome start/stop, Tap tempo and Tempo +1/−1, and in songs Loop A/B, Falling notes/notation and Wait/play-along. A mapped control does what the matching key does on the current screen; where that key does nothing, so does the control.
- **Knobs:** *Keyboard zoom (knob)* and *Tempo (knob)* take a knob (in a song, the tempo knob sets the song's tempo: an absolute knob spans 25–150%, a relative one moves 5% per step). The encoding (absolute, or one of three relative styles) is guessed from the first few values while you turn it. You can change it in the row if the guess is wrong. An absolute tempo knob spans 30–240 BPM; a relative one moves 1 BPM per step.
- **Saving:** mappings are stored in settings and included in the JSON export. When there's room, the hint bar shows the mapped control next to each key. The hint bar never clips: when space is short it drops the mapped controls, then the less important hints, then the descriptions (keys only, with the description as a tooltip).

## Offline and updates

The service worker precaches the hashed JS and CSS (which includes VexFlow's music font), the Chillax variable font, the icon and the manifest: 7 entries, about 2.5 MiB (OpenSheetMusicDisplay, for song scores, is its own chunk of about 1.3 MiB and is only loaded when a score is first shown). Source maps aren't built.

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
    audio.ts       smplr piano, velocity, sustain pedal, AudioContext resume; the app's metronome
    metronome.ts   metronome: tempo/meter maths, tap tempo, lookahead click scheduler, synthesised clicks
    notation.ts    VexFlow drawing: notes and chords on treble, bass, grand staff
    scheduler.ts   ts-fsrs wrapper, session queue
    grading.ts     grading thresholds for notes, chords and scales (one config)
    storage.ts     the only IndexedDB module (cards, reviews, settings, attempts, decks, songs, stats, export/import)
    key-finder.ts  a song's key: its signature, or Krumhansl-Schmuckler from the notes
    stats.ts       stats record ids, pending counts, affinity decay, the review-history backfill
    stats-recorder.ts counting practice while it happens: sessions, active time, batched saves
    stats-summary.ts what the Stats tab shows, worked out from the counters
    chords.ts      chord qualities, roots, spelling, inversions, formulas, voicings
    scales.ts      scale types, tonics, spelling, played sequences
    fingerings.ts  standard fingerings as data (scales, chords, both hands)
    fingering.ts   finger colours 1–5 and hand markers
    pitch.ts       note names, MIDI numbers, ledger lines
    settings.ts    settings shape and defaults
    song.ts        songs in beats with a tempo map, steps, measures, keys
    song-midi.ts   MIDI import and hand splitting
    song-musicxml.ts MusicXML/.mxl import; writing fingering back into the score
    song-sections.ts automatic sections, split and merge
    song-judge.ts  wait-mode step matching, play-along timing judgement
    song-learning.ts learning path and progressive tempo
    autofinger.ts  automatic fingering for songs (Viterbi over an ergonomic cost model)
  data/theory.ts theory notes for each chord quality and scale type (hand-editable)
  data/songs/    the bundled public-domain songs (MusicXML)
  modules/notes/ note cards, today's plan, free practice selection
  modules/drill/ the drill (one card at a time), tasks for notes/chords/scales, chord/scale checking, sources
  modules/library/ catalog and search, Library view, decks, review status, theory templating and compare
  modules/play/  Play area: live staff and chord readout, chord detection, visualiser (and the glow renderer it shares)
  modules/songs/ Songs tab, import, the player (engine, falling notes, notation), song review cards and song stats
  modules/stats/ the Stats tab and its charts (inline SVG)
  ui/            header (with the metronome pill), keyboard, hand legend, staff panel, Today, settings, hotkeys, app shell
  assets/        hand-right.svg (modified Vadivam "hand" icon)
  styles/        tokens.css (all design tokens), base.css, components.css
build/vadivam.ts Vite plugin that inlines the Vadivam icons listed in src/ui/icon-list.ts
```

Every stored record has a UUID `id` and an `updatedAt` timestamp so sync can be added later. Stores: `cards`, `reviews` (FSRS reviews), `settings`, `attempts` (free practice; added in database version 2), `decks` (version 3), `songs` and `songProgress` (version 4), and the stats counters (version 5): `itemStats`, `dailyStats`, `chordPlayCounts`, `confusions`, `keyHits`, `songMeasureMisses` and `songTempoBests`. Each upgrade only creates what an older database is missing; version 5 also finds the key of stored songs and counts chord and scale hits and misses from their review history.

## Design

Third-party licences (including the Vadivam icons and the modified hand icon in `src/assets/hand-right.svg`) are listed in `THIRD_PARTY_NOTICES.md`.

Visual rules come from `docs/design-system.md`, adapted for an app: Chillax (weights 500–700) for UI text, with accidentals (♯ ♭ ♮ 𝄪 𝄫) drawn in the Bravura music font through one helper (`src/ui/note-text.ts`) because Chillax has no such glyphs, a monospace stack with tabular figures for changing numbers, Vadivam icons only, achromatic UI apart from the five finger colours (red, orange, yellow, green, blue) and the two hand colours (cyan, magenta); correct/wrong feedback is neutral and told by ✓/✕ and a shake. All values are CSS custom properties in `src/styles/tokens.css`; the dark theme inverts the neutral scale and follows the OS by default.
