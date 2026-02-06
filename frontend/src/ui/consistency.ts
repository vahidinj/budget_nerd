export interface ConsistencyIssue {
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface ConsistencyReport {
  accountTypeCounts: Record<string, number>;
  probableTransfers: number;
  duplicateAmountSameDayOppositeSign: number;
  creditCardPaymentPairs: number;
  suspiciousIncomePositives: number;
  inconsistentCategories: number;
  issues: ConsistencyIssue[];
}

interface TxnLike {
  date?: string;
  amount?: number;
  account_type?: string;
  account_number?: string;
  description?: string;
  category?: string;
  category_source?: string;
}

const isSameDay = (a?: string, b?: string) => !!a && !!b && a === b;

export function buildConsistencyReport(transactions: TxnLike[]): ConsistencyReport {
  const accountTypeCounts: Record<string, number> = {};
  const issues: ConsistencyIssue[] = [];
  for (const t of transactions) {
    const type = (t.account_type || 'unknown').toLowerCase();
    accountTypeCounts[type] = (accountTypeCounts[type] || 0) + 1;
  }

  // Map date+abs(amount) to signed occurrences for quick pairing
  interface PairKeyData { pos: TxnLike[]; neg: TxnLike[]; }
  const pairMap = new Map<string, PairKeyData>();
  transactions.forEach(tx => {
    if (typeof tx.amount !== 'number' || !tx.date) return;
    const k = `${tx.date}::${Math.abs(tx.amount)}`;
    let bucket = pairMap.get(k);
    if (!bucket) { bucket = { pos: [], neg: [] }; pairMap.set(k, bucket); }
    if (tx.amount >= 0) bucket.pos.push(tx); else bucket.neg.push(tx);
  });

  let duplicateAmountSameDayOppositeSign = 0;
  let probableTransfers = 0;
  let creditCardPaymentPairs = 0;

  pairMap.forEach(({ pos, neg }) => {
    if (pos.length && neg.length) {
      duplicateAmountSameDayOppositeSign += Math.min(pos.length, neg.length);
      // Evaluate transfer likelihood: different account types / numbers
      const usedNeg: Set<TxnLike> = new Set();
      for (const p of pos) {
        const match = neg.find(n => !usedNeg.has(n) && (n.account_type !== p.account_type || n.account_number !== p.account_number));
        if (match) {
          usedNeg.add(match);
          probableTransfers++;
          const isCreditPair = [p, match].some(x => (x.account_type || '').toLowerCase() === 'credit_card');
          if (isCreditPair) creditCardPaymentPairs++;
        }
      }
    }
  });

  // Suspicious income: positive checking entries that maybe are transfers (matched above)
  let suspiciousIncomePositives = 0;
  const positiveChecking = transactions.filter(t => (t.account_type || '').toLowerCase() === 'checking' && (t.amount || 0) > 0 && !/interest|payroll|salary|deposit/i.test(t.description || ''));
  for (const tx of positiveChecking) {
    // If there exists a same day opposite sign in another account of same magnitude mark suspicious
    const key = `${tx.date}::${Math.abs(tx.amount || 0)}`;
    const bucket = pairMap.get(key);
    if (bucket && bucket.neg.length) suspiciousIncomePositives++;
  }

  // Category consistency checks
  let inconsistentCategories = 0;
  for (const t of transactions) {
    if (t.category) {
      if (t.category.toLowerCase() === 'income' && (t.amount || 0) <= 0) inconsistentCategories++;
      if (t.category.toLowerCase() === 'savings' && (t.amount || 0) <= 0) inconsistentCategories++;
      if (t.category.toLowerCase() === 'expense' && (t.amount || 0) >= 0) inconsistentCategories++;
    }
  }

  if (probableTransfers > 0) {
    issues.push({ level: 'info', message: `${probableTransfers} probable transfer pair(s) detected. Consider categorizing as 'Account Transfer'.` });
  }
  if (duplicateAmountSameDayOppositeSign > 0) {
    issues.push({ level: 'info', message: `${duplicateAmountSameDayOppositeSign} same-day opposite-sign amount pair(s) found, often transfers.` });
  }
  if (creditCardPaymentPairs > 0) {
    issues.push({ level: 'info', message: `${creditCardPaymentPairs} credit card payment transfer pair(s) detected.` });
  }
  if (suspiciousIncomePositives > 0) {
    issues.push({ level: 'warn', message: `${suspiciousIncomePositives} positive checking entries may be transfers mis-labeled as Income.` });
  }
  if (inconsistentCategories > 0) {
    issues.push({ level: 'warn', message: `${inconsistentCategories} transaction(s) have categories mismatched with amount direction.` });
  }
  if (Object.keys(accountTypeCounts).length > 1) {
    issues.push({ level: 'info', message: `Multiple account types present: ${Object.entries(accountTypeCounts).map(([k,v])=>`${k}:${v}`).join(', ')}` });
  }

  // Sort issues: error > warn > info
  const levelRank: Record<ConsistencyIssue['level'], number> = { error: 2, warn: 1, info: 0 };
  issues.sort((a,b)=> levelRank[b.level]-levelRank[a.level]);

  return {
    accountTypeCounts,
    probableTransfers,
    duplicateAmountSameDayOppositeSign,
    creditCardPaymentPairs,
    suspiciousIncomePositives,
    inconsistentCategories,
    issues,
  };
}
