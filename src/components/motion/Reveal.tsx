import { motion, useReducedMotion, type Variants } from "framer-motion";
import type { ReactNode } from "react";
import { cardEntry, staggerContainer } from "@/lib/motion";

/** Container that staggers direct children on mount. */
export function RevealGroup({
  children,
  stagger = 0.08,
  delay = 0.04,
  className,
}: {
  children: ReactNode;
  stagger?: number;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={staggerContainer(stagger, delay)}
    >
      {children}
    </motion.div>
  );
}

/** Individual card/element used inside <RevealGroup>. */
export function RevealItem({
  children,
  variants,
  className,
  style,
}: {
  children: ReactNode;
  variants?: Variants;
  className?: string;
  style?: React.CSSProperties;
}) {
  const reduce = useReducedMotion();
  if (reduce)
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  return (
    <motion.div
      className={className}
      style={{ willChange: "transform, opacity", ...style }}
      variants={variants ?? cardEntry}
    >
      {children}
    </motion.div>
  );
}
