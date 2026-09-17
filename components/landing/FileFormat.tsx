export default function FileFormat() {
  return (
    <section className="wrap">
      <div className="section-head" data-reveal>
        <span className="kicker">The missing format</span>
        <h2>Finance has never had a shareable file.</h2>
        <p>
          People share a PDF. Share a CSV. Share a PNG. Share a GitHub repo.
          Nobody can share a portfolio — until now.
        </p>
      </div>
      <div className="filerow" data-reveal>
        <div className="filecard">
          <div className="glyph">📄</div>
          <div className="ext">.pdf</div>
        </div>
        <span className="arrow-between">+</span>
        <div className="filecard">
          <div className="glyph">📊</div>
          <div className="ext">.csv</div>
        </div>
        <span className="arrow-between">+</span>
        <div className="filecard">
          <div className="glyph">🖼️</div>
          <div className="ext">.png</div>
        </div>
        <span className="arrow-between">→</span>
        <div className="filecard hi">
          <div className="glyph">👜</div>
          <div className="ext">.bag</div>
        </div>
      </div>
    </section>
  );
}
