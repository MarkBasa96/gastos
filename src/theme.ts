import { createContext, useContext } from 'react';
import { useColorScheme } from 'react-native';

// One accent (green). Contrast checked: accent 6.47:1 on white, 8.53:1 on dark bg (Erina v2 §2).
// Glass lives on exactly two surfaces (hero card, bottom nav); everything dense stays solid.
const light = {
  bg: '#F6F7F6',
  surface: '#FFFFFF',
  text: '#16201B',
  muted: '#5B6660', // 5.9:1 on bg
  border: '#DCE1DE',
  accent: '#1D6B45',
  accentText: '#FFFFFF',
  accentSoft: '#E3F0E8',
  danger: '#B3261E',
  warning: '#9A6700', // 4.87:1 on white
  scrim: 'rgba(17,21,19,0.22)', // lighter since 3.1: the blur behind pop-ups does most of the separating
  // hero glass
  glass: 'rgba(255,255,255,0.55)',
  glassBorder: 'rgba(255,255,255,0.60)',
  mesh: ['#1D6B45', '#3F9D73', '#C9EEDA'] as readonly [string, string, string],
  meshOpacity: [1, 1, 0.9] as readonly [number, number, number],
  // nav glass: less blur, more tint (sits over scrolling content)
  nav: 'rgba(255,255,255,0.72)',
  navBorder: 'rgba(22,32,27,0.08)',
  // donut: one hue, stepped lightness
  chart: ['#1D6B45', '#3F9D73', '#7FC2A0', '#14492F', '#B9E0CB', '#9AA5A0', '#5E8F75', '#C9D4CE'] as string[],
  dark: false,
};

const dark: typeof light = {
  bg: '#111513',
  surface: '#1A201D',
  text: '#EDF1EE',
  muted: '#A3ADA7',
  border: '#2C3530',
  accent: '#5CC48C',
  accentText: '#0C1A12',
  accentSoft: '#1F3328',
  danger: '#F2B8B5',
  warning: '#E8A33D', // 8.54:1 on bg
  scrim: 'rgba(0,0,0,0.38)',
  glass: 'rgba(26,32,29,0.42)',
  glassBorder: 'rgba(255,255,255,0.08)',
  mesh: ['#123D28', '#2A8A5B', '#5CC48C'] as const,
  meshOpacity: [1, 1, 0.7] as const,
  nav: 'rgba(26,32,29,0.74)',
  navBorder: 'rgba(255,255,255,0.07)',
  chart: ['#5CC48C', '#3F9D73', '#2E7A57', '#8FD9B0', '#BFEBD2', '#4B5751', '#76B394', '#2A3A32'],
  dark: true,
};

export type Theme = typeof light;
export type Appearance = 'system' | 'light' | 'dark';

// ---------- Colour themes (Joe v3.1) ----------
// Each theme swaps the accent family and tints the neutrals a touch toward it; text, danger and
// warning stay put. Every accent is at least 4.5:1 on its background, surface and soft tint in both
// modes (checked for the 3.1 mockups). Green is the original palette, unchanged.
export const COLOR_THEMES = ['green', 'pink', 'lavender', 'ocean', 'teal', 'coral', 'sunflower', 'latte'] as const;
export type ColorTheme = (typeof COLOR_THEMES)[number];
export const COLOR_THEME_NAMES: Record<ColorTheme, string> = {
  green: 'Gastos green',
  pink: 'Baby pink',
  lavender: 'Lavender',
  ocean: 'Ocean blue',
  teal: 'Mint teal',
  coral: 'Sunset coral',
  sunflower: 'Sunflower',
  latte: 'Latte',
};

type Tint = { accent: string; soft: string; bg: string; border: string; mesh: readonly [string, string, string] };
type LightTint = Tint & { muted: string; text: string };
type DarkTint = Tint & { accentText: string; surface: string };

