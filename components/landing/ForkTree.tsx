import ForkTreeLines from "@/components/animations/ForkTreeLines";

export default function ForkTree() {
  return (
    <section className="wrap">
      <div className="section-head" data-reveal>
        <span className="kicker">Strategy, forked</span>
        <h2>Fork a strategy the way you&apos;d fork a repo.</h2>
        <p>
          Publish. Someone forks it, tunes the weights, ships their own
          version. The network graph is the product — every branch is a new
          Bag, every merge back is a royalty to the original creator.
        </p>
      </div>
      <div className="forktree-wrap" data-reveal>
        <div className="forktree-bar">
          <span className="fdot" style={{ background: "#FF5F57" }}></span>
          <span className="fdot" style={{ background: "#FEBC2E" }}></span>
          <span className="fdot" style={{ background: "#28C840" }}></span>
          <span style={{ marginLeft: 8 }}>fork-graph — bag:mag7</span>
        </div>
        <div className="forktree-svg-box">
          <ForkTreeLines />
          <svg
            id="forkSvg"
            viewBox="0 -24 900 324"
            width="100%"
            height="auto"
            xmlns="http://www.w3.org/2000/svg"
          >
            <g stroke="#D9B98B" strokeWidth="1.4" fill="none" opacity="0.45">
              <path className="ftline" d="M170,150 C 260,150 260,60 350,60" />
              <path className="ftline" d="M170,150 C 260,150 260,150 350,150" />
              <path className="ftline" d="M170,150 C 260,150 260,240 350,240" />
              <path className="ftline" d="M480,60 C 560,60 560,60 640,60" />
              <path className="ftline" d="M480,150 C 560,150 560,20 640,20" />
              <path className="ftline" d="M480,150 C 560,150 560,150 640,150" />
            </g>
            <g>
              <rect x="40" y="122" width="130" height="56" rx="10" fill="#D9B98B" />
              <text x="105" y="146" fill="#0A0805" fontSize="13" fontWeight="600" textAnchor="middle">
                bag:mag7
              </text>
              <text x="105" y="164" fill="#3A2F1E" fontSize="10.5" textAnchor="middle">
                TVL $2.3M
              </text>
            </g>
            <g>
              <rect x="350" y="32" width="130" height="56" rx="10" fill="#0D0D0D" stroke="#2A2620" />
              <text x="415" y="56" fill="#F6F3EC" fontSize="12.5" fontWeight="600" textAnchor="middle">
                mag7-v2
              </text>
              <text x="415" y="74" fill="#726C61" fontSize="10" textAnchor="middle">
                +38.4% · 12 forks
              </text>
            </g>
            <g>
              <rect x="350" y="122" width="130" height="56" rx="10" fill="#0D0D0D" stroke="#2A2620" />
              <text x="415" y="146" fill="#F6F3EC" fontSize="12.5" fontWeight="600" textAnchor="middle">
                mag7-highrisk
              </text>
              <text x="415" y="164" fill="#726C61" fontSize="10" textAnchor="middle">
                +61.2% · 8 forks
              </text>
            </g>
            <g>
              <rect x="350" y="212" width="130" height="56" rx="10" fill="#0D0D0D" stroke="#2A2620" />
              <text x="415" y="236" fill="#F6F3EC" fontSize="12.5" fontWeight="600" textAnchor="middle">
                mag7-asia
              </text>
              <text x="415" y="254" fill="#726C61" fontSize="10" textAnchor="middle">
                +19.7% · 5 forks
              </text>
            </g>
            <g>
              <rect x="640" y="-8" width="140" height="56" rx="10" fill="#15201A" stroke="#2C4239" />
              <text x="710" y="16" fill="#7FBFA3" fontSize="12" fontWeight="600" textAnchor="middle">
                v2-dividend
              </text>
              <text x="710" y="34" fill="#5C8C77" fontSize="9.5" textAnchor="middle">
                forked 3d ago
              </text>
            </g>
            <g>
              <rect x="640" y="122" width="140" height="56" rx="10" fill="#0D0D0D" stroke="#2A2620" />
              <text x="710" y="146" fill="#F6F3EC" fontSize="12" fontWeight="600" textAnchor="middle">
                v2-conservative
              </text>
              <text x="710" y="164" fill="#726C61" fontSize="9.5" textAnchor="middle">
                forked 6d ago
              </text>
            </g>
          </svg>
        </div>
        <div className="diagram-caption">
          <span>bag:mag7 → 3 forks shown → royalties flow back up the tree</span>
          <span>fig. 02 — fork lineage</span>
        </div>
      </div>
    </section>
  );
}
