import React from 'react';
import MascotIcon from './MascotIcon';

export const DragonBallHeader: React.FC = () => {
  return (
    <header className="dbz-header">
      <div className="logo-block">
        <MascotIcon size={36} />
        <div className="logo-content">
          <div className="logo-line">
            <span className="brand">Budget Nerd</span>
            <span className="version-chip" title="App version">v0.1</span>
          </div>
          <span className="tagline">🔒 Secure · Private · Ephemeral</span>
        </div>
      </div>
      <div className="header-actions" aria-label="Quick actions"></div>
    </header>
  );
};
