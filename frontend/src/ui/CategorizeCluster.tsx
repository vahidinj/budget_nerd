import React, { useState, useRef } from 'react';
import PortalPopover from './PortalPopover';

interface CategorizeClusterProps {
  categoriesApplied: boolean;
  categorizeLoading: boolean;
  isRefiningAI: boolean;
  useAI: boolean;
  onCategorize: () => void;
  onToggleAI: () => void;
  onUncategorize: () => void;
  justCategorizedFlash?: boolean;
}

// Categorization controls: primary button + AI toggle + live status.
// Layout: clear action, persistent status line, distinct AI toggle, subtle separators.
export const CategorizeCluster: React.FC<CategorizeClusterProps> = ({
  categoriesApplied,
  categorizeLoading,
  isRefiningAI,
  useAI,
  onCategorize,
  onToggleAI,
  onUncategorize,
  justCategorizedFlash,
}) => {

  const footMsg = (categorizeLoading && !categoriesApplied)
    ? 'Categorizing…'
    : ((isRefiningAI && categoriesApplied) ? 'Refining with AI…' : null);

  const [showHelp, setShowHelp] = useState(false);
  const helpBtnRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div className="categorize-cluster" role="group" aria-label="Transaction categorization controls">
      <div className="cat-main-row">
        <div className="cat-left-group">
          <button
            type="button"
            className={"categorize-btn inline large revamp-cat" + (categorizeLoading ? ' is-loading':'') + (!categoriesApplied ? ' needs-action':'') + (categoriesApplied ? ' is-uncategorize':'') + (justCategorizedFlash ? ' flash-once':'')}
            onClick={categoriesApplied ? onUncategorize : onCategorize}
            disabled={categorizeLoading}
            aria-busy={categorizeLoading}
            aria-label={categorizeLoading ? (categoriesApplied ? 'Removing categories' : 'Categorizing transactions') : (categoriesApplied ? 'Remove all categories' : 'Categorize transactions')}
            title={categoriesApplied ? 'Remove all categories' : 'Auto-tag all transactions'}
          >
            <span className="cat-btn-bg" aria-hidden="true" />
            <span className="cat-btn-glow" aria-hidden="true" />
            <span className="cat-btn-content">
              {categorizeLoading ? <span className="cat-spinner" aria-hidden="true" /> : <span className="cat-label">{categoriesApplied ? 'Uncategorize' : 'Categorize'}</span>}
            </span>
          </button>
          <div className="consistency-badge-wrap">
            <button
              type="button"
              className={`dropdown-btn compact cat-help-btn ${showHelp ? 'open':''}`}
              ref={helpBtnRef}
              onClick={()=> setShowHelp(v=>!v)}
              aria-expanded={showHelp}
              aria-haspopup="dialog"
              aria-controls="cat-help-pop"
              title="About categorization and AI"
            >{showHelp ? 'Info ▴' : 'Info ▾'}</button>
            {
              <PortalPopover anchorRef={helpBtnRef} isOpen={showHelp} className="consistency-popover">
                <div className="cp-head">Categorize <span className="micro">and AI</span></div>
                <ul className="cp-list">
                  <li className="cp-item lvl-info"><span className="lvl-icon" aria-hidden="true">ℹ</span><span className="msg">Auto-tags transactions using pattern rules. Review and refine as needed.</span></li>
                  <li className="cp-item lvl-info"><span className="lvl-icon" aria-hidden="true">ℹ</span><span className="msg">Click again to remove all categories.</span></li>
                  <li className="cp-item lvl-info"><span className="lvl-icon" aria-hidden="true">ℹ</span><span className="msg">Transfers are excluded from budget totals.</span></li>
                  <li className="cp-item lvl-info"><span className="lvl-icon" aria-hidden="true">🔒</span><span className="msg">AI runs server-side. Only transaction descriptions are sent to external AI providers.</span></li>
                  <li className="cp-item lvl-info"><span className="lvl-icon" aria-hidden="true">🔒</span><span className="msg">PDFs stay on your device. Never transmitted to third parties.</span></li>
                </ul>
                <button className="cp-close" type="button" onClick={()=> setShowHelp(false)} aria-label="Close help">×</button>
              </PortalPopover>
            }
          </div>
        </div>
        <div className="cat-sep" aria-hidden="true" />
        <div className="cat-right-group">
          <button
            type="button"
            className={"ai-pill-toggle compact" + (useAI ? ' active':'')}
            onClick={onToggleAI}
            aria-pressed={useAI}
            aria-label={useAI ? 'Disable AI refinement' : 'Enable AI refinement'}
            title={useAI ? 'Disable AI refinement' : 'Enable AI refinement (only descriptions sent to external AI)'}
          >
            <span className="dot" aria-hidden="true" />
            <span className="ai-pill-label">AI {useAI ? 'On':'Off'}</span>
          </button>
          <span className={"ai-refine-indicator" + (isRefiningAI ? ' active' : '')} aria-hidden="true">AI</span>
        </div>
      </div>
      {footMsg && (
        <div className="cat-foot-row" aria-live="polite">
          <div className="ai-progress-wrap">
            <span className="cat-foot-msg">{footMsg}</span>
            <span className={"ai-inline-progress" + (isRefiningAI ? ' active':'') + (categorizeLoading && !categoriesApplied ? ' loading':'')} aria-hidden="true">
              <span className="bar" />
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default CategorizeCluster;
