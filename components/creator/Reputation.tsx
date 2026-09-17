interface ReputationProps {
  score: number; // 0-100
  size?: 'sm' | 'lg';
}

export function Reputation({ score, size = 'sm' }: ReputationProps) {
  const starCount = Math.round((score / 100) * 5);
  const stars = '★'.repeat(starCount) + '☆'.repeat(5 - starCount);

  return (
    <div className="reputation-row">
      <span className="reputation-stars" style={size === 'lg' ? { fontSize: 20 } : undefined}>
        {stars}
      </span>
      <span className="reputation-score">{score} Reputation</span>
    </div>
  );
}
