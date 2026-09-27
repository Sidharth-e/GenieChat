"use client";

import * as React from "react";

// Use useLayoutEffect to flush state updates before paint
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

type Theme = "light" | "dark" | "system";

interface ThemeContextType {
    theme: Theme;
    resolvedTheme: "light" | "dark";
    setTheme: (theme: Theme) => void;
}

const ThemeContext = React.createContext<ThemeContextType | undefined>(undefined);

export function useTheme() {
    const context = React.useContext(ThemeContext);
    if (!context) {
        throw new Error("useTheme must be used within a ThemeProvider");
    }
    return context;
}

export function ThemeProvider({
    children,
    defaultTheme = "dark",
}: {
    children: React.ReactNode;
    defaultTheme?: Theme;
}) {
    const [theme, setThemeState] = React.useState<Theme>(defaultTheme);
    const [resolvedTheme, setResolvedTheme] = React.useState<"light" | "dark">("dark");

    useIsomorphicLayoutEffect(() => {
        const saved = localStorage.getItem("theme") as Theme | null;
        if (saved) {
            setThemeState(saved);
        }
    }, []);

    useIsomorphicLayoutEffect(() => {
        const root = document.documentElement;
        
        const getSystemTheme = (): "light" | "dark" => {
            return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        };

        const applyTheme = (resolvedTheme: "light" | "dark") => {
            root.classList.remove("light", "dark");
            root.classList.add(resolvedTheme);
            root.setAttribute("data-theme", resolvedTheme);
            setResolvedTheme(resolvedTheme);
        };

        if (theme === "system") {
            applyTheme(getSystemTheme());
            
            const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
            const listener = (e: MediaQueryListEvent) => {
                applyTheme(e.matches ? "dark" : "light");
            };
            
            mediaQuery.addEventListener("change", listener);
            return () => mediaQuery.removeEventListener("change", listener);
        } else {
            applyTheme(theme);
        }
    }, [theme]);

    const setTheme = React.useCallback((newTheme: Theme) => {
        setThemeState(newTheme);
        localStorage.setItem("theme", newTheme);
    }, []);

    const value = React.useMemo(
        () => ({ theme, resolvedTheme, setTheme }),
        [theme, resolvedTheme, setTheme]
    );

    return (
        <ThemeContext.Provider value={value}>
            {children}
        </ThemeContext.Provider>
    );
}
