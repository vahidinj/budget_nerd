import React, { useMemo } from 'react';

interface Txn {
  date?: string;
  amount?: number;
  category?: string;
  description: string;
  [key: string]: any;
}

interface InsightsData {
  topCategories: Array<{ category: string; total: number; count: number; avg: number }>;
  spendingByDayOfWeek: Array<{ day: string; total: number; count: number }>;
  dailyAverage: number;
  largestTransaction: { amount: number; description: string; date: string };
  smallestTransaction: { amount: number; description: string; date: string };
  averageTransactionSize: number;
  transactionCount: number;
  unusualSpending: Array<{ date: string; amount: number; description: string; reason: string }>;
}

interface InsightsPanelProps {
  transactions: Txn[];
  dateStart?: string;
  dateEnd?: string;
}

export const InsightsPanel: React.FC<InsightsPanelProps> = ({
  transactions,
  dateStart,
  dateEnd,
}) => {
  const insights = useMemo((): InsightsData | null => {
    if (!transactions.length) return null;

    // Top categories
    const categoryMap = new Map<string, { total: number; count: number }>();
    const dayMap = new Map<string, { total: number; count: number }>();
    let maxAmount = -Infinity;
    let minAmount = Infinity;
    let largestTxn: Txn | null = null;
    let smallestTxn: Txn | null = null;
    let sumAmounts = 0;

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    for (const txn of transactions) {
      const amount = txn.amount ?? 0;
      const category = txn.category || 'Uncategorized';
      const date = txn.date || txn.post_date || '';

      if (amount !== 0) {
        sumAmounts += Math.abs(amount);
      }

      // Track category
      const catEntry = categoryMap.get(category) || { total: 0, count: 0 };
      catEntry.total += Math.abs(amount);
      catEntry.count += 1;
      categoryMap.set(category, catEntry);

      // Track day of week
      if (date) {
        try {
          const d = new Date(date);
          const dayName = days[d.getDay()];
          const dayEntry = dayMap.get(dayName) || { total: 0, count: 0 };
          dayEntry.total += Math.abs(amount);
          dayEntry.count += 1;
          dayMap.set(dayName, dayEntry);
        } catch (e) {
          /* ignore */
        }
      }

      // Track extremes
      if (amount > maxAmount) {
        maxAmount = amount;
        largestTxn = txn;
      }
      if (amount < minAmount) {
        minAmount = amount;
        smallestTxn = txn;
      }
    }

    const topCategories = Array.from(categoryMap.entries())
      .map(([category, { total, count }]) => ({
        category,
        total,
        count,
        avg: total / count,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    const spendingByDayOfWeek = days
      .map(day => ({
        day: day.slice(0, 3),
        total: dayMap.get(day)?.total ?? 0,
        count: dayMap.get(day)?.count ?? 0,
      }));

    const avgSize = transactions.length > 0 ? sumAmounts / transactions.length : 0;

    // Detect unusual spending (amounts > 2 std devs from mean)
    const mean = avgSize;
    let variance = 0;
    for (const txn of transactions) {
      const amount = Math.abs(txn.amount ?? 0);
      variance += Math.pow(amount - mean, 2);
    }
    const stdDev = Math.sqrt(variance / transactions.length);
    const threshold = mean + 2 * stdDev;

    const unusualSpending = transactions
      .filter(t => Math.abs(t.amount ?? 0) > threshold)
      .slice(0, 3)
      .map(t => ({
        date: t.date || t.post_date || 'Unknown',
        amount: t.amount ?? 0,
        description: t.description,
        reason: `${Math.round((Math.abs(t.amount ?? 0) / mean) * 10) / 10}x average`,
      }));

    return {
      topCategories,
      spendingByDayOfWeek,
      dailyAverage: sumAmounts / (transactions.length || 1),
      largestTransaction: largestTxn
        ? { amount: largestTxn.amount ?? 0, description: largestTxn.description, date: largestTxn.date || '' }
        : { amount: 0, description: 'N/A', date: '' },
      smallestTransaction: smallestTxn
        ? { amount: smallestTxn.amount ?? 0, description: smallestTxn.description, date: smallestTxn.date || '' }
        : { amount: 0, description: 'N/A', date: '' },
      averageTransactionSize: avgSize,
      transactionCount: transactions.length,
      unusualSpending,
    };
  }, [transactions]);

  if (!insights) {
    return (
      <div className="insights-panel empty">
        <p>No transaction data available for insights.</p>
      </div>
    );
  }

  return (
    <div className="insights-panel" role="region" aria-label="Transaction insights and trends">
      <div className="insights-grid">
        {/* Top Categories */}
        <div className="insights-section insights-categories">
          <h3>Top Categories</h3>
          <ul className="insights-list">
            {insights.topCategories.map((cat, i) => (
              <li key={i} className="insights-item">
                <span className="insights-rank">{i + 1}</span>
                <span className="insights-label">{cat.category}</span>
                <span className="insights-value">${cat.total.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Spending by Day */}
        <div className="insights-section insights-days">
          <h3>Spending by Day</h3>
          <div className="insights-days-bars">
            {insights.spendingByDayOfWeek.map((day, i) => (
              <div key={i} className="day-bar-item">
                <span className="day-label">{day.day}</span>
                <div className="day-bar-track">
                  <div
                    className="day-bar-fill"
                    style={{
                      width: `${Math.min(
                        100,
                        (day.total /
                          (Math.max(...insights.spendingByDayOfWeek.map(d => d.total)) || 1)) *
                          100
                      )}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Key Metrics */}
        <div className="insights-section insights-metrics">
          <h3>Key Metrics</h3>
          <div className="insights-metric">
            <span>Avg. Transaction</span>
            <strong>${insights.averageTransactionSize.toFixed(2)}</strong>
          </div>
          <div className="insights-metric">
            <span>Largest</span>
            <strong>${Math.abs(insights.largestTransaction.amount).toFixed(2)}</strong>
          </div>
          <div className="insights-metric">
            <span>Total Transactions</span>
            <strong>{insights.transactionCount}</strong>
          </div>
        </div>

        {/* Unusual Spending */}
        {insights.unusualSpending.length > 0 && (
          <div className="insights-section insights-anomalies">
            <h3>⚠️ Unusual Spending</h3>
            <ul className="insights-list">
              {insights.unusualSpending.map((txn, i) => (
                <li key={i} className="insights-item anomaly">
                  <span className="insights-label">{txn.description.slice(0, 20)}</span>
                  <span className="anomaly-reason">{txn.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
