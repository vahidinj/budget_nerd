// Sample ParseResponse object for demo mode (anonymized synthetic data)
// Keep small to avoid bundle bloat.
export const sampleData = {
  fileName: 'DEMO_SAMPLE.pdf',
  metrics: {
    transaction_count: 16,
    accounts: 3,
    net_amount: 245.32,
    account_types: ['checking', 'savings', 'credit_card']
  },
  transactions: [
    { date: '2025-07-01', description: 'PAYROLL DIRECT DEP', amount: 1500.00, balance: 1500.00, account_type: 'checking' },
    { date: '2025-07-02', description: 'COFFEE SHOP', amount: -5.75, balance: 1494.25, account_type: 'checking' },
    { date: '2025-07-02', description: 'GROCERY MARKET', amount: -82.10, balance: 1412.15, account_type: 'checking' },
    { date: '2025-07-03', description: 'SAVINGS TRANSFER', amount: -300.00, balance: 1112.15, account_type: 'checking' },
    { date: '2025-07-03', description: 'SAVINGS TRANSFER IN', amount: 300.00, balance: 300.00, account_type: 'savings' },
    { date: '2025-07-04', description: 'UTILITY BILL', amount: -120.50, balance: 991.65, account_type: 'checking' },
    { date: '2025-07-05', description: 'ATM WITHDRAWAL', amount: -40.00, balance: 951.65, account_type: 'checking' },
    { date: '2025-07-06', description: 'INTEREST CREDIT', amount: 2.15, balance: 302.15, account_type: 'savings' },
    { date: '2025-07-07', description: 'STREAMING SERVICE', amount: -14.99, balance: 936.66, account_type: 'checking' },
    { date: '2025-07-08', description: 'GAS STATION', amount: -46.30, balance: 890.36, account_type: 'checking' },
    { date: '2025-07-08', description: 'SAVINGS TRANSFER IN', amount: 100.00, balance: 402.15, account_type: 'savings' },
    { date: '2025-07-09', description: 'REFUND MERCHANT', amount: 52.81, balance: 943.17, account_type: 'checking' },
    // Credit card transactions
    { date: '2025-07-02', description: 'ONLINE RETAILER', amount: -120.00, balance: -120.00, account_type: 'credit_card' },
    { date: '2025-07-04', description: 'RESTAURANT', amount: -45.50, balance: -165.50, account_type: 'credit_card' },
    { date: '2025-07-06', description: 'CREDIT CARD PAYMENT', amount: 200.00, balance: 34.50, account_type: 'credit_card' },
    { date: '2025-07-08', description: 'INTEREST CHARGE', amount: -1.25, balance: 33.25, account_type: 'credit_card' }
  ],
  unparsed_sample: [],
  raw_line_count: 16,
  balance_mismatches: []
};
