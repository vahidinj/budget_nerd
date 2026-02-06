import React, { useCallback } from 'react';

export interface FilterPreset {
  id: string;
  label: string;
  dateStart?: string;
  dateEnd?: string;
  accounts?: string[];
  categories?: string[];
}

interface FilterPresetsProps {
  presets: FilterPreset[];
  onApplyPreset: (preset: FilterPreset) => void;
  onSavePreset: (preset: FilterPreset) => void;
  onDeletePreset: (presetId: string) => void;
}

export const COMMON_PRESETS: FilterPreset[] = [
  {
    id: 'this-month',
    label: 'This Month',
    // Dates are calculated dynamically in parent component
  },
  {
    id: 'last-month',
    label: 'Last Month',
  },
  {
    id: 'last-30-days',
    label: 'Last 30 Days',
  },
  {
    id: 'last-90-days',
    label: 'Last 90 Days',
  },
  {
    id: 'this-year',
    label: 'This Year',
  },
  {
    id: 'uncategorized',
    label: 'Uncategorized',
    categories: [],
  },
  {
    id: 'large-transactions',
    label: 'Large Transactions',
  },
];

export const FilterPresets: React.FC<FilterPresetsProps> = ({
  presets,
  onApplyPreset,
  onSavePreset,
  onDeletePreset,
}) => {
  const handleApply = useCallback((preset: FilterPreset) => {
    onApplyPreset(preset);
  }, [onApplyPreset]);

  const handleDelete = useCallback((presetId: string) => {
    if (confirm('Delete this preset?')) {
      onDeletePreset(presetId);
    }
  }, [onDeletePreset]);

  return (
    <div className="filter-presets">
      <div className="filter-presets-header">
        <h4 className="filter-presets-title">Quick Presets</h4>
      </div>
      <div className="filter-presets-grid">
        {presets.map(preset => (
          <div key={preset.id} className="filter-preset-item">
            <button
              className="filter-preset-btn"
              onClick={() => handleApply(preset)}
              title={`Apply ${preset.label}`}
            >
              <span className="filter-preset-label">{preset.label}</span>
            </button>
            {preset.id.startsWith('custom-') && (
              <button
                className="filter-preset-delete"
                onClick={() => handleDelete(preset.id)}
                title="Delete preset"
                aria-label={`Delete ${preset.label} preset`}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
