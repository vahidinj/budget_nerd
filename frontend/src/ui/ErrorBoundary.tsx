import React from 'react';
import { apiUrl } from '../config';

interface ErrorBoundaryState { hasError: boolean; error?: Error; info?: React.ErrorInfo; }

export class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ info });
    try {
      fetch(apiUrl('/telemetry'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'ui_error', meta: { message: error.message, stack: error.stack?.slice(0, 400) } }) });
    } catch {/* ignore */}
  }

  reset = () => this.setState({ hasError: false, error: undefined, info: undefined });

  render() {
    if (this.state.hasError) {
      return (
        <div className="themed-modal-content" style={{ width: 'min(720px, 92%)', maxWidth: '920px' }}>
          <h1 style={{ fontSize:'1rem', letterSpacing:'.08em', textTransform:'uppercase', color: 'var(--accent)' }}>Something went wrong</h1>
          <p style={{ maxWidth: 480, lineHeight: 1.4, color: 'var(--text-base)' }}>
            An unexpected error occurred. Try <span className="kw">Reset View</span>. If the issue persists, <span className="kw">Reload Page</span> or clear your browser data.
          </p>
          {this.state.error && (
            <pre className="" style={{ background:'var(--panel-bg)', padding: '.75rem', border:`1px solid ${getComputedStyle(document.documentElement).getPropertyValue('--panel-border') || '#24303d'}`, borderRadius:8, fontSize:'.65rem', maxWidth:600, overflow:'auto', color:'var(--text-base)' }}>
              {this.state.error.message}\n\n{this.state.error.stack}
            </pre>
          )}
          <div style={{ display:'flex', gap:'.6rem', marginTop:'.9rem' }}>
            <button onClick={this.reset} className="themed-small-btn"><span className="kw">Reset View</span></button>
            <button onClick={()=> window.location.reload()} className="themed-small-btn secondary"><span className="kw">Reload Page</span></button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
