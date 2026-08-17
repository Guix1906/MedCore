import { cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from "react";
import {
  useFloating,
  useHover,
  useFocus,
  useDismiss,
  useRole,
  useInteractions,
  offset,
  flip,
  shift,
  autoUpdate,
  FloatingPortal,
  useTransitionStyles,
} from "@floating-ui/react";

type Props = {
  label: ReactNode;
  children: ReactElement;
  placement?: "top" | "bottom" | "left" | "right";
  delay?: number;
};

/**
 * Accessible tooltip powered by @floating-ui/react.
 * Wraps a single interactive child; forwards `ref` transparently.
 */
export default function Tooltip({ label, children, placement = "bottom", delay = 250 }: Props) {
  const [open, setOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  const hover = useHover(context, { delay: { open: delay, close: 60 }, move: false });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "tooltip" });

  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);

  const { isMounted, styles } = useTransitionStyles(context, {
    duration: { open: 160, close: 100 },
    initial: { opacity: 0, transform: "scale(0.96) translateY(-2px)" },
    open: { opacity: 1, transform: "scale(1) translateY(0)" },
    close: { opacity: 0, transform: "scale(0.98) translateY(-1px)" },
  });

  if (!isValidElement(children)) return children;

  const child = cloneElement(children, {
    ref: refs.setReference,
    ...getReferenceProps((children.props as Record<string, unknown>) ?? {}),
  } as Record<string, unknown>);

  return (
    <>
      {child}
      {isMounted && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={{ ...floatingStyles, ...styles, zIndex: 80 }}
            {...getFloatingProps()}
            className="pointer-events-none px-2.5 py-1.5 rounded-lg bg-[#111827] text-white text-[12px] font-medium shadow-lg whitespace-nowrap"
          >
            {label}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
