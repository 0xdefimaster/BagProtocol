export default function Philosophy() {
  return (
    <section id="philosophy" className="wrap">
      <div className="section-head" data-reveal>
        <span className="kicker">The missing layer</span>
        <h2>Assets are not enough.</h2>
        <p>
          Robinhood Chain tokenizes financial assets. Bag Protocol tokenizes
          investment strategies. Assets tell you what exists. Strategies tell
          you how to invest. One is the ledger. The other is the layer that
          was always missing.
        </p>
      </div>

      <div className="compare-grid" data-reveal>
        <div className="phase p0">
          <span className="tag">ROBINHOOD CHAIN</span>
          <h4>Tokenized assets</h4>
          <p>Stocks, funds, and real-world assets — represented onchain, ownable, transferable.</p>
        </div>
        <div className="phase p2">
          <span className="tag">BAG PROTOCOL</span>
          <h4>Tokenized strategies</h4>
          <p>Composition, rules, and thesis — published as a living object any wallet can read, invest in, or fork.</p>
        </div>
      </div>
    </section>
  );
}
