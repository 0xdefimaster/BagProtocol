const PHASES = [
  {
    cls: "p0",
    tag: "PHASE 0 · WK 1",
    title: "RFC Definition",
    body: "bag.json spec published, 20 official Bags, wallet feedback.",
  },
  {
    cls: "p1",
    tag: "PHASE 1 · WK 2–4",
    title: "Bag Studio MVP",
    body: "Explore, follow, invest, fork — plus X creator identity & share cards.",
  },
  {
    cls: "p2",
    tag: "PHASE 2",
    title: "Discovery Layer",
    body: "Bag Pages, explorer, verified creators, OpenGraph cards.",
  },
  {
    cls: "p3",
    tag: "PHASE 3",
    title: "Reputation & SDK",
    body: "On-chain reputation, time machine, live diff, public SDK.",
  },
];

export default function Roadmap() {
  return (
    <section id="roadmap" className="wrap">
      <div className="section-head" data-reveal>
        <span className="kicker">Roadmap</span>
        <h2>Scope-locked, RFC-first.</h2>
        <p>
          Six weeks to RFC and MVP. Everything else is sequenced deliberately,
          so nothing delays the standard shipping.
        </p>
      </div>
      <div className="phases" data-reveal>
        {PHASES.map((phase) => (
          <div className={`phase ${phase.cls}`} key={phase.title}>
            <span className="tag">{phase.tag}</span>
            <h4>{phase.title}</h4>
            <p>{phase.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
