/**
 * The stand-in portrait for a profile with no photograph, as data.
 *
 * A card without a photo showed "No photograph yet" or a lone initial, which
 * reads as a form nobody finished. A matrimony template shows a figure
 * instead: a groom for a groom, a bride for a bride. The figures are drawn
 * here once, in a 120×120 box, so the web and mobile apps render the same
 * art; each app only maps a tone onto its own theme colours. Dependency free,
 * which is what lets mobile read it from here (mobile/src/shared).
 */
export type SilhouetteVariant = 'groom' | 'bride' | 'neutral';

/**
 * Which figure a profile gets. Gender arrives as 'male' / 'female', sometimes
 * capitalised and sometimes missing; anything unrecognised gets the neutral
 * figure rather than a guess.
 */
export function silhouetteFor(gender?: string | null): SilhouetteVariant {
  const g = (gender ?? '').trim().toLowerCase();
  if (g === 'male' || g === 'm' || g === 'man' || g === 'groom') return 'groom';
  if (g === 'female' || g === 'f' || g === 'woman' || g === 'bride') return 'bride';
  return 'neutral';
}

/** Framed on the bust: the figures are drawn in 0–120 and cropped to the shoulders. */
export const SILHOUETTE_VIEWBOX = '10 12 100 108';

/**
 * A tone is a theme colour mixed into the sunken ground by `amount` (0–1).
 * Mixed rather than translucent, so overlapping shapes (a face over a veil)
 * stay flat instead of darkening where they meet.
 */
export type SilhouetteTone = 'skin' | 'robe' | 'veil' | 'accent' | 'gold';

export const SILHOUETTE_TONES: Record<SilhouetteTone, { token: 'brand' | 'gold'; amount: number }> = {
  skin: { token: 'brand', amount: 0.22 },
  robe: { token: 'brand', amount: 0.14 },
  veil: { token: 'brand', amount: 0.3 },
  accent: { token: 'brand', amount: 0.42 },
  gold: { token: 'gold', amount: 0.75 },
};

/** One shape: filled with its tone, or stroked with it when `stroke` is set. */
export interface SilhouetteShape {
  d: string;
  tone: SilhouetteTone;
  stroke?: number;
}

const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 Z`;

const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
  `M${cx - rx} ${cy} a${rx} ${ry} 0 1 0 ${2 * rx} 0 a${rx} ${ry} 0 1 0 ${-2 * rx} 0 Z`;

export const SILHOUETTES: Record<SilhouetteVariant, SilhouetteShape[]> = {
  // A sherwani with a gold bandhgala collar and buttons, under a safa with
  // a jewel and kalgi plume.
  groom: [
    { d: 'M14 120 C15 99 31 89 50 86 L70 86 C89 89 105 99 106 120 Z', tone: 'robe' },
    { d: 'M52 68 L68 68 L69 88 L51 88 Z', tone: 'skin' },
    { d: ellipse(60, 57, 14.5, 17), tone: 'skin' },
    { d: 'M49 84 C56 89 64 89 71 84 L72 91 C64 96 56 96 48 91 Z', tone: 'gold' },
    { d: 'M60 95 L60 120', tone: 'gold', stroke: 1.2 },
    { d: circle(60, 102, 1.8), tone: 'gold' },
    { d: circle(60, 111, 1.8), tone: 'gold' },
    { d: 'M43 56 C39 38 47 26 60 26 C73 26 81 38 77 56 C71 49 66 47 60 47 C54 47 49 49 43 56 Z', tone: 'accent' },
    { d: 'M45 46 C52 38 67 34 76 43', tone: 'gold', stroke: 1.3 },
    { d: 'M61 38 C60 30 64 23 71 18 C67 25 65 31 63.5 38 Z', tone: 'gold' },
    { d: circle(60, 40, 2.6), tone: 'gold' },
  ],
  // A dupatta drawn over the back of the head from the bun, a centre-parted
  // hairline with a maang tikka, jhumkas, a necklace and the saree's pallu.
  bride: [
    { d: 'M12 120 C26 90 36 72 38 52 C36 37 46 29 60 29 C74 29 84 37 82 52 C84 72 94 90 108 120 Z', tone: 'veil' },
    { d: 'M12 120 C26 90 36 72 38 52 C36 37 46 29 60 29 C74 29 84 37 82 52 C84 72 94 90 108 120', tone: 'gold', stroke: 1.2 },
    { d: circle(60, 33, 9), tone: 'accent' },
    { d: 'M24 120 C26 100 40 90 60 88 C80 90 94 100 96 120 Z', tone: 'robe' },
    { d: 'M36 120 C46 106 64 96 86 92 L93 100 C73 104 58 112 50 120 Z', tone: 'veil' },
    { d: 'M36 120 C46 106 64 96 86 92', tone: 'gold', stroke: 1.2 },
    { d: 'M53 70 L67 70 L68 90 L52 90 Z', tone: 'skin' },
    { d: ellipse(60, 58, 13.5, 16), tone: 'skin' },
    { d: 'M46.3 57 C44.5 44 51 40 60 40 C69 40 75.5 44 73.7 57 C71.5 49 66.5 45.5 60 46 C53.5 45.5 48.5 49 46.3 57 Z', tone: 'accent' },
    { d: 'M51 86 C55 93 65 93 69 86', tone: 'gold', stroke: 1.6 },
    { d: circle(60, 93.5, 2), tone: 'gold' },
    { d: 'M60 41 L60 47', tone: 'gold', stroke: 1 },
    { d: circle(60, 48.5, 1.9), tone: 'gold' },
    { d: circle(46.3, 64, 1.8), tone: 'gold' },
    { d: circle(73.7, 64, 1.8), tone: 'gold' },
  ],
  // Head and shoulders only, for a profile whose gender is not recorded.
  neutral: [
    { d: 'M18 120 C19 98 36 87 60 87 C84 87 101 98 102 120 Z', tone: 'robe' },
    { d: 'M53 68 L67 68 L68 89 L52 89 Z', tone: 'skin' },
    { d: ellipse(60, 55, 14.5, 17), tone: 'skin' },
    { d: 'M50 87 C56 92 64 92 70 87', tone: 'gold', stroke: 1.2 },
  ],
};
