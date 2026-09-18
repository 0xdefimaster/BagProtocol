import Image from "next/image";
import Link from "next/link";
import { GitFork, Coins } from "lucide-react";
import ArrowIcon from "@/components/ui/ArrowIcon";
import { APP_URL } from "@/lib/constants";

export default function Hero() {
  return (
    <section className="hero wrap">
      <div className="hero-grid">
        <div>
          <div className="hero-tags">
            <span className="eyebrow">
              <span className="dot"></span>BUILT FOR ROBINHOOD CHAIN
            </span>
            <span className="eyebrow eyebrow-hot">
              <GitFork size={12} />THE GITHUB OF FINANCE
            </span>
          </div>
          <h1>
            The strategy layer
            <br />
            for <span className="accent">Robinhood Chain.</span>
          </h1>
          <p className="lead">
            Robinhood Chain tokenizes assets. Bag Protocol tokenizes the
            strategies that move them — publish a strategy as{" "}
            <span className="mono">bag.json</span>, and anyone can inspect it,
            fork it, tune it, and ship their own version, the same way
            developers fork a GitHub repo.{" "}
            <strong className="hl">
              And every time a fork attracts capital, the original creator
              gets paid.
            </strong>{" "}
            Built for Robinhood Chain. Future-proof for every chain.
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
          <div className="hero-pillars">
            <a className="pillar" href="#github-for-finance">
              <span className="pi">
                <GitFork size={16} />
              </span>
              <span>
                <b>GitHub for finance</b>
                <small>Publish · fork · follow · version. Every strategy is a repo.</small>
              </span>
            </a>
            <a className="pillar hot" href="#rewards">
              <span className="pi">
                <Coins size={16} />
              </span>
              <span>
                <b>Creator rewards</b>
                <small>1.5% of every fork deposit, plus a fee on profits.</small>
              </span>
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
            src="/hero/glass-mark.png"
            alt="Bag Protocol glass mark — assets become a living strategy"
            width={220}
            height={220}
          />
        </div>
      </div>
    </section>
  );
}
