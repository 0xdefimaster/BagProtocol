import Image from "next/image";
import Link from "next/link";
import ArrowIcon from "@/components/ui/ArrowIcon";
import { NAV_LINKS, APP_URL } from "@/lib/constants";

export default function Header() {
  return (
    <header>
      <div className="wrap nav">
        <Link href="/" className="brand">
          <Image src="/logo.png" alt="Bag Protocol mark" width={32} height={32} />
          <div className="brand-text">
            <span className="b1">BAG PROTOCOL</span>
            <span className="b2 mono">RFC&#8209;01 &middot; bag.json</span>
          </div>
        </Link>
        <nav className="navlinks">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        <Link className="btn btn-primary" href={APP_URL}>
          Launch Protocol
          <ArrowIcon size={14} />
        </Link>
      </div>
    </header>
  );
}
