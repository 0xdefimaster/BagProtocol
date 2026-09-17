const DNA_TRAITS = [
  { cls: "p0", tag: "RISK", title: "Risk Score", body: "Drawdown-weighted, computed from live composition — not self-reported." },
  { cls: "p1", tag: "SPREAD", title: "Diversification", body: "How concentrated the Bag is across assets, sectors, and chains." },
  { cls: "p2", tag: "THESIS", title: "AI Exposure", body: "Share of the portfolio tied to AI infrastructure, models, and compute." },
  { cls: "p3", tag: "SIGNAL", title: "Volatility", body: "30-day realized volatility of the underlying composition." },
  { cls: "p0", tag: "TREND", title: "Momentum", body: "Rate of change in performance — accelerating, flat, or fading." },
  { cls: "p2", tag: "PROFILE", title: "Style", body: "Growth, value, income, or momentum — the strategy's fingerprint." },
];

export default function StrategyDNA() {
  return (
    <section id="dna" className="wrap">
      <div className="section-head" data-reveal>
        <span className="kicker">Strategy DNA</span>
        <h2>Every Bag has a fingerprint.</h2>
        <p>
          Not just what a strategy holds — how it behaves. Strategy DNA is
          computed live from composition, not claimed by the creator.
        </p>
      </div>
      <div className="phases" data-reveal>
        {DNA_TRAITS.map((trait) => (
          <div className={`phase ${trait.cls}`} key={trait.title}>
            <span className="tag">{trait.tag}</span>
            <h4>{trait.title}</h4>
            <p>{trait.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
