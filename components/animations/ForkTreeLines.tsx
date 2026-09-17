"use client";

import { useEffect } from "react";

/**
 * Animates the .ftline paths inside the fork-graph SVG so each connector
 * draws itself in on mount, staggered left to right.
 */
export default function ForkTreeLines() {
  useEffect(() => {
    const lines = document.querySelectorAll<SVGPathElement>(".ftline");
    lines.forEach((line, i) => {
      const len = line.getTotalLength();
      line.style.strokeDasharray = `${len}`;
      line.style.strokeDashoffset = `${len}`;
      line.style.transition = `stroke-dashoffset 1.1s cubic-bezier(.4,0,.2,1) ${0.15 * i}s`;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          line.style.strokeDashoffset = "0";
        })
      );
    });
  }, []);

  return null;
}
