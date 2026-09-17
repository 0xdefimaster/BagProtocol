'use client';

import { useCallback, useEffect, useState } from 'react';
import { UserPoints, PointTransaction, Season } from '@/types/domain';
import { GENESIS_SEASON } from '@/lib/config/season';
import { useCurrentUserId } from './useCurrentUserId';

export function usePoints() {
  const { isAuthenticated } = useCurrentUserId();
  const [season, setSeason] = useState<Season>(GENESIS_SEASON);
  const [points, setPoints] = useState<UserPoints | null>(null);
  const [transactions, setTransactions] = useState<PointTransaction[]>([]);

  const refresh = useCallback(() => {
    if (!isAuthenticated) {
      setPoints(null);
      setTransactions([]);
      return;
    }
    fetch('/api/points')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { season: Season; points: UserPoints; transactions: PointTransaction[] } | null) => {
        if (!data) return;
        setSeason(data.season);
        setPoints(data.points);
        setTransactions(data.transactions);
      })
      .catch(() => {});
  }, [isAuthenticated]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { season, points, transactions, refresh };
}
