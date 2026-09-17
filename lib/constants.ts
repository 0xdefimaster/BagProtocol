export const NAV_LINKS = [
  { href: "#spec", label: "Spec" },
  { href: "#dna", label: "Strategy DNA" },
  { href: "#lineage", label: "Standard" },
  { href: "#flywheel", label: "How it works" },
  { href: "#creators", label: "Creators" },
  { href: "#roadmap", label: "Roadmap" },
] as const;

// Internal dashboard entry point (the "Launch App" / "Launch Protocol" CTA).
export const APP_URL = "/dashboard";

export interface NetworkOption {
  id: string;
  label: string;
  color: string;
  glyph: string;
}

// Deployment targets selectable when publishing a Bag.
export const NETWORKS: NetworkOption[] = [
  { id: "ethereum", label: "Ethereum", color: "#627EEA", glyph: "Ξ" },
  { id: "base", label: "Base", color: "#0052FF", glyph: "🔵" },
  { id: "arbitrum", label: "Arbitrum", color: "#28A0F0", glyph: "🔷" },
  { id: "robinhood", label: "Robinhood Chain", color: "#00C805", glyph: "🪶" },
];
