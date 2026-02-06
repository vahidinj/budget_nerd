import React from 'react';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="keyboard-shortcuts-modal-overlay" onClick={onClose}>
      <div className="keyboard-shortcuts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ks-header">
          <h2>Keyboard Shortcuts</h2>
          <button className="ks-close" onClick={onClose} aria-label="Close shortcuts">✕</button>
        </div>
        
        <div className="ks-content">
          <div className="ks-section">
            <h3>Navigation</h3>
            <div className="ks-item">
              <div className="ks-keys">
                <kbd>Cmd</kbd> + <kbd>K</kbd>
              </div>
              <span>Focus search filter</span>
            </div>
            <div className="ks-item">
              <div className="ks-keys">
                <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>H</kbd>
              </div>
              <span>Toggle high contrast mode</span>
            </div>
            <div className="ks-item">
              <div className="ks-keys">
                <kbd>Esc</kbd>
              </div>
              <span>Clear filters & close modals</span>
            </div>
          </div>

          <div className="ks-section">
            <h3>File Operations</h3>
            <div className="ks-item">
              <div className="ks-keys">
                <kbd>Cmd</kbd> + <kbd>U</kbd>
              </div>
              <span>Open file upload</span>
            </div>
            <div className="ks-item">
              <div className="ks-keys">
                <kbd>Cmd</kbd> + <kbd>L</kbd>
              </div>
              <span>Export current data</span>
            </div>
          </div>

          <div className="ks-section">
            <h3>Filtering</h3>
            <div className="ks-item">
              <div className="ks-keys">
                <kbd>Cmd</kbd> + <kbd>/</kbd>
              </div>
              <span>Toggle filters panel</span>
            </div>
            <div className="ks-item">
              <div className="ks-keys">
                <kbd>Cmd</kbd> + <kbd>⌫</kbd>
              </div>
              <span>Clear all filters</span>
            </div>
          </div>

          <div className="ks-section">
            <h3>Categorization</h3>
            <div className="ks-item">
              <div className="ks-keys">
                <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd>
              </div>
              <span>Categorize transactions</span>
            </div>
            <div className="ks-item">
              <div className="ks-keys">
                <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>A</kbd>
              </div>
              <span>Toggle AI refinement</span>
            </div>
          </div>
        </div>

        <div className="ks-footer">
          <small>Use <code>Cmd</code> on macOS, <code>Ctrl</code> on Windows/Linux</small>
        </div>
      </div>
    </div>
  );
};
