// Adapted from React Bits BlurText (MIT + Commons Clause), with a static reduced-motion variant.
// Source: https://github.com/DavidHDev/react-bits/tree/main/src/content/TextAnimations/BlurText
import { motion, useReducedMotion } from "motion/react";
export default function BlurText({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <span className={className} aria-label={text}>
      {text.split(" ").map((word, index) => (
        <motion.span
          aria-hidden="true"
          className="blur-word"
          key={index}
          initial={reduced ? false : { filter: "blur(8px)", opacity: 0, y: 12 }}
          animate={{ filter: "blur(0px)", opacity: 1, y: 0 }}
          transition={{
            duration: reduced ? 0 : 0.45,
            delay: reduced ? 0 : index * 0.07,
          }}
        >
          {word}{" "}
        </motion.span>
      ))}
    </span>
  );
}
