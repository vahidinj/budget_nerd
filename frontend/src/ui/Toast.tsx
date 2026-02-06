import React, { useEffect } from 'react';
import { Toast } from './ToastContext';

interface ToastItemProps {
  toast: Toast;
  onClose: (id: string) => void;
}

const ToastItem: React.FC<ToastItemProps> = ({ toast, onClose }) => {
  useEffect(() => {
    if (toast.duration && toast.duration > 0) {
      const timer = setTimeout(() => onClose(toast.id), toast.duration);
      return () => clearTimeout(timer);
    }
  }, [toast.duration, toast.id, onClose]);

  const typeColors: Record<string, { bg: string; border: string; text: string; icon: string }> = {
    success: { bg: '#123f2a', border: '#2e6f4a', text: '#5ad67d', icon: '✓' },
    error: { bg: '#47232b', border: '#6a3841', text: '#ff6b6b', icon: '!' },
    warning: { bg: '#473d23', border: '#6a5a38', text: '#ffb347', icon: '⚠' },
    info: { bg: '#1d2f3a', border: '#315068', text: '#4db7ff', icon: 'ⓘ' },
  };

  const colors = typeColors[toast.type] || typeColors.info;

  return (
    <div
      className="toast-item"
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        color: colors.text,
      }}
      role="alert"
      aria-live="polite"
    >
      <div className="toast-icon" style={{ color: colors.text }}>
        {colors.icon}
      </div>
      <div className="toast-content">
        <p className="toast-message">{toast.message}</p>
        {toast.action && (
          <button
            className="toast-action"
            onClick={() => {
              toast.action?.onClick();
              onClose(toast.id);
            }}
            style={{ color: colors.text }}
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        className="toast-close"
        onClick={() => onClose(toast.id)}
        aria-label="Close notification"
        style={{ color: colors.text }}
      >
        ✕
      </button>
    </div>
  );
};

interface ToastContainerProps {
  toasts: Toast[];
  onClose: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onClose }) => {
  return (
    <div className="toast-container" role="region" aria-label="Notifications">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onClose={onClose} />
      ))}
    </div>
  );
};
