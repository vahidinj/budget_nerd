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

  const [showCatHelp, setShowCatHelp] = useState(false);
  const [showAIHelp, setShowAIHelp] = useState(false);
  const catHelpBtnRef = useRef<HTMLButtonElement | null>(null);
  const aiHelpBtnRef = useRef<HTMLButtonElement | null>(null);

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
          {categoriesApplied && (
            <span className="cat-status-badge" aria-live="polite" aria-label={isRefiningAI ? 'Categories applied. AI refinement running' : 'Categories applied'}>
              <span className="cat-status-dot" aria-hidden="true" />
              <span className="cat-status-text">Categorized</span>
              <span className="cat-refine-slot" aria-hidden="true">
                <span className={"ai-refine-indicator" + (isRefiningAI ? ' active':'')}>AI</span>
              </span>
            </span>
          )}
          <div className="consistency-badge-wrap">
            <button
              type="button"
              className={`dropdown-btn compact ${showCatHelp ? 'open':''}`}
              ref={catHelpBtnRef}
              onClick={()=> setShowCatHelp(v=>!v)}
              aria-expanded={showCatHelp}
              aria-haspopup="dialog"
              aria-controls="cat-help-pop"
              title="How categorization works"
            >{showCatHelp ? 'How it works ▴' : 'How it works ▾'}</button>
            {(
              // use PortalPopover so the popover is appended to document.body and escapes ancestor stacking contexts
              <PortalPopover anchorRef={catHelpBtnRef} isOpen={showCatHelp} className="consistency-popover">
                <div className="cp-head">Categorize <span className="micro">how it works</span></div>
                <ul className="cp-list">
                  <li className="cp-item lvl-info"><span className="lvl-icon" aria-hidden="true">ℹ</span><span className="msg">Auto-tags transactions using pattern rules. Review and refine as needed.</span></li>
                  <li className="cp-item lvl-info"><span className="lvl-icon" aria-hidden="true">ℹ</span><span className="msg">Click again to remove all categories.</span></li>
                  <li className="cp-item lvl-info"><span className="lvl-icon" aria-hidden="true">ℹ</span><span className="msg">Transfers are excluded from budget totals.</span></li>
                </ul>
                <button className="cp-close" type="button" onClick={()=> setShowCatHelp(false)} aria-label="Close categorize help">×</button>
              </PortalPopover>
            )}
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
          <div className="consistency-badge-wrap">
            <button
              type="button"
              className={`dropdown-btn compact ${showAIHelp ? 'open':''}`}
              ref={aiHelpBtnRef}
              onClick={()=> setShowAIHelp(v=>!v)}
              aria-expanded={showAIHelp}
              aria-haspopup="dialog"
              aria-controls="ai-help-pop"
              title="About AI refinement"
            >{showAIHelp ? 'About AI ▴' : 'About AI ▾'}</button>
            {(
              <PortalPopover anchorRef={aiHelpBtnRef} isOpen={showAIHelp} className="consistency-popover">
                <div className="cp-head">AI refinement <span className="micro">optional</span></div>
                <ul className="cp-list">
                  <li className="cp-item lvl-info"><span className="lvl-icon" aria-hidden="true">ℹ</span><span className="msg">AI refines categories for better accuracy using pattern models.</span></li>
                  <li className="cp-item lvl-info"><span className="lvl-icon" aria-hidden="true">🔒</span><span className="msg">Runs server-side. Only transaction descriptions are sent to external AI providers.</span></li>
                  <li className="cp-item lvl-info"><span className="lvl-icon" aria-hidden="true">🔒</span><span className="msg">PDFs stay on your device. Never transmitted to third parties.</span></li>
                  <li className="cp-item lvl-info"><span className="lvl-icon" aria-hidden="true">ℹ</span><span className="msg">Review and approve all suggestions before applying.</span></li>
                </ul>
                <button className="cp-close" type="button" onClick={()=> setShowAIHelp(false)} aria-label="Close AI help">×</button>
              </PortalPopover>
            )}
          </div>
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
