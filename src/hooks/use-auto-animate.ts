import { useEffect, useRef } from "react";
import autoAnimate from "@formkit/auto-animate";

/** Attach @formkit/auto-animate to a container ref. Respects reduced motion. */
export function useAutoAnimate<T extends HTMLElement = HTMLElement>(duration = 220) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    autoAnimate(ref.current, {
      duration: reduce ? 0 : duration,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    });
  }, [duration]);
  return ref;
}
