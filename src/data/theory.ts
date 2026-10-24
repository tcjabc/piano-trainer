/**
 * Theory notes for the Library: one entry per chord quality and per scale
 * type (not per root). Edit freely; this file is only data.
 *
 * Placeholders, filled in for the item being shown:
 *   {root}       the root or tonic, e.g. "E♭"
 *   {notes}      its notes, e.g. "E♭–G–B♭"
 *   {parent}     modes: the major key whose notes the mode uses ("E♭ Dorian uses the notes of {parent} major" → D♭)
 *   {relative}   major ↔ minor: the relative key (C major → A minor; A minor → C major)
 *   {resolvesTo} the chord a fifth below, where a dominant seventh leads (G7 → C)
 *
 * Write note names and degrees plainly ("Eb", "♭3", "♯11"); accidentals are
 * drawn as music glyphs. Examples in `heardIn` must be widely and reliably
 * cited for the chord or scale; leave the list empty rather than guess.
 */
import type { ChordQuality } from '../core/chords';
import type { ScaleType } from '../core/scales';

export interface HeardIn {
  title: string;
  artist: string;
}

export interface Compare<T extends string> {
  /** The quality or scale type to compare with, on the same root. */
  with: T;
  label: string;
}

export interface TheoryEntry<T extends string> {
  /** One line, for the reminder after a Study card. */
  short: string;
  /** What it is: how it's built. */
  built: string;
  /** Why it's called that / what makes it different from its neighbours. */
  name: string;
  /** How it sounds and where it's used. */
  sound: string;
  heardIn: HeardIn[];
  compare: Compare<T>[];
}

