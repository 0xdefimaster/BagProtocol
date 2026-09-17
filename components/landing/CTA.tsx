import Link from "next/link";
import ArrowIcon from "@/components/ui/ArrowIcon";
import { APP_URL } from "@/lib/constants";

export default function CTA() {
  return (
    <section className="wrap">
      <div className="cta" data-reveal>
        <div className="cta-inner">
          <h2>The protocol is the product.</h2>
          <p>
            Bag Studio is only the first client. Publish your first Bag, or
            explore what the community has already built on the standard.
          </p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            <Link className="btn btn-primary btn-lg" href={APP_URL}>
              Start Building
              <ArrowIcon />
            </Link>
            <a className="btn btn-ghost btn-lg" href="#creators">
              Explore Strategies
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
