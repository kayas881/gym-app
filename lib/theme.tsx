import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useColorScheme as useDeviceColorScheme } from 'react-native';
import { Colors, ThemeColors } from '../constants/colors';

type ThemeMode = 'dark' | 'light' | 'system';

interface ThemeContextValue {
  mode: ThemeMode;
  isDark: boolean;
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const deviceScheme = useDeviceColorScheme();
  const [mode, setMode] = useState<ThemeMode>('dark'); // Default to dark

  const isDark =
    mode === 'system' ? deviceScheme !== 'light' : mode === 'dark';

  const colors = isDark ? Colors.dark : Colors.light;

  const toggleTheme = useCallback(() => {
    setMode((prev) => {
      if (prev === 'dark') return 'light';
      if (prev === 'light') return 'dark';
      // If system, toggle to opposite of current system theme
      return isDark ? 'light' : 'dark';
    });
  }, [isDark]);

  return (
    <ThemeContext.Provider value={{ mode, isDark, colors, setMode, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
