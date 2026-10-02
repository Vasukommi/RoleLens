"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { useRef, useState } from "react";

type SelectProps = {
  id?: string;
  "aria-label"?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  disabled?: boolean;
};

export function Select({ id, value, onValueChange, options, disabled, ...props }: SelectProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [container, setContainer] = useState<HTMLElement | undefined>();

  return (
    <SelectPrimitive.Root
      value={`option:${value}`}
      onValueChange={(next) => onValueChange(next.slice("option:".length))}
      disabled={disabled}
      open={open}
      onOpenChange={(next) => {
        // Native modal dialogs make body-level portals inert and hide them behind the backdrop.
        if (next) setContainer(trigger.current?.closest("dialog") ?? undefined);
        setOpen(next);
      }}
    >
      <SelectPrimitive.Trigger
        ref={trigger}
        id={id}
        aria-label={props["aria-label"]}
        className="custom-select-trigger"
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon className="custom-select-chevron">
          <ChevronDown size={14} aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal container={container}>
        <SelectPrimitive.Content
          className="custom-select-content"
          position="popper"
          sideOffset={5}
          collisionPadding={12}
          onEscapeKeyDown={(event) => {
            // First Escape closes the dropdown, leaving its containing drawer open.
            event.preventDefault();
            setOpen(false);
          }}
        >
          <SelectPrimitive.ScrollUpButton className="custom-select-scroll">
            <ChevronUp size={14} aria-hidden="true" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="custom-select-viewport">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={`option:${option.value}`}
                disabled={option.disabled}
                className="custom-select-option"
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="custom-select-check">
                  <Check size={14} aria-hidden="true" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="custom-select-scroll">
            <ChevronDown size={14} aria-hidden="true" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
