import Image from "next/image";
import Link from "next/link";
import ArrowIcon from "@/components/ui/ArrowIcon";
import { APP_URL } from "@/lib/constants";

export default function Hero() {
  return (
    <section className="hero wrap">
      <div className="hero-grid">
        <div>
          <span className="eyebrow">
            <span className="dot"></span>BUILT FOR ROBINHOOD CHAIN
          </span>
          <h1>
            The strategy layer
            <br />
            for <span className="accent">Robinhood Chain.</span>
          </h1>
          <p className="lead">
            Robinhood Chain tokenizes assets. Bag Protocol tokenizes the
            strategies that move them — create, publish, fork, and execute
            investment strategies as reusable onchain objects. Built for
            Robinhood Chain. Future-proof for every chain.
          </p>
          <div className="hero-ctas">
            <Link className="btn btn-primary btn-lg" href={APP_URL}>
              Start Building
              <ArrowIcon />
            </Link>
            <a className="btn btn-ghost btn-lg" href="#spec">
              Explore Strategies →
            </a>
          </div>
          <span className="hero-sub">
            {"// assets "}<span className="accent">→</span> strategy{" "}
            <span className="accent">→</span> execution{" "}
            <span className="accent">→</span> portfolio
          </span>
        </div>
        <div className="mark-stage" data-reveal>
          <div className="ring r2"></div>
          <div className="ring r1"></div>
          <div className="mark-glow"></div>
          <Image
            src="/hero/glass-mark.jpg"
            alt="Bag Protocol glass mark — assets become a living strategy"
            width={220}
            height={220}
          />
        </div>
      </div>
    </section>
  );
}
