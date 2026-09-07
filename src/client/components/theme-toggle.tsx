import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";

import { useTheme } from "./theme-provider";
import type { Theme } from "./theme-provider";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

const THEMES = [
  { icon: SunIcon, label: "Light", value: "light" },
  { icon: MoonIcon, label: "Dark", value: "dark" },
  { icon: MonitorIcon, label: "System", value: "system" },
] as const;

const isTheme = (value: string): value is Theme =>
  value === "dark" || value === "light" || value === "system";

export const ThemeToggle = () => {
  const { setTheme, theme } = useTheme();
  const activeTheme = THEMES.find((option) => option.value === theme);
  const ActiveIcon = activeTheme?.icon ?? MonitorIcon;
  const activeLabel = activeTheme?.label ?? "System";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={`Color theme: ${activeLabel}`}
            size="icon"
            title={`Color theme: ${activeLabel}`}
            variant="secondary"
          />
        }
      >
        <ActiveIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        <DropdownMenuRadioGroup
          onValueChange={(value) => {
            if (isTheme(value)) {
              setTheme(value);
            }
          }}
          value={theme}
        >
          <DropdownMenuLabel>Appearance</DropdownMenuLabel>
          {THEMES.map((option) => {
            const Icon = option.icon;
            return (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                <Icon />
                {option.label}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