const TINTS: Record<Exclude<ColorTheme, 'green'>, { l: LightTint; d: DarkTint }> = {
  pink: {
    l: { accent: '#B23A6E', soft: '#FCE4EE', bg: '#FBF5F7', border: '#EDDCE3', muted: '#6E5A63', text: '#2A1520', mesh: ['#B23A6E', '#E58DB2', '#F9D2E1'] },
    d: { accent: '#F2A7C6', accentText: '#2A0E1A', soft: '#3A2130', bg: '#171113', surface: '#221A1D', border: '#3A2C32', mesh: ['#4A1A30', '#A8456F', '#F2A7C6'] },
  },
  lavender: {
    l: { accent: '#6B4FB8', soft: '#ECE6F8', bg: '#F7F5FB', border: '#DFDAEA', muted: '#5F5A6E', text: '#1C1830', mesh: ['#6B4FB8', '#9D86DA', '#DCD2F5'] },
    d: { accent: '#BBA8F2', accentText: '#1A1233', soft: '#2A2440', bg: '#131219', surface: '#1C1A24', border: '#2F2B3B', mesh: ['#2A2050', '#6B4FB8', '#BBA8F2'] },
  },
  ocean: {
    l: { accent: '#1E5FA6', soft: '#E1ECF8', bg: '#F4F7FA', border: '#D8E1EA', muted: '#56616D', text: '#14202C', mesh: ['#1E5FA6', '#4B94D6', '#CBE3F7'] },
    d: { accent: '#8CBCF2', accentText: '#0B1A2C', soft: '#1D2F45', bg: '#10141A', surface: '#182029', border: '#2A3440', mesh: ['#10304F', '#2A6FB3', '#8CBCF2'] },
  },
  teal: {
    l: { accent: '#0E716C', soft: '#D9F0EE', bg: '#F3F8F7', border: '#D6E3E1', muted: '#566663', text: '#132220', mesh: ['#0E716C', '#3FAFA6', '#C4EDE8'] },
    d: { accent: '#6DD3CA', accentText: '#062220', soft: '#16332F', bg: '#0F1514', surface: '#172020', border: '#283533', mesh: ['#0D3B38', '#1E8C84', '#6DD3CA'] },
  },
  coral: {
    l: { accent: '#B5432A', soft: '#FBE4DC', bg: '#FBF6F4', border: '#EDDDD8', muted: '#6B5C57', text: '#2A1712', mesh: ['#B5432A', '#E8835F', '#FAD5C4'] },
    d: { accent: '#F4A187', accentText: '#2A120A', soft: '#3B241C', bg: '#171210', surface: '#221A17', border: '#3A2E2A', mesh: ['#4A1E12', '#B5432A', '#F4A187'] },
  },
  sunflower: {
    l: { accent: '#8A5A00', soft: '#FCEFC7', bg: '#FBF8EF', border: '#E9E1C8', muted: '#665E4C', text: '#231C0B', mesh: ['#8A5A00', '#E0A82E', '#FBE7A6'] },
    d: { accent: '#F2C14E', accentText: '#221700', soft: '#3A3013', bg: '#15130D', surface: '#201D14', border: '#37321F', mesh: ['#3F2C00', '#A87A12', '#F2C14E'] },
  },
  latte: {
    l: { accent: '#7B5234', soft: '#F1E6DC', bg: '#F8F5F2', border: '#E4DBD3', muted: '#655C55', text: '#221912', mesh: ['#7B5234', '#B88962', '#EFDCC8'] },
    d: { accent: '#DDB48E', accentText: '#23170C', soft: '#33271D', bg: '#15120F', surface: '#1F1A16', border: '#352D26', mesh: ['#3A2616', '#8A5E3C', '#DDB48E'] },
  },
};

function mix(a: string, b: string, k: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) => Math.round(((pa >> sh) & 255) * (1 - k) + ((pb >> sh) & 255) * k);
  return '#' + [16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** The donut: one hue, stepped lightness, in the same order as the green original. */
function chartFor(accent: string, dark: boolean): string[] {
  return dark
    ? [accent, mix(accent, '#000000', 0.25), mix(accent, '#000000', 0.45), mix(accent, '#FFFFFF', 0.25), mix(accent, '#FFFFFF', 0.55), '#4B5751', mix(accent, '#000000', 0.12), '#2A3A32']
    : [accent, mix(accent, '#FFFFFF', 0.2), mix(accent, '#FFFFFF', 0.45), mix(accent, '#000000', 0.3), mix(accent, '#FFFFFF', 0.7), '#9AA5A0', mix(accent, '#FFFFFF', 0.3), '#C9D4CE'];
}

function build(key: ColorTheme, mode: 'light' | 'dark'): Theme {
  if (key === 'green') return mode === 'dark' ? dark : light;
  const tint = TINTS[key];
  if (mode === 'light') {
    const l = tint.l;
    return { ...light, bg: l.bg, text: l.text, muted: l.muted, border: l.border, accent: l.accent, accentSoft: l.soft, mesh: l.mesh, chart: chartFor(l.accent, false) };
  }
  const d = tint.d;
  const n = parseInt(d.surface.slice(1), 16);
  return {
    ...dark,
    bg: d.bg,
    surface: d.surface,
    border: d.border,
    accent: d.accent,
    accentText: d.accentText,
    accentSoft: d.soft,
    mesh: d.mesh,
    nav: `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},0.74)`,
    chart: chartFor(d.accent, true),
  };
}

// Built once: theme objects keep their identity between renders.
const BUILT = Object.fromEntries(COLOR_THEMES.map((k) => [k, { light: build(k, 'light'), dark: build(k, 'dark') }])) as Record<
  ColorTheme,
  { light: Theme; dark: Theme }
>;

export function themeFor(key: ColorTheme, mode: 'light' | 'dark'): Theme {
  return (BUILT[key] ?? BUILT.green)[mode];
}

export const radius = 12; // controls
export const cardRadius = 20; // card-level containers

export const font = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  brand: 'Poppins_700Bold',
};

export const AppearanceContext = createContext<Appearance>('system');
export const ColorThemeContext = createContext<ColorTheme>('green');

export function useTheme(): Theme {
  const system = useColorScheme();
  const pref = useContext(AppearanceContext);
  const color = useContext(ColorThemeContext);
  const mode = pref === 'system' ? system : pref;
  return themeFor(color, mode === 'dark' ? 'dark' : 'light');
}
