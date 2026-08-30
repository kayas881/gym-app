// Dark and Light theme color palettes
export const Colors = {
  dark: {
    // Backgrounds
    background: '#0F0F0F',
    surface: '#1A1A1A',
    surfaceElevated: '#242424',
    card: '#1E1E1E',

    // Text
    text: '#FFFFFF',
    textSecondary: '#A0A0A0',
    textTertiary: '#6B6B6B',

    // Primary accent (neon green - gym vibe)
    primary: '#00E676',
    primaryDark: '#00C853',
    primaryLight: '#69F0AE',
    primaryMuted: 'rgba(0, 230, 118, 0.15)',

    // Status colors
    success: '#00E676',
    warning: '#FFB300',
    error: '#FF5252',
    info: '#448AFF',

    // Member status colors
    statusActive: '#00E676',
    statusPending: '#FFB300',
    statusExpired: '#FF5252',
    statusRejected: '#9E9E9E',

    // Borders & Dividers
    border: '#2A2A2A',
    divider: '#1F1F1F',

    // Input
    inputBackground: '#1A1A1A',
    inputBorder: '#333333',
    inputPlaceholder: '#6B6B6B',

    // Tab bar
    tabBar: '#0F0F0F',
    tabBarActive: '#00E676',
    tabBarInactive: '#6B6B6B',

    // Misc
    overlay: 'rgba(0, 0, 0, 0.7)',
    shadow: 'rgba(0, 0, 0, 0.3)',
  },
  light: {
    // Backgrounds
    background: '#F5F5F5',
    surface: '#FFFFFF',
    surfaceElevated: '#FFFFFF',
    card: '#FFFFFF',

    // Text
    text: '#1A1A1A',
    textSecondary: '#666666',
    textTertiary: '#999999',

    // Primary accent (darker green for light mode)
    primary: '#00C853',
    primaryDark: '#009624',
    primaryLight: '#5EFC82',
    primaryMuted: 'rgba(0, 200, 83, 0.1)',

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
    border: '#E0E0E0',
    divider: '#EEEEEE',

    // Input
    inputBackground: '#F5F5F5',
    inputBorder: '#E0E0E0',
    inputPlaceholder: '#999999',

    // Tab bar
    tabBar: '#FFFFFF',
    tabBarActive: '#00C853',
    tabBarInactive: '#999999',

    // Misc
    overlay: 'rgba(0, 0, 0, 0.5)',
    shadow: 'rgba(0, 0, 0, 0.1)',
  },
} as const;

export type ColorPalette = typeof Colors.dark;
export type ThemeColors = { [K in keyof ColorPalette]: string };
