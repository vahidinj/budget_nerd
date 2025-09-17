// Ambient module declarations for dynamic imports used in lazy Plot component.
declare module 'react-plotly.js/factory' {
  // The factory exports a function that accepts a Plotly instance and returns a React component.
  import type * as React from 'react';
  const create: (plotly: any) => React.ComponentType<any>;
  export default create;
}

declare module 'plotly.js-dist-min' {
  const Plotly: any; // Plotly's JS object; using any to avoid pulling full types.
  export = Plotly;
}
