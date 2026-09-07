import type { LucideIcon } from "lucide-react";
import { Fragment } from "react";

import { DropdownMenuItem, DropdownMenuSeparator } from "./ui/dropdown-menu";

export interface CommandMenuItem {
  disabled?: boolean;
  icon?: LucideIcon;
  id: string;
  label: string;
  onSelect: () => void;
  separatorBefore?: boolean;
  variant?: "default" | "destructive";
}

export const CommandMenuItems = ({ items }: { items: CommandMenuItem[] }) =>
  items.map((item) => {
    const Icon = item.icon;
    const handleAction = item.onSelect;
    return (
      <Fragment key={item.id}>
        {item.separatorBefore ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem
          disabled={item.disabled}
          onClick={handleAction}
          variant={item.variant}
        >
          {Icon ? <Icon /> : null}
          {item.label}
        </DropdownMenuItem>
      </Fragment>
    );
  });
