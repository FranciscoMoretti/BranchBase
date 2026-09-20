import { Command as CommandPrimitive } from "cmdk";
import { SearchIcon, CheckIcon } from "lucide-react";
import type * as React from "react";

import {
  InputGroup,
  InputGroupInput,
  InputGroupText,
} from "@/client/components/ui/input-group";
import { cn } from "@/client/lib/utils";

const Command = ({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) => (
  <CommandPrimitive
    data-slot="command"
    className={cn(
      "bg-popover text-popover-foreground flex size-full flex-col overflow-hidden rounded-none",
      className
    )}
    {...props}
  />
);

const CommandInput = ({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) => (
  <div data-slot="command-input-wrapper" className="border-b pb-0">
    <InputGroup className="border-input/30 bg-input/30 h-8 border-none shadow-none! *:data-[slot=input-group-addon]:pl-2!">
      <CommandPrimitive.Input
        asChild
        data-slot="command-input"
        className={cn(
          "w-full text-xs outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      >
        <InputGroupInput />
      </CommandPrimitive.Input>
      <InputGroupText className="order-first pl-2">
        <SearchIcon className="size-4 shrink-0 opacity-50" />
      </InputGroupText>
    </InputGroup>
  </div>
);

const CommandList = ({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) => (
  <CommandPrimitive.List
    data-slot="command-list"
    className={cn(
      "no-scrollbar max-h-72 scroll-py-0 overflow-x-hidden overflow-y-auto outline-none",
      className
    )}
    {...props}
  />
);

const CommandGroup = ({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) => (
  <CommandPrimitive.Group
    data-slot="command-group"
    className={cn(
      "text-foreground **:[[cmdk-group-heading]]:text-muted-foreground overflow-hidden **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs",
      className
    )}
    {...props}
  />
);

const CommandItem = ({
  className,
  children,
  asChild,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) => (
  <CommandPrimitive.Item
    asChild={asChild}
    data-slot="command-item"
    className={cn(
      "group/command-item data-[selected=true]:bg-muted data-[selected=true]:text-foreground data-[selected=true]:*:[svg]:text-foreground relative flex cursor-default items-center gap-2 rounded-none px-2 py-2 text-xs outline-hidden select-none in-data-[slot=dialog-content]:rounded-none! data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
      className
    )}
    {...props}
  >
    {asChild ? (
      children
    ) : (
      <>
        {children}
        <CheckIcon className="ml-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100" />
      </>
    )}
  </CommandPrimitive.Item>
);

export { Command, CommandInput, CommandList, CommandGroup, CommandItem };
