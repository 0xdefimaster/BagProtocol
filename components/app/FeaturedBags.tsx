'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { mockBags } from '@/lib/mock-data';
import { BagCard } from '../bags/BagCard';

const CATEGORIES = ['All', 'AI', 'DeFi', 'RWA', 'Memes', 'Stable', 'L2'];

export function FeaturedBags() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');

  const bags = useMemo(() => {
    return mockBags.filter((bag) => {
      const matchesQuery = bag.name.toLowerCase().includes(query.toLowerCase());
      const matchesCategory = category === 'All' || bag.category === category;
      return matchesQuery && matchesCategory;
    });
  }, [query, category]);

  return (
    <div>
      <span className="section-label">Featured Bags</span>

      <div className="search-row">
        <div className="search-input-wrap">
          <Search size={17} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Bags..."
            className="search-input"
          />
        </div>

        <div className="chip-row">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`chip ${category === cat ? 'active' : ''}`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {bags.length > 0 ? (
        <div className="bag-grid">
          {bags.map((bag) => (
            <BagCard key={bag.id} bag={bag} />
          ))}
        </div>
      ) : (
        <p style={{ color: 'var(--ink-soft)', fontSize: 13.5, marginTop: 24 }}>
          No bags match &quot;{query}&quot; in {category === 'All' ? 'any category' : category}.
        </p>
      )}
    </div>
  );
}
