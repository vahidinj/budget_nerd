import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';

interface Props {
  anchorRef: React.RefObject<HTMLElement>;
  isOpen: boolean;
  className?: string;
  children: React.ReactNode;
  onMount?: (node: HTMLDivElement | null) => void;
  // optional offset (y pixels) between anchor bottom and popover
  offset?: number;
}

const POPOVER_WIDTH = 260; // matches existing CSS default

const PortalPopover: React.FC<Props> = ({ anchorRef, isOpen, className, children, onMount, offset = 8 }) => {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!isOpen) {
      if (onMount) onMount(null);
      return;
    }
    const compute = () => {
      const anchor = anchorRef.current;
      if (!anchor) return setPos(null);
      const rect = anchor.getBoundingClientRect();
      const scrollY = window.scrollY || window.pageYOffset;
      const scrollX = window.scrollX || window.pageXOffset;
      const top = rect.bottom + offset + scrollY;
      // align right edge of popover with anchor right edge
      let left = rect.right + scrollX - POPOVER_WIDTH;
      // ensure visible within viewport with small padding
      const pad = 8;
      if (left < pad) left = pad + scrollX;
      if (left + POPOVER_WIDTH > window.innerWidth - pad) left = Math.max(pad + scrollX, window.innerWidth - POPOVER_WIDTH - pad + scrollX);
      setPos({ top: Math.round(top), left: Math.round(left) });
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    const ro = new MutationObserver(compute);
    ro.observe(document.body, { attributes: true, subtree: true });
    if (onMount) onMount(nodeRef.current);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
      ro.disconnect();
      if (onMount) onMount(null);
    };
  }, [isOpen, anchorRef, onMount, offset]);

  if (!isOpen) return null;
  if (!pos) return null;

  const el = (
    <div
      ref={nodeRef}
      className={className}
      role="dialog"
      style={{
        position: 'absolute',
        top: pos.top + 'px',
        left: pos.left + 'px',
        width: POPOVER_WIDTH + 'px',
        zIndex: 200000,
        pointerEvents: 'auto'
      }}
    >
      {children}
    </div>
  );

  return ReactDOM.createPortal(el, document.body);
};

export default PortalPopover;
