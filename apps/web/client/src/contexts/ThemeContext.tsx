import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

type Theme = 'dark' | 'light' | 'system';

interface ThemeContextType {
    theme: Theme;
    resolvedTheme: 'dark' | 'light';
    setTheme: (theme: Theme) => void;
}

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

export function ThemeProvider({ children }: ThemeProviderProps) {
    const [theme, setThemeState] = useState<Theme>(() => {
        const stored = localStorage.getItem('deltawatch-theme');
        return (stored as Theme) || 'dark';
    });
    
    const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>('dark');

    // Listen to system preference changes
    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        
        const updateResolvedTheme = () => {
            if (theme === 'system') {
                setResolvedTheme(mediaQuery.matches ? 'dark' : 'light');
            } else {
                setResolvedTheme(theme);
            }
        };
        
        updateResolvedTheme();
        
        mediaQuery.addEventListener('change', updateResolvedTheme);
        return () => mediaQuery.removeEventListener('change', updateResolvedTheme);
    }, [theme]);

    // Apply theme to document
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', resolvedTheme);
        
        // Also update meta theme-color for mobile browsers
        const metaThemeColor = document.querySelector('meta[name="theme-color"]');
        if (metaThemeColor) {
            metaThemeColor.setAttribute('content', resolvedTheme === 'dark' ? '#0d1117' : '#ffffff');
        }
    }, [resolvedTheme]);

    const setTheme = (newTheme: Theme) => {
        setThemeState(newTheme);
        localStorage.setItem('deltawatch-theme', newTheme);
    };

    return (
        <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}
