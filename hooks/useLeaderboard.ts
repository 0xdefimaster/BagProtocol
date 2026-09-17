'use client';

import { useCallback, useEffect, useState } from 'react';
import { LeaderboardResult } from '@/types/domain';

export function useLeaderboard() {
  const [result, setResult] = useState<LeaderboardResult | null>(null);

  const refresh = useCallback(() => {
    fetch('/api/leaderboard')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { result: LeaderboardResult } | null) => {
        if (data) setResult(data.result);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { result, refresh };
}
