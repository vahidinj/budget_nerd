import React from 'react';

interface SkeletonLoaderProps {
  type: 'card' | 'row' | 'chart' | 'text' | 'avatar';
  width?: string | number;
  height?: string | number;
  count?: number;
  className?: string;
}

export const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({
  type,
  width,
  height,
  count = 1,
  className = '',
}) => {
  const getDefaultDimensions = () => {
    switch (type) {
      case 'card':
        return { width: '100%', height: '120px' };
      case 'row':
        return { width: '100%', height: '32px' };
      case 'chart':
        return { width: '100%', height: '180px' };
      case 'text':
        return { width: '80%', height: '16px' };
      case 'avatar':
        return { width: '40px', height: '40px' };
      default:
        return { width: '100%', height: '20px' };
    }
  };

  const dims = getDefaultDimensions();
  const finalWidth = width ?? dims.width;
  const finalHeight = height ?? dims.height;

  const skeletons = Array.from({ length: count }).map((_, i) => (
    <div
      key={i}
      className={`skeleton skeleton-${type} ${className}`}
      style={{
        width: typeof finalWidth === 'number' ? `${finalWidth}px` : finalWidth,
        height: typeof finalHeight === 'number' ? `${finalHeight}px` : finalHeight,
      }}
      aria-hidden="true"
    />
  ));

  if (count === 1) return skeletons[0];

  return (
    <div className="skeleton-group">
      {skeletons}
    </div>
  );
};

interface SkeletonTableProps {
  rows?: number;
  columns?: number;
}

export const SkeletonTable: React.FC<SkeletonTableProps> = ({ rows = 5, columns = 5 }) => {
  return (
    <div className="skeleton-table">
      <div className="skeleton-table-header">
        {Array.from({ length: columns }).map((_, i) => (
          <div key={`header-${i}`} className="skeleton skeleton-text" style={{ height: '20px' }} />
        ))}
      </div>
      <div className="skeleton-table-body">
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div key={`row-${rowIdx}`} className="skeleton-table-row">
            {Array.from({ length: columns }).map((_, colIdx) => (
              <div key={`col-${colIdx}`} className="skeleton skeleton-text" style={{ height: '16px' }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};
