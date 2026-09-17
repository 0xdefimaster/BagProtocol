"use client";

import { useEffect } from "react";

/**
 * Mount once per page. Observes every [data-reveal] element and adds
 * an `in` class when it scrolls into view, matching the original
 * landing page's fade/slide-up reveal behavior.
 */
export default function ScrollReveal() {
  useEffect(() => {
    const revealEls = document.querySelectorAll("[data-reveal]");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    revealEls.forEach((el) => io.observe(el));

    return () => io.disconnect();
  }, []);

  return null;
}
