import React, { useMemo } from 'react';

interface UnifiedPanelProps {
  transactions?: any[];
  filteredTransactions?: any[];
  dateStart?: string;
  dateEnd?: string;
  categoriesApplied?: boolean;
  amountStats?: {
    total: number;
    avg: number;
    median: number;
    min: number;
    max: number;
    charges: number;
    credits: number;
    largestInflow: number;
    largestOutflow: number;
  };
}

const TRANSFER_RX = /(\bxfer\b|internal transfer|funds? transfer|account transfer|transfer to (credit|checking|savings|card)|transfer from (credit|checking|savings|card)|to credit card payment|payment to credit card|move to savings|auto ?transfer|online transfer|between accounts|card payment|credit card payment)/i;
const CARD_PAYMENT_RX = /(credit card|card payment|payment to card|payment to credit card|visa|mastercard|amex|discover|payment received)/i;

const isCreditCardAccount = (t: any) => (t.account_type || '').toLowerCase() === 'credit_card';
const isTransferLike = (t: any) => {
  const cat = (t.category || '').toLowerCase();
  if (cat === 'account transfer') return true;
  if (cat === 'savings' || cat === 'income') return false;
  return TRANSFER_RX.test(t.description || '');
};

export const UnifiedFinancialPanel: React.FC<UnifiedPanelProps> = ({
  transactions = [],
  filteredTransactions = [],
  dateStart,
  dateEnd,
  categoriesApplied = false,
  amountStats,
}) => {
  const stats = useMemo(() => {
    const txns = filteredTransactions.length > 0 ? filteredTransactions : transactions;
    if (!txns.length) return null;

    const transferLikeCount = txns.reduce((sum, t) => (isTransferLike(t) ? sum + 1 : sum), 0);
    const creditCardPresent = txns.some(isCreditCardAccount);
    const inferredCardPayments = !creditCardPresent && txns.some(t => {
      if (!isTransferLike(t)) return false;
      if (typeof t.amount !== 'number' || t.amount >= 0) return false;
      return CARD_PAYMENT_RX.test(t.description || '');
    });

    const avgPerTxn = amountStats
      ? amountStats.avg
      : txns.reduce((sum, t) => sum + Math.abs(t.amount || 0), 0) / txns.length;

    if (categoriesApplied) {
      let income = 0;
      let expenses = 0;
      let savings = 0;
      for (const t of txns) {
        if (typeof t.amount !== 'number') continue;
        const cat = (t.category || '').toLowerCase();
        if (isTransferLike(t)) continue;
        if (cat === 'income' && t.amount > 0) {
          if (!isCreditCardAccount(t)) {
            income += t.amount;
          }
          continue;
        }
        if (cat === 'savings' && t.amount > 0) {
          savings += t.amount;
          continue;
        }
        if (t.amount < 0) expenses += Math.abs(t.amount);
      }
      const net = income - expenses - savings;
      const savingsRate = income > 0 ? Math.round((savings / income) * 100) : 0;
      return { inflows: income, outflows: expenses, net, savingsRate, avgPerTxn, count: txns.length, transferLikeCount, inferredCardPayments };
    }

    const inflows = txns
      .filter(t => (t.amount || 0) > 0)
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    
    const outflows = txns
      .filter(t => (t.amount || 0) < 0)
      .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);

    const net = inflows - outflows;
    const savingsRate = inflows > 0 ? Math.round((net / inflows) * 100) : 0;

    return { inflows, outflows, net, savingsRate, avgPerTxn, count: txns.length, transferLikeCount, inferredCardPayments };
  }, [transactions, filteredTransactions, categoriesApplied, amountStats]);

  if (!stats) {
    return null;
  }

  const formatCurrency = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const periodLabel = dateStart && dateEnd ? `${dateStart} to ${dateEnd}` : 'Full Dataset';
  const netColor = stats.net >= 0 ? '#5ad67d' : '#ff6b6b';
  const netSubtitle = categoriesApplied
    ? `Remaining after expenses & savings · Savings rate ${stats.savingsRate}%`
    : `Net inflow - outflow · Savings rate ${stats.savingsRate}%`;

  return (
    <section className="unified-financial-panel">
      <div className="panel-header">
        <div className="panel-title-block">
          <h3 className="panel-title">Financial Overview</h3>
          <span className="panel-subtitle">{periodLabel}</span>
        </div>
        <div className="panel-meta">
          <span className="panel-count">{stats.count} transactions</span>
          {stats.transferLikeCount > 0 && <span className="panel-badge">Transfers Excluded</span>}
          {stats.inferredCardPayments && <span className="panel-badge warn">Card Payments Inferred</span>}
        </div>
      </div>

      {/* Top Row: Primary Metrics (4 columns) */}
      <div className="financial-grid primary-row">
        <div className="metric-card inflow-card">
          <div className="metric-top">
            <div className="metric-label">Total In</div>
            <span className="metric-chip positive">Inflow</span>
          </div>
          <div className="metric-value">${formatCurrency(stats.inflows)}</div>
          <div className="metric-foot">Gross Deposits</div>
        </div>
        
        <div className="metric-card outflow-card">
          <div className="metric-top">
            <div className="metric-label">Total Out</div>
            <span className="metric-chip negative">Outflow</span>
          </div>
          <div className="metric-value">${formatCurrency(stats.outflows)}</div>
          <div className="metric-foot">Spending + Fees</div>
        </div>
        
        <div className="metric-card net-card">
          <div className="metric-top">
            <div className="metric-label">Remaining</div>
            <span className="metric-chip neutral">Net</span>
          </div>
          <div className="metric-value" style={{ color: netColor }}>
            {stats.net >= 0 ? '+' : ''}${formatCurrency(Math.abs(stats.net))}
          </div>
          <div className="metric-foot">{netSubtitle}</div>
        </div>
        
        <div className="metric-card average-card">
          <div className="metric-top">
            <div className="metric-label">Avg Per Txn</div>
            <span className="metric-chip accent">Avg</span>
          </div>
          <div className="metric-value">${formatCurrency(stats.avgPerTxn)}</div>
          <div className="metric-foot">Per Transaction</div>
        </div>
      </div>

      {/* Bottom Row: Detailed Statistics (5 columns) */}
      {amountStats && (
        <div className="financial-grid secondary-row">
          <div className="stat-pill">
            <div className="stat-label">Median</div>
            <div className="stat-value">${formatCurrency(amountStats.median)}</div>
          </div>
          
          <div className="stat-pill inflow-highlight">
            <div className="stat-label">Largest Inflow</div>
            <div className="stat-value positive">${formatCurrency(amountStats.largestInflow)}</div>
          </div>
          
          <div className="stat-pill outflow-highlight">
            <div className="stat-label">Largest Outflow</div>
            <div className="stat-value negative">${formatCurrency(Math.abs(amountStats.largestOutflow))}</div>
          </div>
          
          <div className="stat-pill total-highlight">
            <div className="stat-label">Filtered Total</div>
            <div className="stat-value" style={{ color: amountStats.total >= 0 ? '#5ad67d' : '#ff6b6b' }}>
              ${formatCurrency(Math.abs(amountStats.total))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default UnifiedFinancialPanel;
