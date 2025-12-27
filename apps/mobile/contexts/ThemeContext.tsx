import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useColorScheme, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

type Theme = 'dark' | 'light' | 'system';

interface ThemeContextType {
    theme: Theme;
    resolvedTheme: 'dark' | 'light';
    setTheme: (theme: Theme) => void;
    colors: typeof darkColors;
}

const darkColors = {
    background: '#0d1117',
    backgroundSecondary: '#161b22',
    backgroundTertiary: '#21262d',
    border: '#30363d',
    text: '#c9d1d9',
    textSecondary: '#8b949e',
    textMuted: '#6e7681',
    accent: '#238636',
    accentSecondary: '#1f6feb',
    danger: '#f85149',
    warning: '#d29922',
};

const lightColors = {
    background: '#ffffff',
    backgroundSecondary: '#f6f8fa',
    backgroundTertiary: '#eaeef2',
    border: '#d0d7de',
    text: '#1f2328',
    textSecondary: '#656d76',
    textMuted: '#8c959f',
    accent: '#1a7f37',
    accentSecondary: '#0969da',
    danger: '#cf222e',
    warning: '#9a6700',
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}

interface ThemeProviderProps {
    children: ReactNode;
}

const THEME_STORAGE_KEY = 'deltawatch-mobile-theme';

// Platform-agnostic storage
const storage = {
    async getItem(key: string): Promise<string | null> {
        if (Platform.OS === 'web') {
            return localStorage.getItem(key);
        }
        return SecureStore.getItemAsync(key);
    },
    async setItem(key: string, value: string): Promise<void> {
        if (Platform.OS === 'web') {
            localStorage.setItem(key, value);
            return;
        }
        await SecureStore.setItemAsync(key, value);
    },
};

export function ThemeProvider({ children }: ThemeProviderProps) {
    const systemColorScheme = useColorScheme();
    const [theme, setThemeState] = useState<Theme>('system');
    const [isLoaded, setIsLoaded] = useState(false);

    // Load saved theme on mount
    useEffect(() => {
        storage.getItem(THEME_STORAGE_KEY).then((saved) => {
            if (saved && ['dark', 'light', 'system'].includes(saved)) {
                setThemeState(saved as Theme);
            }
            setIsLoaded(true);
        });
    }, []);

    // Resolve the actual theme based on preference
    const resolvedTheme: 'dark' | 'light' = 
        theme === 'system' 
            ? (systemColorScheme || 'dark') 
            : theme;

    const colors = resolvedTheme === 'dark' ? darkColors : lightColors;

    const setTheme = (newTheme: Theme) => {
        setThemeState(newTheme);
        storage.setItem(THEME_STORAGE_KEY, newTheme);
    };

    if (!isLoaded) {
        return null; // Or a loading placeholder
    }

    return (
        <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, colors }}>
            {children}
        </ThemeContext.Provider>
    );
}

