// Shared compact-money formatter - split out (Stage 4 review) so App.js's
// mini-card chips and StrategyGrid.js's flagged-projects table don't keep
// their own copies that can drift out of sync.
//
// Cards/labels are tiny - full dollar amounts don't fit, so this trades
// precision for width the same way a stock ticker does.
export function formatCompactMoney(n) {
  const v = Number(n) || 0;
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(abs >= 10000000 ? 0 : 1)}M`;
  if (abs >= 1000) return `${sign}$${Math.round(abs / 1000)}K`;
  return `${sign}$${Math.round(abs)}`;
}
