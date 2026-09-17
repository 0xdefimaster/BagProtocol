import { StrategyType } from './basket-protocol';

export interface Bag {
  id: string;
  name: string;
  creator: CreatorProfile;
  description: string;
  thesis: string;
  tvl: number;
  followers: number;
  forks: number;
  performance7d: number;
  performance30d: number;
  performanceYtd: number;
  chains: string[];
  composition: BagPosition[];
  category?: string;
  /**
   * What kind of strategy this Bag is — mirrors
   * `BasketRecipe.strategyType` (types/basket-protocol.ts). Optional
   * because plenty of existing mock/local `Bag`s (lib/mock-data.ts,
   * lib/user-bags-store.ts's offline fallback) were built before this
   * field existed and never set it; every UI reading it must fall back to
   * `'STATIC_BASKET'` rather than assume it's present. `'STATIC_BASKET'`
   * is the only value that exists today — see `STRATEGY_TYPES` in
   * types/basket-protocol.ts.
   */
  strategyType?: StrategyType;
  rules: {
    rebalanceFrequency: string;
    slippage: number;
    minInvestment: number;
  };
  social: { followers: number; forks: number };
  performance: { returnsYTD: number };
  updateLog: UpdateLog[];
}

export interface BagPosition {
  symbol: string;
  weight: number;
}

export interface UpdateLog {
  date: string;
  change: string;
  reason: string;
}

export interface CreatorProfile {
  id?: string;
  name: string;
  handle?: string;
  avatar: string;
  address: string;
  verified?: boolean;
  creatorScore?: number;
  followers: number;
  tvl?: string;
  forks: number;
  winningChallenges?: number;
  status?: string;
}

export interface User {
  address: string;
  balance: number;
  network: string;
  myBags: number;
  following: number;
  followers: number;
  forks: number;
  joinedAt: string; // ISO date
  reputation: number; // 0-100
}
