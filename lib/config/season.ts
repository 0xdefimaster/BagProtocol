import { Season } from '@/types/domain';

// First season: 90 days, used to determine the first 20 users for
// Robinhood Chain mainnet Genesis / Early Access once that ships.
// UI should present this as an access tier, never as a financial guarantee.
export const GENESIS_SEASON: Season = {
  id: 'season-genesis-01',
  name: 'BAG Genesis Season 01',
  startDate: '2026-01-01T00:00:00.000Z',
  endDate: '2026-04-01T00:00:00.000Z',
  status: 'ACTIVE',
  topUsersReward: 20,
};

export const LEADERBOARD_TOP_N = 20;
