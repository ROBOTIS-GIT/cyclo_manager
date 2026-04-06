"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Set initial theme from localStorage or system preference
    const initializeTheme = () => {
      try {
        const savedTheme = localStorage.getItem("theme") as Theme | null;
        if (savedTheme && (savedTheme === "light" || savedTheme === "dark")) {
          setThemeState(savedTheme);
          document.documentElement.setAttribute("data-theme", savedTheme);
        } else {
          // Check system preference
          const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
          const initialTheme = prefersDark ? "dark" : "light";
          setThemeState(initialTheme);
          document.documentElement.setAttribute("data-theme", initialTheme);
        }
      } catch (error) {
        // Fallback to dark theme if localStorage is not available
        setThemeState("dark");
        document.documentElement.setAttribute("data-theme", "dark");
      }
      setMounted(true);
    };

    initializeTheme();
  }, []);

  useEffect(() => {
    if (mounted) {
      // Apply theme to document root
      document.documentElement.setAttribute("data-theme", theme);
      try {
        localStorage.setItem("theme", theme);
      } catch (error) {
        // Ignore localStorage errors
      }
    }
  }, [theme, mounted]);

  const toggleTheme = () => {
    setThemeState((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
