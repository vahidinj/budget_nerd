import React, { useMemo } from 'react';

interface SummaryCardProps {
  transactions?: any[];
  filteredTransactions?: any[];
  dateStart?: string;
  dateEnd?: string;
}

export const SummaryCard: React.FC<SummaryCardProps> = ({
  transactions = [],
  filteredTransactions = [],
  dateStart,
  dateEnd,
}) => {
  const stats = useMemo(() => {
    const txns = filteredTransactions.length > 0 ? filteredTransactions : transactions;
    if (!txns.length) return null;

    const inflows = txns
      .filter(t => (t.amount || 0) > 0)
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    
    const outflows = txns
      .filter(t => (t.amount || 0) < 0)
      .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);

    const net = inflows - outflows;
    const savingsRate = inflows > 0 ? Math.round((net / inflows) * 100) : 0;
    const avgDaily = txns.length > 0 ? Math.abs(net / txns.length) : 0;

    return { inflows, outflows, net, savingsRate, avgDaily, count: txns.length };
  }, [transactions, filteredTransactions]);

  if (!stats) {
    return null;
  }

  const formatCurrency = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const periodLabel = dateStart && dateEnd ? `${dateStart} to ${dateEnd}` : 'Full Dataset';
  const netColor = stats.net >= 0 ? '#5ad67d' : '#ff6b6b';

  return (
    <div className="summary-card">
      <div className="summary-header">
        <h3 className="summary-title">Financial Summary</h3>
        <span className="summary-period">{periodLabel}</span>
      </div>
      <div className="summary-grid">
        <div className="summary-item inflow">
          <span className="summary-label">Total In</span>
          <span className="summary-value">${formatCurrency(stats.inflows)}</span>
          <span className="summary-count">{stats.count} transactions</span>
        </div>
        <div className="summary-item outflow">
          <span className="summary-label">Total Out</span>
          <span className="summary-value">${formatCurrency(stats.outflows)}</span>
          <span className="summary-trend">spending</span>
        </div>
        <div className="summary-item net">
          <span className="summary-label">Net Change</span>
          <span className="summary-value" style={{ color: netColor }}>
            {stats.net >= 0 ? '+' : ''}${formatCurrency(Math.abs(stats.net))}
          </span>
          <span className="summary-rate">Savings: {stats.savingsRate}%</span>
        </div>
        <div className="summary-item average">
          <span className="summary-label">Avg Per Txn</span>
          <span className="summary-value">${formatCurrency(stats.avgDaily)}</span>
          <span className="summary-detail">per transaction</span>
        </div>
      </div>
    </div>
  );
};

export default SummaryCard;
