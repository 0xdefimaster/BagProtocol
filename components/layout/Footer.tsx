import Link from "next/link";
import { APP_URL } from "@/lib/constants";

export default function Footer() {
  return (
    <footer>
      <div className="wrap foot-row">
        <span className="foot-mono">bag.json &middot; RFC-01 &middot; © 2026 Bag Protocol</span>
        <div className="foot-links">
          <a href="#github-for-finance">GitHub for Finance</a>
          <a href="#rewards">Creator Rewards</a>
          <a href="#spec">Spec</a>
          <a href="#roadmap">Roadmap</a>
          <Link href={APP_URL}>Launch App</Link>
        </div>
      </div>
    </footer>
  );
}
