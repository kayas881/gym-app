// Dark and Light theme color palettes
export const Colors = {
  dark: {
    // Backgrounds
    background: '#0A0C0B',
    surface: '#121613',
    surfaceElevated: '#1A201C',
    card: '#151916',

    // Text
    text: '#F4F7F2',
    textSecondary: '#A6AEA5',
    textTertiary: '#687168',

    // Primary accent (neon green - gym vibe)
    primary: '#B7F34A',
    primaryDark: '#8FC62D',
    primaryLight: '#D7FF8E',
    primaryMuted: 'rgba(183, 243, 74, 0.13)',

    // Status colors
    success: '#4BD982',
    warning: '#FFC14D',
    error: '#FF6B6B',
    info: '#75A7FF',

    // Member status colors
    statusActive: '#4BD982',
    statusPending: '#FFC14D',
    statusExpired: '#FF6B6B',
    statusRejected: '#8C958D',

    // Borders & Dividers
    border: '#282E2A',
    divider: '#202522',

    // Input
    inputBackground: '#121613',
    inputBorder: '#303832',
    inputPlaceholder: '#687168',

    // Tab bar
    tabBar: '#141815',
    tabBarActive: '#B7F34A',
    tabBarInactive: '#747D75',

    // Misc
    overlay: 'rgba(0, 0, 0, 0.7)',
    shadow: 'rgba(0, 0, 0, 0.45)',
  },
  light: {
    // Backgrounds
    background: '#F4F6EF',
    surface: '#FFFFFF',
    surfaceElevated: '#EEF2E8',
    card: '#FFFFFF',

    // Text
    text: '#192019',
    textSecondary: '#606A61',
    textTertiary: '#8A938B',

    // Primary accent (darker green for light mode)
    primary: '#78AA18',
    primaryDark: '#5D870C',
    primaryLight: '#B7F34A',
    primaryMuted: 'rgba(120, 170, 24, 0.12)',

    // Status colors
    success: '#00C853',
    warning: '#F57F17',
    error: '#D32F2F',
    info: '#1976D2',

    // Member status colors
    statusActive: '#00C853',
    statusPending: '#F57F17',
    statusExpired: '#D32F2F',
    statusRejected: '#9E9E9E',

    // Borders & Dividers
    border: '#DDE3D9',
    divider: '#E7EBE3',

    // Input
    inputBackground: '#F5F5F5',
    inputBorder: '#E0E0E0',
    inputPlaceholder: '#999999',

    // Tab bar
    tabBar: '#FFFFFF',
    tabBarActive: '#5D870C',
    tabBarInactive: '#7D877E',

    // Misc
    overlay: 'rgba(0, 0, 0, 0.5)',
    shadow: 'rgba(0, 0, 0, 0.1)',
  },
} as const;

export type ColorPalette = typeof Colors.dark;
export type ThemeColors = { [K in keyof ColorPalette]: string };
