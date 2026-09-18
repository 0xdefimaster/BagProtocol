import Link from "next/link";
import ArrowIcon from "@/components/ui/ArrowIcon";
import { APP_URL } from "@/lib/constants";

export default function CTA() {
  return (
    <section className="wrap">
      <div className="cta" data-reveal>
        <div className="cta-inner">
          <h2>
            Publish a strategy. Get forked. <span className="hl-gold">Get paid.</span>
          </h2>
          <p>
            The GitHub of finance, with creator rewards built in. Bag Studio is
            only the first client — publish your first Bag, or fork one that
            already works.
          </p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            <Link className="btn btn-primary btn-lg" href={APP_URL}>
              Start Building
              <ArrowIcon />
            </Link>
            <a className="btn btn-ghost btn-lg" href="#rewards">
              See how creators earn
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
