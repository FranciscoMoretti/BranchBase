import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

export type Theme = "dark" | "light" | "system";

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

interface ThemeProviderState {
  setTheme: (theme: Theme) => void;
  theme: Theme;
}

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(
  undefined
);

const isTheme = (value: string | null): value is Theme =>
  value === "dark" || value === "light" || value === "system";

const storedTheme = (storageKey: string, fallback: Theme): Theme => {
  try {
    const value = localStorage.getItem(storageKey);
    return isTheme(value) ? value : fallback;
  } catch {
    return fallback;
  }
};

const applyTheme = (theme: Theme, prefersDark: boolean) => {
  let resolvedTheme = theme;
  if (theme === "system") {
    resolvedTheme = prefersDark ? "dark" : "light";
  }
  const root = document.documentElement;

  root.classList.remove("light", "dark");
  root.classList.add(resolvedTheme);
  root.style.colorScheme = resolvedTheme;
};

export const ThemeProvider = ({
  children,
  defaultTheme = "system",
  storageKey = "branchbase:theme",
}: ThemeProviderProps) => {
  const [theme, setTheme] = useState<Theme>(() =>
    storedTheme(storageKey, defaultTheme)
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncTheme = () => applyTheme(theme, media.matches);

    syncTheme();
    if (theme !== "system") {
      return;
    }

    media.addEventListener("change", syncTheme);
    return () => media.removeEventListener("change", syncTheme);
  }, [theme]);

  const updateTheme = useCallback(
    (nextTheme: Theme) => {
      try {
        localStorage.setItem(storageKey, nextTheme);
      } catch {
        // The selected theme still applies for this session when storage is blocked.
      }
      setTheme(nextTheme);
    },
    [storageKey]
  );
  const value = useMemo(
    () => ({ setTheme: updateTheme, theme }),
    [theme, updateTheme]
  );

  return (
    <ThemeProviderContext.Provider value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
};

export const useTheme = (): ThemeProviderState => {
  const context = useContext(ThemeProviderContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
