import { NETWORKS } from '@/lib/constants';
import { Check } from 'lucide-react';

interface NetworkSelectorProps {
  selected: string[];
  onToggle: (networkId: string) => void;
}

export function NetworkSelector({ selected, onToggle }: NetworkSelectorProps) {
  return (
    <div className="network-grid">
      {NETWORKS.map((net) => {
        const active = selected.includes(net.id);
        return (
          <button
            type="button"
            key={net.id}
            onClick={() => onToggle(net.id)}
            className={`network-chip ${active ? 'active' : ''}`}
            style={active ? { borderColor: net.color, background: `${net.color}1A` } : undefined}
          >
            <span className="network-glyph" style={{ color: net.color }}>
              {net.glyph}
            </span>
            <span className="network-label">{net.label}</span>
            {active && <Check size={14} className="network-check" style={{ color: net.color }} />}
          </button>
        );
      })}
    </div>
  );
}
