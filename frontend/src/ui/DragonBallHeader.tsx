import React from 'react';
import MascotIcon from './MascotIcon';

export const DragonBallHeader: React.FC = () => {
  return (
    <header className="dbz-header">
      <div className="logo-block">
        <div className="logo">
          <MascotIcon size={44} />
          <span className="brand"> Dragon Ledger</span>
        </div>
        <span className="version-chip" title="App version">v0.1</span>
      </div>
      <div className="subtitle">
        And this is to go even furher beyond with your Budgeting.
      </div>
      <div className="header-actions" aria-label="Quick actions">
        {/* Future space for settings/help/theme toggle */}
      </div>
    </header>
  );
};
