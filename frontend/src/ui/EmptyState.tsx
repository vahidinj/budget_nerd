import React from 'react';
import { DragonOrbIcon } from './DragonOrbIcon';

interface EmptyStateProps {
  type: 'no-file' | 'no-results' | 'no-data';
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ type, onAction }) => {
  const states = {
    'no-file': {
      title: 'No File Loaded',
      message: 'Upload a PDF bank or credit card statement to get started.',
      action: onAction ? 'Upload File' : undefined,
      icon: '📄',
    },
    'no-results': {
      title: 'No Transactions Found',
      message: 'Your current filters didn\'t match any transactions. Try adjusting your search or date range.',
      action: onAction ? 'Clear Filters' : undefined,
      icon: '🔍',
    },
    'no-data': {
      title: 'Ready for Analysis',
      message: 'Parse a statement to see spending insights, categorization, and trends here.',
      action: onAction ? 'Upload First File' : undefined,
      icon: '✨',
    },
  };

  const state = states[type];

  return (
    <div className="empty-state" role="status" aria-live="polite">
      <div className="empty-state-inner">
        <div className="empty-icon">{state.icon}</div>
        <h2 className="empty-title">{state.title}</h2>
        <p className="empty-message">{state.message}</p>
        {state.action && onAction && (
          <button className="empty-action" onClick={onAction}>
            {state.action}
          </button>
        )}
      </div>
    </div>
  );
};
