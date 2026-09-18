import Image from "next/image";

const FLYWHEEL_STEPS = [
  { title: "Publish", body: "A creator publishes a Bag as bag.json, pinned immutably to IPFS." },
  { title: "Discover", body: "Followers find it on Bag Studio, or any wallet reading the open standard." },
  { title: "Invest", body: "Real capital flows in — one click, deployed straight to a vault." },
  { title: "Fork", body: "Others copy the Bag, adjust the weights, and publish their own version." },
  {
    title: "Earn",
    body: "The original creator keeps earning — 1.5% of every deposit into a fork, plus a fee on profits.",
  },
  { title: "Compound", body: "More forks, more liquidity, more reasons for wallets to adopt the spec." },
];

export default function Flywheel() {
  return (
    <section id="flywheel" className="wrap">
      <div className="section-head" data-reveal>
        <span className="kicker">The creator economy</span>
        <h2>A strategy is a digital product now.</h2>
        <p>
          Publish it, gain followers, get forked, build reputation, earn
          revenue. One creator, one spec, every chain — liquidity is
          distributed, not winner-take-all, which is exactly why the standard
          compounds.
        </p>
      </div>

      <div className="cover-frame" data-reveal>
        <Image
          src="/hero/flywheel-cover.jpg"
          alt="Bag Protocol flow: creators publish a bag.json, the protocol routes it across chains, and investors follow in"
          width={1600}
          height={900}
          sizes="100vw"
          style={{ width: "100%", height: "auto" }}
        />
        <div className="cover-caption">
          <span>creators → bag.json → protocol → multi-chain vaults → investors</span>
          <span>fig. 01 — network flow</span>
        </div>
      </div>

      <div className="flywheel" data-reveal>
        {FLYWHEEL_STEPS.map((step) => (
          <div className="fwstep" key={step.title}>
            <h4>{step.title}</h4>
            <p>{step.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