export const CHORD_THEORY: Record<ChordQuality, TheoryEntry<ChordQuality>> = {
  M: {
    short: 'a root, a major third (4 semitones) and a perfect fifth (7).',
    built: 'A major triad is three notes: the root, a major third (4 semitones up) and a perfect fifth (7 semitones up). In {root}: {notes}.',
    name: 'It’s called major because of its major third, the interval that sets it apart from minor. Lower the third by one semitone and you have the minor chord.',
    sound: 'Bright, stable and settled. It’s the most common chord in Western music and the home chord of every major key.',
    heardIn: [],
    compare: [{ with: 'm', label: 'vs minor' }, { with: 'aug', label: 'vs augmented' }],
  },
  m: {
    short: 'a root, a minor third (3 semitones) and a perfect fifth (7).',
    built: 'A minor triad is the root, a minor third (3 semitones up) and a perfect fifth (7 semitones up). In {root}: {notes}.',
    name: 'It’s named after its minor third. It’s a major triad with the third lowered by one semitone; the root and fifth stay put.',
    sound: 'Darker and more wistful than major, but just as stable. It’s the home chord of a minor key, and the ii, iii and vi chords of a major key.',
    heardIn: [],
    compare: [{ with: 'M', label: 'vs major' }, { with: 'dim', label: 'vs diminished' }],
  },
  dim: {
    short: 'two minor thirds: a root, a minor third (3) and a diminished fifth (6).',
    built: 'A diminished triad is the root, a minor third (3 semitones) and a diminished fifth (6 semitones): two minor thirds stacked. In {root}: {notes}.',
    name: 'It’s a minor triad with the fifth lowered by a semitone, so the fifth is “diminished”. That fifth is a tritone above the root.',
    sound: 'Tense and unstable; it wants to move on. In a major key it sits on the 7th degree and usually leads to the tonic.',
    heardIn: [],
    compare: [{ with: 'm', label: 'vs minor' }],
  },
  aug: {
    short: 'two major thirds: a root, a major third (4) and an augmented fifth (8).',
    built: 'An augmented triad is the root, a major third (4 semitones) and an augmented fifth (8 semitones): two major thirds stacked. In {root}: {notes}.',
    name: 'It’s a major triad with the fifth raised by a semitone, so the fifth is “augmented”. It splits the octave into three equal major thirds, so every inversion sounds alike.',
    sound: 'Dreamy, unresolved and slightly eerie. It’s often a passing chord that pushes towards the next one.',
    heardIn: [{ title: 'Oh! Darling', artist: 'The Beatles' }],
    compare: [{ with: 'M', label: 'vs major' }],
  },
  sus2: {
    short: 'a root, a major second (2) and a perfect fifth (7), with no third.',
    built: 'A sus2 chord is the root, a major second (2 semitones) and a perfect fifth (7 semitones). In {root}: {notes}.',
    name: '“Sus” is short for suspended: the third is replaced by the second, so the chord is neither major nor minor.',
    sound: 'Open, airy and undecided. Common in pop and rock, either resolving to the major or minor chord or left hanging for its open sound.',
    heardIn: [],
    compare: [{ with: 'M', label: 'vs major' }, { with: 'sus4', label: 'vs sus4' }],
  },
  sus4: {
    short: 'a root, a perfect fourth (5) and a perfect fifth (7), with no third.',
    built: 'A sus4 chord is the root, a perfect fourth (5 semitones) and a perfect fifth (7 semitones). In {root}: {notes}.',
    name: 'The third is “suspended” up to the fourth. In classical harmony the fourth was held over from the previous chord and then fell to the third.',
    sound: 'Bright but tense, leaning towards the major chord. Moving between sus4 and major is a classic rock guitar sound.',
    heardIn: [{ title: 'Pinball Wizard', artist: 'The Who' }],
    compare: [{ with: 'M', label: 'vs major' }, { with: 'sus2', label: 'vs sus2' }],
  },
  '6': {
    short: 'a major triad plus a major sixth (9 semitones above the root).',
    built: 'A major sixth chord is a major triad with an added major sixth (9 semitones above the root). In {root}: {notes}.',
    name: 'It’s named after the added sixth. Unlike a seventh chord it doesn’t need to resolve: it’s a richer version of the major chord.',
    sound: 'Sweet and a little old-fashioned: swing, big band and 1950s pop. It often stands in for the major chord at the end of a song.',
    heardIn: [{ title: 'She Loves You', artist: 'The Beatles' }],
    compare: [{ with: 'M', label: 'vs major' }, { with: 'maj7', label: 'vs maj7' }],
  },
  m6: {
    short: 'a minor triad plus a major sixth (9 semitones above the root).',
    built: 'A minor sixth chord is a minor triad with an added major sixth (9 semitones above the root). In {root}: {notes}.',
    name: 'The “m” describes the triad; the added sixth is a major sixth. That bright sixth against the minor third gives the chord its character.',
    sound: 'Bittersweet and mysterious. It’s often the tonic chord in jazz, gypsy jazz and film-noir music.',
    heardIn: [],
    compare: [{ with: 'm', label: 'vs minor' }, { with: 'm7', label: 'vs m7' }],
  },
  '7': {
    short: 'a major triad plus a minor seventh (10 semitones); it pulls to the chord a fifth below.',
    built: 'A dominant seventh chord is a major triad with a minor seventh on top (10 semitones above the root). In {root}: {notes}.',
    name: 'It’s called dominant because it occurs naturally on the 5th degree of a major key, the dominant. Its major third and minor seventh form a tritone, which wants to resolve.',
    sound: 'Bluesy and restless, with a strong pull to the chord a fifth below: {root}7 leads to {resolvesTo}. It’s the backbone of the 12-bar blues.',
    heardIn: [],
    compare: [{ with: 'maj7', label: 'vs maj7' }, { with: 'm7', label: 'vs m7' }],
  },
  maj7: {
    short: 'a major triad plus a major seventh (11 semitones, a semitone below the octave).',
    built: 'A major seventh chord is a major triad with a major seventh on top (11 semitones above the root). In {root}: {notes}.',
    name: 'The seventh is a major seventh, just a semitone below the octave. That’s the difference from the dominant seventh, whose seventh is a semitone lower.',
    sound: 'Soft, lush and jazzy; settled rather than restless. Common in jazz, bossa nova, soul and soft rock.',
    heardIn: [{ title: 'Something', artist: 'The Beatles' }],
    compare: [{ with: '7', label: 'vs dominant 7th' }, { with: 'M', label: 'vs major' }],
  },
  m7: {
    short: 'a minor triad plus a minor seventh (10 semitones).',
    built: 'A minor seventh chord is a minor triad with a minor seventh on top (10 semitones above the root). In {root}: {notes}.',
    name: 'Both the third and the seventh are minor. Compared with the dominant seventh, only the third is lower.',
    sound: 'Mellow and smooth. It’s the ii chord in the jazz ii–V–I, and common in soul, funk and R&B.',
    heardIn: [],
    compare: [{ with: '7', label: 'vs dominant 7th' }, { with: 'm7b5', label: 'vs half-diminished' }],
  },
  m7b5: {
    short: 'a diminished triad plus a minor seventh (a minor seventh chord with a ♭5).',
    built: 'A half-diminished chord is a diminished triad with a minor seventh on top (10 semitones above the root). In {root}: {notes}.',
    name: 'It’s only “half” diminished: the triad is diminished but the seventh is minor, a semitone above the diminished seventh of a dim7. It’s also written m7♭5, a minor seventh chord with a lowered fifth.',
    sound: 'Dark and yearning. It’s the ii chord of a minor key, leading to V and then i, and a staple of jazz standards.',
    heardIn: [{ title: 'Stella by Starlight', artist: 'Victor Young' }],
    compare: [{ with: 'm7', label: 'vs m7' }, { with: 'dim7', label: 'vs dim7' }],
  },
  dim7: {
    short: 'three stacked minor thirds: root, ♭3, ♭5 and a diminished seventh (9 semitones).',
    built: 'A diminished seventh chord stacks three minor thirds: the root, a minor third (3), a diminished fifth (6) and a diminished seventh (9 semitones). In {root}: {notes}.',
    name: 'Both the triad and the seventh are diminished. It splits the octave into four equal parts, so there are only three different dim7 chords, each of which can be named after any of its notes.',
    sound: 'Very tense and dramatic, the classic silent-film villain chord. It can resolve in several directions, which makes it handy for changing key.',
    heardIn: [],
    compare: [{ with: 'm7b5', label: 'vs half-diminished' }, { with: 'dim', label: 'vs diminished triad' }],
  },
  add9: {
    short: 'a major triad plus a ninth (a second, an octave up), with no seventh.',
    built: 'An add9 chord is a major triad with an added ninth: a major second, an octave higher (14 semitones above the root). In {root}: {notes}.',
    name: 'The ninth is simply added, with no seventh; that’s the difference from a ninth chord. Unlike sus2, it keeps the third.',
    sound: 'Bright and shimmering: a major chord with extra sparkle. Very common in pop, rock and singer-songwriter music.',
    heardIn: [],
    compare: [{ with: 'M', label: 'vs major' }, { with: 'sus2', label: 'vs sus2' }],
  },
  '9': {
    short: 'a dominant seventh plus a ninth (14 semitones above the root).',
    built: 'A dominant ninth chord is a dominant seventh with a ninth on top (14 semitones above the root). In {root}: {notes}.',
    name: 'It extends the dominant seventh by one more third. Compared with add9, it includes the minor seventh.',
    sound: 'Rich and funky, with the same pull as the dominant seventh: {root}9 leads to {resolvesTo}. A favourite in funk, soul and blues.',
    heardIn: [],
    compare: [{ with: '7', label: 'vs dominant 7th' }, { with: 'add9', label: 'vs add9' }],
  },
};

