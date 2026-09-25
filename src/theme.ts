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
  scrim: 'rgba(17,21,19,0.38)',
  // hero glass
  glass: 'rgba(255,255,255,0.55)',
  glassBorder: 'rgba(255,255,255,0.60)',
  mesh: ['#1D6B45', '#3F9D73', '#C9EEDA'] as readonly [string, string, string],
  meshOpacity: [1, 1, 0.9] as readonly [number, number, number],
  // nav glass: less blur, more tint (sits over scrolling content)
  nav: 'rgba(255,255,255,0.72)',
  navBorder: 'rgba(22,32,27,0.08)',
  // donut: one hue, stepped lightness
  chart: ['#1D6B45', '#3F9D73', '#7FC2A0', '#14492F', '#B9E0CB', '#9AA5A0', '#5E8F75', '#C9D4CE'],
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
  scrim: 'rgba(0,0,0,0.55)',
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

export function useTheme(): Theme {
  const system = useColorScheme();
  const pref = useContext(AppearanceContext);
  const mode = pref === 'system' ? system : pref;
  return mode === 'dark' ? dark : light;
}
