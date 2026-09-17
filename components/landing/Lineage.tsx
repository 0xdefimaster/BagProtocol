const LINEAGE_NODES = [
  { yr: "'15", title: "ERC-20", body: "Token standard. Every wallet and DEX reads it." },
  { yr: "'17", title: "ENS", body: "Identity standard. Moat is adoption, not features." },
  { yr: "'18", title: "ERC-721", body: "NFT standard. Defined the spec, not the marketplace." },
  {
    yr: "'26",
    title: "Bag Protocol",
    body: "Portfolio standard. The moat is the format itself.",
    final: true,
  },
];

export default function Lineage() {
  return (
    <section id="lineage" className="wrap">
      <div className="section-head" data-reveal>
        <span className="kicker">Standards win</span>
        <h2>Every era of crypto has one defining spec.</h2>
        <p>
          The winner is never the first app — it&apos;s whoever defines the format
          everyone else builds on.
        </p>
      </div>
      <div className="lineage" data-reveal>
        {LINEAGE_NODES.map((node) => (
          <div className={`lnode${node.final ? " final" : ""}`} key={node.title}>
            <div className="yr">{node.yr}</div>
            <h4>{node.title}</h4>
            <p>{node.body}</p>
          </div>
        ))}
      </div>

      <div className="reasons" data-reveal style={{ marginTop: 32 }}>
        {["Wallets", "DEXs", "Launchpads", "AI Agents", "Robo Advisors", "Portfolio Apps", "Robinhood Chain"].map(
          (node, i) => (
            <span className="reason-chip" key={node}>
              <span className="n">{i + 1}</span>
              {node}
            </span>
          )
        )}
      </div>
      <p className="path-caption">Every client on this list reads the same bag.json. That&apos;s the moat.</p>
    </section>
  );
}