export const SCALE_THEORY: Record<ScaleType, TheoryEntry<ScaleType>> = {
  major: {
    short: 'whole, whole, half, whole, whole, whole, half.',
    built: 'Seven notes with the steps whole, whole, half, whole, whole, whole, half (W–W–H–W–W–W–H). In {root}: {notes}.',
    name: 'It’s major because its 3rd is a major third above the tonic. The other scales here are easiest to understand by how they differ from this one.',
    sound: 'Bright, stable and familiar: the do-re-mi of nursery rhymes and most pop songs. {root} major shares its notes with {relative} minor.',
    heardIn: [{ title: 'Do-Re-Mi', artist: 'Rodgers and Hammerstein' }],
    compare: [{ with: 'natural minor', label: 'vs natural minor' }, { with: 'mixolydian', label: 'vs Mixolydian' }],
  },
  'natural minor': {
    short: 'major with a lowered 3rd, 6th and 7th.',
    built: 'Steps W–H–W–W–H–W–W. Compared with major, the 3rd, 6th and 7th are each a semitone lower. In {root}: {notes}.',
    name: '“Natural” because nothing is altered: it uses exactly the notes of its relative major. {root} minor uses the notes of {relative} major. It’s the same scale as the Aeolian mode.',
    sound: 'Sad, serious or reflective; the basis of most minor-key melodies.',
    heardIn: [],
    compare: [{ with: 'major', label: 'vs major' }, { with: 'harmonic minor', label: 'vs harmonic minor' }],
  },
  'harmonic minor': {
    short: 'natural minor with a raised 7th.',
    built: 'Natural minor with the 7th raised by a semitone. That leaves a gap of three semitones between the 6th and 7th. In {root}: {notes}.',
    name: 'The raised 7th (the leading note) makes the chord on the 5th degree major, giving minor-key harmony a strong pull home; hence “harmonic”.',
    sound: 'Exotic and dramatic, thanks to that wide step. Heard in classical music, Middle Eastern and Eastern European styles, and neoclassical metal.',
    heardIn: [],
    compare: [{ with: 'natural minor', label: 'vs natural minor' }, { with: 'melodic minor', label: 'vs melodic minor' }],
  },
  'melodic minor': {
    short: 'natural minor with a raised 6th and 7th going up.',
    built: 'Natural minor with the 6th and 7th raised going up (W–H–W–W–W–W–H); coming down, it traditionally returns to natural minor. Ascending in {root}: {notes}.',
    name: 'Raising the 6th as well as the 7th smooths out the awkward gap in harmonic minor, so melodies flow more easily; hence “melodic”. Going up, it’s a major scale with a minor 3rd.',
    sound: 'Minor at the bottom and major at the top: bittersweet and smooth. In jazz it’s played the same way up and down.',
    heardIn: [],
    compare: [{ with: 'natural minor', label: 'vs natural minor' }, { with: 'harmonic minor', label: 'vs harmonic minor' }],
  },
  ionian: {
    short: 'the major scale under its modal name.',
    built: 'The first mode: the same notes and steps as the major scale, W–W–H–W–W–W–H. In {root}: {notes}.',
    name: 'The modes take their names from ancient Greek regions, by way of medieval church music. Ionian is simply the major scale.',
    sound: 'Bright and stable. Thinking of it as a mode helps when comparing it with Lydian (raised 4th) and Mixolydian (lowered 7th).',
    heardIn: [],
    compare: [{ with: 'lydian', label: 'vs Lydian' }, { with: 'mixolydian', label: 'vs Mixolydian' }],
  },
  dorian: {
    short: 'natural minor with a raised 6th.',
    built: 'The second mode of the major scale: W–H–W–W–W–H–W. In {root}: {notes}.',
    name: 'It’s natural minor with a raised 6th. {root} Dorian uses the notes of {parent} major, starting on its second note.',
    sound: 'Minor, but hopeful rather than gloomy. Common in funk, jazz, folk and rock.',
    heardIn: [
      { title: 'Scarborough Fair', artist: 'Simon & Garfunkel' },
      { title: 'Oye Como Va', artist: 'Santana' },
      { title: 'So What', artist: 'Miles Davis' },
    ],
    compare: [{ with: 'natural minor', label: 'vs natural minor' }],
  },
  phrygian: {
    short: 'natural minor with a lowered 2nd.',
    built: 'The third mode: H–W–W–W–H–W–W. In {root}: {notes}.',
    name: 'It’s natural minor with a lowered 2nd; the semitone straight up from the tonic is its signature. {root} Phrygian uses the notes of {parent} major.',
    sound: 'Dark, tense and Spanish-sounding. Heard in flamenco and in heavy metal.',
    heardIn: [],
    compare: [{ with: 'natural minor', label: 'vs natural minor' }],
  },
  lydian: {
    short: 'major with a raised 4th.',
    built: 'The fourth mode: W–W–W–H–W–W–H. In {root}: {notes}.',
    name: 'It’s the major scale with a raised 4th, a tritone above the tonic. {root} Lydian uses the notes of {parent} major.',
    sound: 'Bright, floating and dreamy. Film and TV composers use it for wonder and magic.',
    heardIn: [{ title: 'The Simpsons Theme', artist: 'Danny Elfman' }],
    compare: [{ with: 'major', label: 'vs major' }],
  },
  mixolydian: {
    short: 'major with a lowered 7th.',
    built: 'The fifth mode: W–W–H–W–W–H–W. In {root}: {notes}.',
    name: 'It’s the major scale with a lowered 7th, so the chord on its tonic is a dominant seventh. {root} Mixolydian uses the notes of {parent} major.',
    sound: 'Bright but bluesy and relaxed. Common in rock, blues, folk and Celtic music.',
    heardIn: [
      { title: 'Norwegian Wood', artist: 'The Beatles' },
      { title: 'Sweet Home Alabama', artist: 'Lynyrd Skynyrd' },
    ],
    compare: [{ with: 'major', label: 'vs major' }],
  },
  aeolian: {
    short: 'the natural minor scale under its modal name.',
    built: 'The sixth mode: W–H–W–W–H–W–W. In {root}: {notes}.',
    name: 'Aeolian is the natural minor scale under its modal name. {root} Aeolian uses the notes of {parent} major.',
    sound: 'Sad and serious. Among the minor modes it sits between Dorian (brighter, raised 6th) and Phrygian (darker, lowered 2nd).',
    heardIn: [],
    compare: [{ with: 'dorian', label: 'vs Dorian' }, { with: 'phrygian', label: 'vs Phrygian' }],
  },
  locrian: {
    short: 'natural minor with a lowered 2nd and 5th.',
    built: 'The seventh mode: H–W–W–H–W–W–W. In {root}: {notes}.',
    name: 'It’s natural minor with a lowered 2nd and 5th, so the chord on its tonic is diminished and it never quite feels at home. {root} Locrian uses the notes of {parent} major.',
    sound: 'Unstable and unsettling, rarely used as a home key. It turns up in metal, and in jazz over half-diminished chords.',
    heardIn: [],
    compare: [{ with: 'phrygian', label: 'vs Phrygian' }, { with: 'natural minor', label: 'vs natural minor' }],
  },
  'major pentatonic': {
    short: 'major without its 4th and 7th: 1–2–3–5–6.',
    built: 'Five notes: the major scale without its 4th and 7th (1–2–3–5–6). In {root}: {notes}.',
    name: '“Pentatonic” means five notes. Leaving out the two notes that sit a semitone from a neighbour removes every half step, so nothing clashes.',
    sound: 'Open, cheerful and simple. Found in folk music all over the world, and in country, pop and rock solos.',
    heardIn: [
      { title: 'Amazing Grace', artist: 'traditional' },
      { title: 'Auld Lang Syne', artist: 'traditional' },
    ],
    compare: [{ with: 'major', label: 'vs major' }, { with: 'minor pentatonic', label: 'vs minor pentatonic' }],
  },
  'minor pentatonic': {
    short: 'natural minor without its 2nd and 6th: 1–♭3–4–5–♭7.',
    built: 'Five notes: the natural minor scale without its 2nd and 6th (1–♭3–4–5–♭7). In {root}: {notes}.',
    name: 'It has the same notes as the major pentatonic a minor third higher: {root} minor pentatonic uses the notes of {relative} major pentatonic. Like that scale, it has no half steps.',
    sound: 'Raw and bluesy: the first scale most rock and blues guitarists learn for soloing.',
    heardIn: [],
    compare: [{ with: 'natural minor', label: 'vs natural minor' }, { with: 'blues', label: 'vs blues' }],
  },
  blues: {
    short: 'minor pentatonic plus the “blue note”, a ♭5.',
    built: 'The minor pentatonic with one extra note, the lowered 5th (1–♭3–4–♭5–5–♭7). In {root}: {notes}.',
    name: 'The added ♭5 is the “blue note”, usually played in passing between the 4th and 5th. It gives the scale its name and its bite.',
    sound: 'Gritty and expressive: the language of blues, rock and jazz improvisation.',
    heardIn: [{ title: 'Smoke on the Water', artist: 'Deep Purple' }],
    compare: [{ with: 'minor pentatonic', label: 'vs minor pentatonic' }],
  },
  chromatic: {
    short: 'all twelve notes, a semitone apart.',
    built: 'All twelve notes, each a semitone apart. In {root}: {notes}.',
    name: 'From the Greek “chroma”, colour: the notes between the steps of a scale were heard as colouring it. It has no home note in the usual sense.',
    sound: 'Used for runs, passing notes and tension rather than as a key. Excellent finger practice.',
    heardIn: [{ title: 'Flight of the Bumblebee', artist: 'Nikolai Rimsky-Korsakov' }],
    compare: [],
  },
};
