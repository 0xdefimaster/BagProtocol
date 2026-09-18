import { GitFork, TrendingUp, ShieldCheck, Ban, Percent, Users } from "lucide-react";

// Rates mirror the protocol config: FORK_ROYALTY_BPS = 150 (lib/config/rewards.ts)
// and MAX_PERFORMANCE_FEE_BPS = 3000 (types/basket-protocol.ts).
const STEPS = [
  {
    icon: GitFork,
    title: "Someone forks your Bag",
    body: "They copy it, retune the weights, and publish their own version. Your Bag stays the root of the tree.",
  },
  {
    icon: Users,
    title: "Money goes into the fork",
    body: "1.5% of every deposit is credited to you, the root creator — at deposit time, no claim form, no negotiation.",
  },
  {
    icon: TrendingUp,
    title: "Depositors redeem in profit",
    body: "The Bag's creator earns their performance fee on the realized gain. If it's a loss, nobody pays a fee.",
  },
];

const GUARANTEES = [
  { icon: ShieldCheck, label: "Fee only on profit, never on losses" },
  { icon: Percent, label: "Fee capped at 30%" },
  { icon: GitFork, label: "Flat 1.5% royalty on every Bag" },
  { icon: Ban, label: "No royalty on self-deposits" },
];

export default function CreatorRewards() {
  return (
    <section id="rewards" className="wrap">
      <div className="section-head" data-reveal>
        <span className="kicker">Creator rewards</span>
        <h2>
          Fork it. The original creator <span className="hl-gold">gets paid.</span>
        </h2>
        <p>
          On GitHub you earn stars. On Bag Protocol you earn money. Every time
          capital moves through a Bag you built — or through a fork of it — a
          slice comes back to you automatically. Build the best strategy once,
          and keep earning as it spreads.
        </p>
      </div>

      {/* ---- the two rewards, big numbers ---- */}
      <div className="reward-cards" data-reveal>
        <div className="reward-card hot">
          <span className="rc-tag mono">FORK ROYALTY</span>
          <div className="rc-num">1.5%</div>
          <h4>of every deposit into a fork of your Bag</h4>
          <p>
            Credited to the root creator the moment a deposit lands. It&apos;s a
            flat, protocol-wide rate — simple to reason about and easy to
            audit. Forks of forks still point back to you.
          </p>
        </div>
        <div className="reward-card">
          <span className="rc-tag mono">PERFORMANCE FEE</span>
          <div className="rc-num">0–30%</div>
          <h4>of realized profit, set by you</h4>
          <p>
            Charged only when a depositor redeems with a gain, on that gain
            only. Losses never pay a fee, so your incentive is the same as your
            followers&apos;: make money.
          </p>
        </div>
      </div>

      {/* ---- how it flows + example ledger ---- */}
      <div className="reward-grid" data-reveal>
        <div className="spec-points">
          {STEPS.map((s, i) => (
            <div className="spec-point" key={s.title}>
              <div className="ico">
                <s.icon size={16} />
              </div>
              <div>
                <h4>
                  <span className="mono step-n">{String(i + 1).padStart(2, "0")}</span>
                  {s.title}
                </h4>
                <p>{s.body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="ledger-card">
          <div className="code-bar">
            <div className="code-tabs">
              <span className="code-tab active">rewards.ledger</span>
              <span className="code-tab">@bagcollectorxbt</span>
            </div>
            <div className="code-dots">
              <span style={{ background: "#FF5F57" }}></span>
              <span style={{ background: "#FEBC2E" }}></span>
              <span style={{ background: "#28C840" }}></span>
            </div>
          </div>
          <div className="ledger-body mono">
            <div className="ledger-row">
              <span className="lg-amt">+ $150.00</span>
              <span className="lg-type">FORK_ROYALTY</span>
              <span className="lg-desc">
                $10,000 deposit into{" "}
                <span className="nw">ai-growth-v2</span>, a fork of your Bag
              </span>
            </div>
            <div className="ledger-row">
              <span className="lg-amt">+ $400.00</span>
              <span className="lg-type">PERFORMANCE_FEE</span>
              <span className="lg-desc">
                $2,000 realized profit from{" "}
                <span className="nw">ai-growth-bag</span> × 20% fee
              </span>
            </div>
            <div className="ledger-row total">
              <span className="lg-amt">= $550.00</span>
              <span className="lg-type">EARNED</span>
              <span className="lg-desc">without touching your strategy</span>
            </div>
          </div>
          <div className="ledger-foot">
            Illustrative example. The fee percentage is set per Bag by its
            creator (max 30%); the 1.5% royalty is fixed.
          </div>
        </div>
      </div>

      {/* ---- trust chips: only things the protocol actually enforces ---- */}
      <div className="reasons guarantees" data-reveal>
        {GUARANTEES.map((g) => (
          <span className="reason-chip guarantee" key={g.label}>
            <g.icon size={14} />
            {g.label}
          </span>
        ))}
      </div>
    </section>
  );
}
