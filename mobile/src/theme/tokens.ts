/**
 * The WOW palette, ported from the web app's index.css.
 *
 * Same three tiers, same names, same values — deliberately, because two
 * products that share a brand and disagree about what "brand" means is the
 * failure this is meant to avoid. When a colour changes it changes in both
 * files, and the names matching is what makes that a mechanical job rather
 * than an archaeological one.
 *
 * Colours are RGB triples rather than hex strings for the reason index.css
 * stores channels rather than hex: half the design needs a colour at partial
 * opacity — scrims over photographs, pressed states, translucent headers — and
 * a hex string cannot be composed with an alpha without string surgery at the
 * call site. `rgba(token, 0.55)` reads as what it is.
 */

export type Channels = readonly [number, number, number];

export const rgb = (c: Channels): string => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

export const rgba = (c: Channels, alpha: number): string =>
  `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;

// ---------------------------------------------------------------- tier 1 --
// Primitives. Named for what they are, never for where they are used.

const lightInk = {
  50: [247, 242, 234],
  100: [241, 234, 224],
  200: [226, 217, 208],
  300: [205, 193, 188],
  400: [160, 145, 145],
  500: [124, 107, 110],
  600: [98, 80, 85],
  700: [79, 59, 64],
  800: [56, 37, 43],
  900: [36, 16, 23],
  950: [24, 10, 15],
} as const;

/** Inverted, but hand-set rather than mirrored, so hierarchy survives. */
const darkInk = {
  50: [30, 21, 23],
  100: [40, 29, 32],
  200: [55, 42, 45],
  300: [80, 64, 67],
  400: [117, 100, 101],
  500: [155, 139, 137],
  600: [186, 172, 167],
  700: [212, 201, 193],
  800: [232, 224, 214],
  900: [245, 239, 229],
  950: [250, 246, 239],
} as const;

/**
 * The accent ramp, still named rose so no screen changes: the matrimony home
 * template's maroon, #6E1026 at 600 and #8A1230 at 500.
 */
const lightRose = {
  50: [248, 236, 233],
  100: [240, 220, 214],
  200: [227, 188, 188],
  300: [204, 139, 148],
  400: [170, 72, 92],
  500: [138, 18, 48],
  600: [110, 16, 38],
  700: [88, 12, 30],
  800: [68, 9, 23],
  900: [50, 7, 17],
} as const;

const darkRose = {
  50: [45, 17, 24],
  100: [60, 21, 31],
  200: [84, 28, 42],
  300: [118, 38, 58],
  400: [168, 66, 88],
  500: [214, 122, 138],
  600: [230, 152, 165],
  700: [240, 182, 191],
  800: [246, 210, 215],
  900: [250, 230, 233],
} as const;

// ---------------------------------------------------------------- tier 2 --
// Semantic tokens. Screens only ever read these.

export interface Theme {
  readonly dark: boolean;
  readonly ink: Record<keyof typeof lightInk, Channels>;
  readonly rose: Record<keyof typeof lightRose, Channels>;

  readonly canvas: Channels;
  readonly surface: Channels;
  readonly surfaceRaised: Channels;
  readonly surfaceSunken: Channels;
  readonly border: Channels;
  readonly borderStrong: Channels;

  readonly brand: Channels;
  readonly brandStrong: Channels;
  readonly brandSoft: Channels;
  /** What sits ON the accent: white on light, near-black on dark, because the
   *  accent lifts in dark mode and white on it fails contrast. */
  readonly brandFg: Channels;
  readonly focus: Channels;

  readonly positiveFg: Channels;
  readonly positiveBg: Channels;
  readonly cautionFg: Channels;
  readonly cautionBg: Channels;
  readonly criticalFg: Channels;
  readonly criticalBg: Channels;

  /** Struck gold, for ornament only (the heart field), never for text. */
  readonly gold: Channels;
  readonly goldLit: Channels;
  readonly goldDeep: Channels;

  readonly shadowColor: Channels;
  /**
   * The one colour that does not invert.
   *
   * A scrim exists to keep white text legible over a photograph. Everything
   * else here flips between themes, which is right for anything sitting on the
   * page and exactly wrong for anything sitting on an image: invert the scrim
   * and the dark overlay becomes a light one, taking the caption with it.
   */
  readonly scrim: Channels;
}

export const lightTheme: Theme = {
  dark: false,
  ink: lightInk,
  rose: lightRose,

  canvas: [250, 246, 239],
  surface: [255, 255, 255],
  surfaceRaised: [255, 255, 255],
  surfaceSunken: [246, 239, 228],
  /*
   * The template's hairlines are its ink at 14% (28% round a field). React
   * Native paints a border over the view's own white, so these are that ink
   * laid on white — exactly the colour the template's rules come out as.
   */
  border: [224, 222, 222],
  borderStrong: [194, 188, 190],

  brand: lightRose[600],
  brandStrong: lightRose[700],
  brandSoft: lightRose[50],
  brandFg: [250, 246, 239],
  focus: lightRose[400],

  positiveFg: [21, 94, 76],
  positiveBg: [226, 243, 237],
  cautionFg: [124, 74, 12],
  cautionBg: [250, 240, 222],
  criticalFg: [176, 42, 28],
  criticalBg: [253, 232, 228],

  // Tinted to the ground rather than pure black: a black shadow on a
  // ivory canvas reads as a hole punched in the page.
  gold: [169, 131, 47],
  goldLit: [217, 180, 95],
  goldDeep: [122, 90, 28],

  shadowColor: [36, 16, 23],
  scrim: [14, 8, 11],
};

export const darkTheme: Theme = {
  dark: true,
  ink: darkInk,
  rose: darkRose,

  canvas: [20, 13, 15],
  surface: [30, 21, 23],
  surfaceRaised: [38, 27, 30],
  surfaceSunken: [24, 16, 18],
  border: [52, 40, 42],
  borderStrong: [72, 57, 59],

  brand: darkRose[500],
  brandStrong: darkRose[600],
  brandSoft: darkRose[100],
  brandFg: [30, 8, 14],
  focus: darkRose[400],

  positiveFg: [126, 214, 186],
  positiveBg: [17, 48, 40],
  cautionFg: [226, 186, 116],
  cautionBg: [54, 41, 18],
  criticalFg: [250, 160, 146],
  criticalBg: [64, 26, 22],

  gold: [201, 164, 86],
  goldLit: [232, 200, 128],
  goldDeep: [150, 116, 48],

  shadowColor: [0, 0, 0],
  scrim: [14, 8, 11],
};

/** Inputs and chips, buttons, cards: square, as the matrimony home template
 *  draws everything and as the web app does. */
export const radius = { sm: 0, md: 0, lg: 0 } as const;

/**
 * The spacing step. Four points, like Tailwind's, so a gap named here and a gap
 * named in the web app describe the same distance.
 */
export const space = (steps: number): number => steps * 4;
