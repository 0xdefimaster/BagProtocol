const REASONS = [
  "Earn followers",
  "Build an on-chain reputation",
  "Earn protocol rewards",
  "Become a trusted allocator",
  "Attract capital",
  "Get verified",
  "Become an official creator",
];

const PATH_STEPS = [
  { n: "01", label: "Create" },
  { n: "02", label: "Followers" },
  { n: "03", label: "Capital" },
  { n: "04", label: "Track Record" },
  { n: "05", label: "Trust Score" },
  { n: "06", label: "Verified" },
  { n: "07", label: "Official Creator" },
  { n: "08", label: "Protocol Revenue", hi: true },
];

const STATS = [
  { label: "Creator Score", value: "96", accent: true },
  { label: "Followers", value: "12,400" },
  { label: "TVL", value: "$4.2M" },
  { label: "Forks", value: "182" },
  { label: "Winning Challenges", value: "14" },
  { label: "Status", value: "Top 1%", accent: true },
];

export default function Creators() {
  return (
    <section id="creators" className="wrap">
      <div className="section-head" data-reveal>
        <span className="kicker">A living strategy object</span>
        <h2>Why spend ten hours on the best AI Bag?</h2>
        <p>
          A Bag isn&apos;t static. It carries a creator, a version, a risk
          profile, a fork history, live performance, and followers — all
          attached to the object itself. This is what a creator actually gets
          for publishing one.
        </p>
      </div>

      <div data-reveal>
        <div className="reasons">
          {REASONS.map((reason, i) => (
            <span className="reason-chip" key={reason}>
              <span className="n">{i + 1}</span>
              {reason}
            </span>
          ))}
        </div>
      </div>

      <div className="path-scroll" data-reveal>
        <div className="creator-path">
          {PATH_STEPS.map((step, i) => (
            <div key={step.label} style={{ display: "contents" }}>
              <div className={`path-step${step.hi ? " hi" : ""}`}>
                <div className="pn">{step.n}</div>
                <h5>{step.label}</h5>
              </div>
              {i < PATH_STEPS.length - 1 && <div className="path-arrow">→</div>}
            </div>
          ))}
        </div>
      </div>
      <p className="path-caption">
        Capital and Track Record already exist in Phase 1. Trust Score,
        Verified, and Official Creator are the Phase 2/3 Reputation Layer
        already on the roadmap — this is that same chain, named as a single
        path.
      </p>

      <div className="creator-card" data-reveal>
        <div className="creator-card-head">
          <div className="cc-id">
            <div className="cc-avatar"></div>
            <div>
              <div className="cc-name">AI Growth Bag</div>
              <div className="cc-handle">@bagcollectorxbt</div>
            </div>
          </div>
          <span className="cc-badge">✓ Verified Creator · Top 1%</span>
        </div>
        <div className="stat-grid">
          {STATS.map((stat) => (
            <div className="stat-item" key={stat.label}>
              <span className="sl">{stat.label}</span>
              <span className={`sv${stat.accent ? " accent" : ""}`}>{stat.value}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="why-note" data-reveal>
        <b>Why this works:</b> the same instinct that drives open-source
        contribution — seeing a profile like this and thinking &quot;I want
        that&quot; — is the real answer to why someone builds a great Bag.
        Every field on this card already exists in the spec or the roadmap;
        nothing here is new engineering.
      </div>
    </section>
  );
}
