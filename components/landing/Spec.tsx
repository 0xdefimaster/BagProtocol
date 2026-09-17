const SPEC_POINTS = [
  {
    title: "Chain-agnostic",
    body: "Same spec resolves on Base, Arbitrum, Ethereum, and Solana.",
  },
  {
    title: "Wallet-readable",
    body: "Phantom, Backpack, and Coinbase Wallet parse it natively — no custom integration.",
  },
  {
    title: "Fork-trackable",
    body: "Parent/child lineage is recorded on-chain, so royalties flow back to the original creator.",
  },
  {
    title: "Versioned & immutable",
    body: "Every edit is a new IPFS hash — the full history stays inspectable, forever.",
  },
];

export default function Spec() {
  return (
    <section id="spec" className="wrap">
      <div className="section-head" data-reveal>
        <span className="kicker">RFC v1.0 &middot; Infrastructure, not an app</span>
        <h2>One spec. Every chain, every wallet.</h2>
        <p>
          A Bag is not a vault — it&apos;s strategy, portfolio, rules, and social
          history, published immutably as <span className="mono">bag.json</span> on
          IPFS. Bag Protocol is an open protocol first. The app you&apos;re
          reading this on is only the first client built on it.
        </p>
      </div>
      <div className="spec-grid" data-reveal>
        <div className="spec-points">
          {SPEC_POINTS.map((point) => (
            <div className="spec-point" key={point.title}>
              <div className="ico">✓</div>
              <div>
                <h4>{point.title}</h4>
                <p>{point.body}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="code-card">
          <div className="code-bar">
            <div className="code-tabs">
              <span className="code-tab">composition</span>
              <span className="code-tab active">bag.json</span>
              <span className="code-tab">thesis</span>
            </div>
            <div className="code-dots">
              <span style={{ background: "#FF5F57" }}></span>
              <span style={{ background: "#FEBC2E" }}></span>
              <span style={{ background: "#28C840" }}></span>
            </div>
          </div>
          <pre className="code">
            {"{\n"}
            {"  "}
            <span className="tok-key">&quot;name&quot;</span>
            <span className="tok-punc">:</span>{" "}
            <span className="tok-str">&quot;AI Bag&quot;</span>
            <span className="tok-punc">,</span>
            {"\n  "}
            <span className="tok-key">&quot;creator&quot;</span>
            <span className="tok-punc">:</span>{" "}
            <span className="tok-str">&quot;0xabc123...&quot;</span>
            <span className="tok-punc">,</span>
            {"\n  "}
            <span className="tok-key">&quot;composition&quot;</span>
            <span className="tok-punc">:</span> {"["}
            {"\n    { "}
            <span className="tok-key">&quot;symbol&quot;</span>
            <span className="tok-punc">:</span>{" "}
            <span className="tok-str">&quot;NVIDIA&quot;</span>
            <span className="tok-punc">,</span>{" "}
            <span className="tok-key">&quot;weight&quot;</span>
            <span className="tok-punc">:</span> <span className="tok-num">40</span>
            {" }"}
            <span className="tok-punc">,</span>
            {"\n    { "}
            <span className="tok-key">&quot;symbol&quot;</span>
            <span className="tok-punc">:</span>{" "}
            <span className="tok-str">&quot;MSFT&quot;</span>
            <span className="tok-punc">,</span>{"   "}
            <span className="tok-key">&quot;weight&quot;</span>
            <span className="tok-punc">:</span> <span className="tok-num">30</span>
            {" }"}
            <span className="tok-punc">,</span>
            {"\n    { "}
            <span className="tok-key">&quot;symbol&quot;</span>
            <span className="tok-punc">:</span>{" "}
            <span className="tok-str">&quot;TSLA&quot;</span>
            <span className="tok-punc">,</span>{"   "}
            <span className="tok-key">&quot;weight&quot;</span>
            <span className="tok-punc">:</span> <span className="tok-num">30</span>
            {" }\n  ]"}
            <span className="tok-punc">,</span>
            {"\n  "}
            <span className="tok-key">&quot;social&quot;</span>
            <span className="tok-punc">:</span> {"{ "}
            <span className="tok-key">&quot;followers&quot;</span>
            <span className="tok-punc">:</span> <span className="tok-num">1200</span>
            <span className="tok-punc">,</span>{" "}
            <span className="tok-key">&quot;forks&quot;</span>
            <span className="tok-punc">:</span> <span className="tok-num">45</span>
            {" }"}
            <span className="tok-punc">,</span>
            {"\n  "}
            <span className="tok-comment">{"// immutable — pinned to IPFS"}</span>
            {"\n  "}
            <span className="tok-key">&quot;performance&quot;</span>
            <span className="tok-punc">:</span> {"{ "}
            <span className="tok-key">&quot;returnsYTD&quot;</span>
            <span className="tok-punc">:</span>{" "}
            <span className="tok-num">28.5</span>
            {" }"}
            {"\n}"}
          </pre>
        </div>
      </div>
      <div className="reasons" data-reveal style={{ marginTop: 28 }}>
        {["createBag()", "publishBag()", "forkBag()", "executeBag()", "simulateBag()"].map((fn) => (
          <span className="reason-chip mono" key={fn}>
            {fn}
          </span>
        ))}
      </div>
    </section>
  );
}
