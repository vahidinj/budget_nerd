// Configuration: construct backend API URLs
export const API_BASE: string = (import.meta as any).env?.VITE_API_BASE
  ? (import.meta as any).env.VITE_API_BASE.replace(/\/$/, '')
  : '';

export function apiUrl(path: string): string {
  if (!path.startsWith('/')) path = '/' + path;
  if (API_BASE) return API_BASE + path;
  return '/api' + path;
}

