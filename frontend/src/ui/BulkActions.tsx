import React, { useCallback, useState } from 'react';

interface Txn {
  [key: string]: any;
  description: string;
  category?: string;
}

interface BulkActionsProps {
  selectedCount: number;
  onBulkCategorize: (category: string) => Promise<void>;
  onBulkDelete: () => Promise<void>;
  onClearSelection: () => void;
  categories: string[];
  isLoading?: boolean;
}

export const BulkActions: React.FC<BulkActionsProps> = ({
  selectedCount,
  onBulkCategorize,
  onBulkDelete,
  onClearSelection,
  categories,
  isLoading = false,
}) => {
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const handleCategorizeClick = useCallback((category: string) => {
    onBulkCategorize(category);
    setCategoryMenuOpen(false);
  }, [onBulkCategorize]);

  const handleDeleteConfirm = useCallback(() => {
    onBulkDelete();
    setDeleteConfirm(false);
  }, [onBulkDelete]);

  if (selectedCount === 0) return null;

  return (
    <div className="bulk-actions-bar" role="toolbar" aria-label={`Bulk actions (${selectedCount} selected)`}>
      <div className="bulk-actions-inner">
        <div className="bulk-actions-left">
          <span className="bulk-count">
            <strong>{selectedCount}</strong> selected
          </span>
        </div>

        <div className="bulk-actions-center">
          <div className="bulk-action-group">
            <div className="bulk-action-dropdown">
              <button
                className="bulk-action-btn"
                onClick={() => setCategoryMenuOpen(!categoryMenuOpen)}
                disabled={isLoading}
                aria-haspopup="menu"
                aria-expanded={categoryMenuOpen}
              >
                Categorize ▼
              </button>

              {categoryMenuOpen && (
                <div className="bulk-category-menu" role="menu">
                  {categories.map(cat => (
                    <button
                      key={cat}
                      className="bulk-category-item"
                      onClick={() => handleCategorizeClick(cat)}
                      disabled={isLoading}
                      role="menuitem"
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="bulk-actions-right">
          {!deleteConfirm && (
            <>
              <button
                className="bulk-action-btn secondary"
                onClick={() => setDeleteConfirm(true)}
                disabled={isLoading}
              >
                Delete
              </button>
              <button
                className="bulk-action-btn ghost"
                onClick={onClearSelection}
                disabled={isLoading}
              >
                Cancel
              </button>
            </>
          )}

          {deleteConfirm && (
            <>
              <span className="bulk-confirm-text">Delete {selectedCount} items?</span>
              <button
                className="bulk-action-btn confirm"
                onClick={handleDeleteConfirm}
                disabled={isLoading}
              >
                Confirm Delete
              </button>
              <button
                className="bulk-action-btn ghost"
                onClick={() => setDeleteConfirm(false)}
                disabled={isLoading}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
