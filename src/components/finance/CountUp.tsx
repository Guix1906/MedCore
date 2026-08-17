import { useEffect, useRef, useState } from "react";

function computeStart(to: number): number {
  const abs = Math.abs(to);
  if (abs < 1) return 0;
  const magnitude = Math.pow(10, Math.floor(Math.log10(abs)));
  const step = magnitude >= 1000 ? magnitude : magnitude / 10;
  const floored = Math.floor(abs / step) * step;
  const start = floored >= abs ? floored - step : floored;
  return to < 0 ? -start : start;
}

export function CountUp({
  value,
  format,
  duration = 1200,
  className,
}: {
  value: number;
  format: (v: number) => string;
  duration?: number;
  className?: string;
}) {
  const to = Number(value) || 0;
  const ref = useRef<HTMLSpanElement | null>(null);
  const seenRef = useRef(false);
  const prevRef = useRef<number>(computeStart(to));
  const [display, setDisplay] = useState<number>(prevRef.current);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (seenRef.current) {
      setInView(true);
      return;
    }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            seenRef.current = true;
            setInView(true);
            io.disconnect();
          }
        });
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;
    const from = seenRef.current && prevRef.current !== 0 ? prevRef.current : computeStart(to);
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(2, -10 * t);
      const current = from + (to - from) * (t === 1 ? 1 : eased);
      setDisplay(current);
      if (t < 1) raf = requestAnimationFrame(tick);
      else prevRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, duration, inView]);

  return (
    <span ref={ref} className={className}>
      {format(display)}
    </span>
  );
}

export const BRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
