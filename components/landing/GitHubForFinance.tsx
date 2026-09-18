import { Star, GitFork, ArrowRight, Coins } from "lucide-react";

// Every row maps a concept developers already know to the thing that does
// the same job in Bag Protocol. Only real mechanics are listed here.
const MAP = [
  { gh: "Repository", bag: "Bag", note: "one portable bag.json" },
  { gh: "Commit", bag: "New version", note: "every edit is a new IPFS hash" },
  { gh: "Fork", bag: "Fork Bag", note: "copy it, retune it, publish your own — lineage is kept" },
  { gh: "Star / Watch", bag: "Follow", note: "followers travel with the Bag" },
  { gh: "README", bag: "Thesis", note: "the reasoning behind the strategy" },
  { gh: "Contribution graph", bag: "Track record", note: "live performance and creator score" },
  {
    gh: "Sponsors",
    bag: "Creator rewards",
    note: "1.5% of every fork deposit, plus a fee on profits — paid automatically",
    hot: true,
  },
];

const FILES = [
  { name: "composition", msg: "NVDA 40 · MSFT 30 · TSLA 30", when: "3d ago" },
  { name: "rules", msg: "rebalance, slippage, limits", when: "3d ago" },
  { name: "thesis", msg: "AI infrastructure, models, compute", when: "2w ago" },
  { name: "performance", msg: "+28.5% YTD · live", when: "now" },
  { name: "creator", msg: "0xabc123… · score 96 · verified", when: "—" },
];

export default function GitHubForFinance() {
  return (
    <section id="github-for-finance" className="wrap">
      <div className="section-head" data-reveal>
        <span className="kicker">The GitHub of Finance</span>
        <h2>
          Every strategy is a <span className="hl-gold">repo.</span> Fork it,
          follow it, ship your own.
        </h2>
        <p>
          Code got better when it became forkable. Strategies are next. Publish
          a Bag once and anyone can read it, follow it, fork it, and improve it
          — and the original creator keeps earning from every fork.
        </p>
      </div>

      <div className="gh-grid" data-reveal>
        {/* ---- a Bag, rendered like a repo page ---- */}
        <div className="repo-card">
          <div className="repo-bar">
            <span className="fdot" style={{ background: "#FF5F57" }}></span>
            <span className="fdot" style={{ background: "#FEBC2E" }}></span>
            <span className="fdot" style={{ background: "#28C840" }}></span>
            <span style={{ marginLeft: 8 }}>bag — ai-growth-bag</span>
          </div>

          <div className="repo-top">
            <div className="repo-title">
              <span className="repo-owner mono">@bagcollectorxbt /</span>
              <b>ai-growth-bag</b>
              <span className="repo-pill">Public</span>
            </div>
            <div className="repo-actions">
              <span className="repo-btn">
                <Star size={13} /> Follow <em>12,400</em>
              </span>
              <span className="repo-btn hot">
                <GitFork size={13} /> Fork <em>182</em>
              </span>
            </div>
          </div>

          <div className="repo-files">
            {FILES.map((f) => (
              <div className="repo-file" key={f.name}>
                <span className="rf-name mono">{f.name}</span>
                <span className="rf-msg">{f.msg}</span>
                <span className="rf-when mono">{f.when}</span>
              </div>
            ))}
          </div>

          <a className="repo-foot" href="#rewards">
            <Coins size={15} />
            <span>
              <b>182 forks</b> — every deposit into a fork sends{" "}
              <b>1.5%</b> back to the original creator.
            </span>
            <ArrowRight size={14} />
          </a>
        </div>

        {/* ---- GitHub concept -> Bag Protocol concept ---- */}
        <div className="gh-map">
          <div className="gh-map-head mono">
            <span>On GitHub</span>
            <span></span>
            <span>On Bag Protocol</span>
          </div>
          {MAP.map((row) => {
            const inner = (
              <>
                <span className="gm-gh">{row.gh}</span>
                <span className="gm-arrow">→</span>
                <span className="gm-bag">
                  <b>{row.bag}</b>
                  <small>{row.note}</small>
                </span>
              </>
            );
            return row.hot ? (
              <a className="gh-map-row hot" href="#rewards" key={row.gh}>
                {inner}
              </a>
            ) : (
              <div className="gh-map-row" key={row.gh}>
                {inner}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
