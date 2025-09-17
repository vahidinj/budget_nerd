import React, { useCallback, useState, useMemo, useEffect, useRef } from 'react';
import CategorizeCluster from './CategorizeCluster';
// Robust lazy Plot component using factory + explicit dist bundle to avoid evaluation issues.
// Provide a typed alias for the resolved Plot component to appease TS when spreading props.
type PlotComponent = React.ComponentType<any>;
const Plot: React.LazyExoticComponent<PlotComponent> = React.lazy(async () => {
	// Load the small factory module, then ensure a Plotly object is available at runtime.
	// We avoid importing Plotly as a module to keep it out of the main bundle; instead
	// we load it from the official CDN at runtime when needed.
	try {
		const factoryMod = await import('react-plotly.js/factory');
		const createPlotlyComponent = (factoryMod as any).default || (factoryMod as any);

		// If Plotly is already present on window, use it. Otherwise inject the CDN script.
		let plotly: any = (typeof window !== 'undefined') ? (window as any).Plotly : undefined;
		if (!plotly) {
			const version = '2.34.0';
			const cdn = `https://cdn.plot.ly/plotly-${version}.min.js`;
			await new Promise<void>((resolve, reject) => {
				// guard against double-injection
				if ((window as any).Plotly) return resolve();
				const existing = document.querySelector(`script[src="${cdn}"]`);
				if (existing) {
					existing.addEventListener('load', () => resolve());
					existing.addEventListener('error', () => reject(new Error('Failed to load Plotly from CDN')));
					return;
				}
				const s = document.createElement('script');
				s.src = cdn;
				s.async = true;
				s.onload = () => resolve();
				s.onerror = () => reject(new Error('Failed to load Plotly from CDN'));
				document.head.appendChild(s);
			});
			plotly = (window as any).Plotly;
		}

		if (!plotly) throw new Error('Plotly failed to initialize');
		return { default: createPlotlyComponent(plotly) };
	} catch (err) {
		try { if (process.env.NODE_ENV !== 'production') console.error('Failed to load Plotly components', err); } catch (_) {}
		throw err;
	}
});
import axios from 'axios';
import { useDebouncedValue, useWindowedRows, usePolling } from './hooks';
import { DragonBallHeader } from './DragonBallHeader';
import { DatePicker } from './DatePicker';
import { DragonOrbIcon } from './DragonOrbIcon';
import PortalPopover from './PortalPopover';
import { buildConsistencyReport, ConsistencyReport } from './consistency';
// Phase 3: dynamic framer-motion & sampleData lazy loading (removed static imports)

type Txn = {
	date?: string;
	post_date?: string;
	description: string;
	amount?: number;
	debit?: number;
	credit?: number;
	balance?: number;
	account_type?: string;
	account_number?: string;
	category?: string; // added when categorization performed
	category_source?: string; // regex | fallback | ai | skip | override
	category_override_reason?: string | null;
	// Added for multi-PDF combined mode: original source file name
	source_file?: string;
};

type ParseResponse = {
	fileName: string;
	metrics: {
		transaction_count: number;
		accounts: number;
		net_amount: number;
		account_types?: string[];
	};
	transactions: Txn[];
	unparsed_sample: string[];
	raw_line_count: number;
	balance_mismatches?: any[];
};

// Extended type when multiple PDFs are combined client-side
type CombinedParseResult = ParseResponse & { sources: ParseResponse[] };

// ---------------- Utility Helpers (module scope; stable across renders) ---------------- //
interface AmountStats { total: number; avg: number; median: number; min: number; max: number; charges: number; credits: number; largestInflow: number; largestOutflow: number; }

const deriveAmountStats = (txs: Txn[]): AmountStats | null => {
	const amounts = txs.map(t => t.amount).filter((a): a is number => typeof a === 'number');
	if(!amounts.length) return null;
	const total = amounts.reduce((s,a)=> s + a, 0);
	const avg = total / amounts.length;
	const sorted=[...amounts].sort((a,b)=>a-b);
	const mid=Math.floor(sorted.length/2);
	const median = sorted.length % 2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2;
	let charges = 0, credits = 0, largestInflow = -Infinity, largestOutflow = Infinity;
	for(const a of amounts){ if(a<0) charges += a; else if(a>0) credits += a; if(a>largestInflow) largestInflow=a; if(a<largestOutflow) largestOutflow=a; }
	return { total, avg, median, min: Math.min(...amounts), max: Math.max(...amounts), charges, credits, largestInflow: largestInflow===-Infinity?0:largestInflow, largestOutflow: largestOutflow===Infinity?0:largestOutflow };
};

// Helper to format numbers with commas and 2 decimals (still used in metrics)
const formatNumber = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Integer formatting for charts (no decimal point)
const formatInt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });

const DEBOUNCE_MS = 220;
const HEALTH_POLL_MS = 10000;
const TXN_ROW_HEIGHT = 32;
// Unified height for standard charts (keeps four-chart row visually consistent)
const CHART_HEIGHT = 180;

// ---- Date helpers (module-scope) ----
// Normalize a date-like string to a local midnight timestamp (ms) for consistent comparisons
const _ymdLocalMs = (y:number,m:number,d:number) => new Date(y, m-1, d, 0,0,0,0).getTime();
const parseDateToLocalMs = (raw?: string): number | null => {
	if(!raw) return null;
	// ISO: YYYY-MM-DD
	const iso = raw.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/);
	if(iso){ const y=Number(iso[1]); const m=Number(iso[2]); const d=Number(iso[3]); return _ymdLocalMs(y,m,d); }
	// Common MDY or DMY with / or -
	const m2 = raw.match(/^([0-9]{1,2})[\/-]([0-9]{1,2})[\/-]([0-9]{2,4})$/);
	if(m2){
		let a = parseInt(m2[1],10); let b = parseInt(m2[2],10); let yStr = m2[3];
		const year = yStr.length===2 ? Number('20'+yStr) : Number(yStr);
		if(a>12 && b<=12) return _ymdLocalMs(year, b, a); // DMY
		if(b>12 && a<=12) return _ymdLocalMs(year, a, b); // MDY
		return _ymdLocalMs(year, a, b); // default assume MDY
	}
	// Fallback to Date.parse then normalize to local Y/M/D
	const t = Date.parse(raw);
	if(isNaN(t)) return null;
	const d = new Date(t);
	return _ymdLocalMs(d.getFullYear(), d.getMonth()+1, d.getDate());
};
const toYMD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

export const App: React.FC = () => {
	// Resolve CSS chart tokens once for Plot configs. Fall back to hard-coded hex if not available.
	const getCssVar = (name: string, fallback = '') => {
		try {
			return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
		} catch (e) {
			return fallback;
		}
	};

	const CHART_COLORS = {
		accent: getCssVar('--chart-accent', '#ffb347'),
		positive: getCssVar('--chart-positive', '#5ad67d'),
		negative: getCssVar('--chart-negative', '#ff6b6b'),
		savings: getCssVar('--chart-savings', '#4db7ff'),
		savingsLight: getCssVar('--chart-savings-light', '#c3e9ff'),
		muted: getCssVar('--chart-muted', '#9fa6b2'),
		category1: getCssVar('--chart-category-1', '#9d7ef7'),
	} as const;

	// Plot-level semantic colors (driven by CSS tokens so Plotly receives concrete colors at runtime)
	const PLOT_COLORS = {
		text: getCssVar('--plot-text', '#e6e9ee'),
		grid: getCssVar('--plot-grid', '#1f2833'),
		line: getCssVar('--plot-line', '#314051'),
		markerEdge: getCssVar('--plot-marker-edge', '#0f1115'),
		alt: getCssVar('--plot-alt', '#384656'),
		hoverBg: getCssVar('--plot-hover-bg', 'rgba(31,40,51,0.78)'),
		hoverBorder: getCssVar('--plot-hover-border', '#314051')
	} as const;

	const [parseResult, setParseResult] = useState<ParseResponse | null>(null);
	// Core UI + data states
	const [error, setError] = useState<string | null>(null);
	const [filter, setFilter] = useState('');
	const [activeAccountTypes, setActiveAccountTypes] = useState<string[]>([]);
	const [backendStatus, setBackendStatus] = useState<'unknown' | 'up' | 'down'>('unknown');
	const [rawFilter, setRawFilter] = useState('');
	const [sort, setSort] = useState<{key:'date'|'description'|'amount'|'balance'; dir:'asc'|'desc'}|null>(null);
	// Additional UI states
	const [loading, setLoading] = useState(false);
	const [liveStatus, setLiveStatus] = useState('');
	const [isHighContrast, setIsHighContrast] = useState(false);
	const [showShortcuts, setShowShortcuts] = useState(false);
	const [isDropActive, setIsDropActive] = useState(false);
	const filterInputRef = useRef<HTMLInputElement | null>(null);
	const [visibleCols, setVisibleCols] = useState({ date: true, description: true, category: false, amount: true, balance: true, type: true, source: false });
	const [showMonthlyAverages, setShowMonthlyAverages] = useState(false);
	const [expandSavings, setExpandSavings] = useState(false); // optional multi-savings expansion
	const [showSankeyFlow, setShowSankeyFlow] = useState<boolean>(()=>{ try { return JSON.parse(localStorage.getItem('showSankeyFlow')||'false'); } catch { return false; } });
	// Active source file filters (only applied when multiple PDFs combined)
	const [activeSources, setActiveSources] = useState<string[]>([]);
	const [categorizeLoading, setCategorizeLoading] = useState(false);
	const [categoriesApplied, setCategoriesApplied] = useState(false);
	const lastCategorizedSnapshotRef = useRef<ParseResponse | null>(null);
	const [justCategorizedFlash, setJustCategorizedFlash] = useState(false);
	const flashTimeoutRef = useRef<number | null>(null);
	const [isRefiningAI, setIsRefiningAI] = useState(false); // visual indicator for post-categorization AI refinement
	const refineStartRef = useRef<number | null>(null);
	const refineAttemptedRef = useRef<boolean>(false); // prevent repeated refine loops if backend doesn't tag 'ai'
	const lastParseSignatureRef = useRef<string|null>(null);
	const [useAI, setUseAI] = useState(true); // user toggle for local AI refinement
	const [showAIConsent, setShowAIConsent] = useState(false);
	const [aiConsentGiven, setAIConsentGiven] = useState<boolean>(() => {
		try { return localStorage.getItem('aiConsent') === '1'; } catch { return false; }
	});
	const [isUnparsedVisible, setIsUnparsedVisible] = useState(false);
	// Toggle for the Parse Quality collapsible explanation
	const [showQualityInfo, setShowQualityInfo] = useState(false);
	// Key used to re-trigger ring SVG animation when clicked
	const [ringAnimKey, setRingAnimKey] = useState<number>(0);
	const [consistencyReport, setConsistencyReport] = useState<ConsistencyReport | null>(null);
	// Ref used to anchor the parse-quality popover (mirrors consistency popover pattern)
	const qualityRef = useRef<HTMLDivElement | null>(null);
	// Cross-highlight + brush selection state for daily net chart
	const [hoverDate, setHoverDate] = useState<string | null>(null);
	// Preferences & auxiliary modals (light theme removed per request)
	const [dateFormat, setDateFormat] = useState<'mdy'|'dmy'>('mdy');
	const [faqOpen, setFaqOpen] = useState(false);
	const [whatsNewOpen, setWhatsNewOpen] = useState(false);
	const [tipsOpen, setTipsOpen] = useState(false); // parsing tips modal
	// Missing UI/helper states
	const [cachedMeta, setCachedMeta] = useState<{
		fileName: string;
		transaction_count: number;
		net_amount: number;
		account_types?: string[];
		ts?: number;
	} | null>(null);
	const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);
	const [dragAnnounce, setDragAnnounce] = useState('');
	const [tourOpen, setTourOpen] = useState(false);
	// Cover: instructional accordion open states (default first open)
	const [openStep, setOpenStep] = useState<{ upload: boolean; filter: boolean; analyze: boolean; export: boolean }>({ upload: true, filter: false, analyze: false, export: false });
	// Date range filter (inclusive). Empty string means no bound.
	const [dateStart, setDateStart] = useState('');
	const [dateEnd, setDateEnd] = useState('');
	// Dataset date bounds (YYYY-MM-DD) derived from loaded transactions
	const [dataMinDate, setDataMinDate] = useState<string>('');
	const [dataMaxDate, setDataMaxDate] = useState<string>('');
	// UI declutter toggles
	const [areMoreActionsOpen, setAreMoreActionsOpen] = useState(false);
	const [showSettings, setShowSettings] = useState(false); // advanced settings panel
	const [showInfoPanel, setShowInfoPanel] = useState(false); // info & utilities panel
	const [areAllFeaturesShown, setAreAllFeaturesShown] = useState(false);
	const [showAdvancedFilters, setShowAdvancedFilters] = useState<boolean>(false);
	// Phase 3 additions: recent files list & quality heuristic
	const [recentFiles, setRecentFiles] = useState<{name:string; ts:number; txns:number}[]>([]);
	useEffect(()=> { try { const raw = localStorage.getItem('recentFiles'); if(raw){ const arr = JSON.parse(raw); if(Array.isArray(arr)) setRecentFiles(arr); } } catch {/* ignore */} }, []);
	const pushRecent = useCallback((name:string, txns:number) => {
		setRecentFiles(prev => {
			const next = [{ name, ts: Date.now(), txns }, ...prev.filter(r=> r.name!==name)].slice(0,5);
			try { localStorage.setItem('recentFiles', JSON.stringify(next)); } catch {/* ignore */}
			return next;
		});
	}, []);
	// About section now always visible (removed toggle)
	// Debounced text filter
	const debouncedFilter = useDebouncedValue(rawFilter, DEBOUNCE_MS);
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	// Backend health polling (with custom hook)
	usePolling(async () => {
		try { await axios.get('/api/health'); setBackendStatus('up'); }
		catch { setBackendStatus('down'); }
	}, HEALTH_POLL_MS, true);

	// Idle prefetch of heavy chart library after initial paint (performance)
	useEffect(() => {
		let cancelled = false;
		const prefetch = () => {
			// dynamic import triggers browser caching before user loads charts
			import('react-plotly.js').catch(()=>{/* ignore */});
		};
		if((window as any).requestIdleCallback){
			(window as any).requestIdleCallback(()=> { if(!cancelled) prefetch(); }, { timeout: 2500 });
		} else {
			const t = setTimeout(()=> { if(!cancelled) prefetch(); }, 1800);
			return () => clearTimeout(t);
		}
		return () => { cancelled = true; };
	}, []);

	// One-shot backend warmup (primes pdf parsing libs) - silent if offline
	useEffect(() => {
		let done = false;
		const kick = () => {
			if(done) return; done = true;
			fetch('/api/warmup', { method: 'GET' }).catch(()=>{/* ignore */});
		};
		if((window as any).requestIdleCallback){
			(window as any).requestIdleCallback(kick, { timeout: 3000 });
		} else {
			const t = setTimeout(kick, 2500);
			return () => clearTimeout(t);
		}
		return () => { done = true; };
	}, []);


	// If persisted preference says AI on but no consent recorded (older sessions), require consent
	useEffect(() => {
		if(useAI && !aiConsentGiven){ setUseAI(false); }
	}, []);

	// Auto-revert categorization status when a new statement (different signature) loads
	useEffect(() => {
		if(!parseResult){ setCategoriesApplied(false); lastParseSignatureRef.current = null; return; }
		const sig = `${parseResult.fileName || ''}::${parseResult.metrics?.transaction_count || 0}`;
		if(lastParseSignatureRef.current && lastParseSignatureRef.current !== sig){
			setCategoriesApplied(false);
		}
		lastParseSignatureRef.current = sig;
	}, [parseResult]);

	// Recompute consistency report whenever full parse result (incl. categorization) changes
	useEffect(() => {
		if(parseResult){
			// Derive dataset date bounds (earliest/latest) and preset date filters
			let minMs: number | null = null; let maxMs: number | null = null;
			for(const tx of parseResult.transactions){
				const ms = parseDateToLocalMs(tx.date);
				if(ms === null) continue;
				if(minMs === null || ms < minMs) minMs = ms;
				if(maxMs === null || ms > maxMs) maxMs = ms;
			}
			if(minMs !== null && maxMs !== null){
				const minStr = toYMD(new Date(minMs));
				const maxStr = toYMD(new Date(maxMs));
				setDataMinDate(minStr);
				setDataMaxDate(maxStr);
				setDateStart(minStr);
				setDateEnd(maxStr);
			}
			try {
				setConsistencyReport(buildConsistencyReport(parseResult.transactions as any));
			} catch (e){
				try { if (process.env.NODE_ENV !== 'production') console.error('Consistency report failed', e); } catch(_) {}
				setConsistencyReport(null);
			}
		} else {
			setConsistencyReport(null);
		}
	}, [parseResult]);


	const requestEnableAI = () => {
		if(aiConsentGiven){ setUseAI(true); return; }
		setShowAIConsent(true);
	};

	const handleAIConsent = (optIn: boolean, remember: boolean) => {
		if(optIn){ setUseAI(true); }
		if(remember){
			try { localStorage.setItem('aiConsent', optIn ? '1':'0'); } catch {/* ignore */}
			setAIConsentGiven(optIn);
		}
		setShowAIConsent(false);
	};

	// Discover cached last parse (offer resume instead of auto-loading for clearer cover UX)
	useEffect(() => {
		try { const cached = localStorage.getItem('lastParse'); const tsRaw = localStorage.getItem('lastParse_ts'); if(cached){ const parsed: ParseResponse = JSON.parse(cached); setCachedMeta({ fileName: parsed.fileName, transaction_count: parsed.metrics.transaction_count, net_amount: parsed.metrics.net_amount, account_types: parsed.metrics.account_types, ts: tsRaw? Number(tsRaw): undefined }); } } catch {/* ignore */}
	}, []);

	// High contrast toggle effect
	useEffect(()=> {
		const cls = 'high-contrast';
		if(isHighContrast) document.documentElement.classList.add(cls); else document.documentElement.classList.remove(cls);
	}, [isHighContrast]);

	// Ensure any legacy light theme class is removed (feature deprecated)
	useEffect(()=> { document.documentElement.classList.remove('light-theme'); }, []);

	// Load persisted UI prefs (ignore legacy lightTheme if present)
	useEffect(()=> {
		try {
			const raw = localStorage.getItem('uiPrefs');
			if(!raw) return; const prefs = JSON.parse(raw);
			if(prefs.dateFormat==='mdy'||prefs.dateFormat==='dmy') setDateFormat(prefs.dateFormat);
			if(prefs.showCols) setVisibleCols((prev)=> ({...prev, ...prefs.showCols}));
			if(Array.isArray(prefs.types)) setActiveAccountTypes(prefs.types);
			if(prefs.sort && prefs.sort.key && prefs.sort.dir) setSort(prefs.sort);
			if(typeof prefs.useAI === 'boolean') setUseAI(prefs.useAI);
		} catch {/* ignore */}
	}, []);


	// Date display helper
	const formatDate = useCallback((d?: string) => {
		if(!d) return '';
		// Expect common forms: YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY
		let y: string, m: string, day: string;
		if(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(d)){ [y,m,day] = d.split('-'); }
		else if(/^[0-9]{2}\/[0-9]{2}\/[0-9]{4}$/.test(d)) { const [a,b,c] = d.split('/'); // ambiguous; assume MDY if >12 switch
			if(Number(a)>12){ day=a; m=b; y=c; } else { m=a; day=b; y=c; }
		} else if(/^[0-9]{2}-[0-9]{2}-[0-9]{4}$/.test(d)) { const [a,b,c]=d.split('-'); if(Number(a)>12){ day=a; m=b; y=c; } else { m=a; day=b; y=c; } }
		else { return d; }
		if(dateFormat==='dmy') return `${day}/${m}/${y}`;
		return `${m}/${day}/${y}`;
	}, [dateFormat]);

	const formatRelativeTime = useCallback((ts?: number) => {
		if(!ts) return '';
		const diff = Date.now() - ts; const s = Math.floor(diff/1000); if(s<60) return s+'s ago'; const m=Math.floor(s/60); if(m<60) return m+'m ago'; const h=Math.floor(m/60); if(h<24) return h+'h ago'; const d=Math.floor(h/24); return d+'d ago';
	}, []);

	const restoreSession = useCallback(() => {
		try { const raw = localStorage.getItem('lastParse'); if(!raw) return; const parsed: ParseResponse = JSON.parse(raw); setParseResult(parsed); setUndoState({}); setActiveAccountTypes(parsed.metrics.account_types || []); setLiveStatus('Session restored.'); } catch {/* ignore */}
	}, []);

	const loadDemoSample = useCallback(async () => {
		setLoading(true);
		try {
			const mod = await import('../ui/sampleData');
			const data = (mod as any).sampleData;
			setParseResult(data as any);
			setUndoState({});
			setActiveAccountTypes(data.metrics.account_types||[]);
			setShowSankeyFlow(false); // Ensure Sankey is off by default in demo
			setLiveStatus('Loaded demo sample.');
			pushRecent('Demo Sample', data.metrics.transaction_count);
		} finally { setLoading(false); }
	}, [pushRecent]);

	// Resume session: if last file was the demo sample, just reload demo; otherwise prompt user to upload again (no raw file persisted for privacy)
	const resumeLastSession = useCallback(() => {
		if(!recentFiles.length) {
			setLiveStatus('No prior session.');
			return;
		}
		const last = recentFiles[0];
		// If demo sample just reload demo
		if(last.name === 'Demo Sample') { loadDemoSample(); return; }
		// Try full restore from cached parse
			try {
				const raw = localStorage.getItem('lastParse');
				if(raw){
					const parsed: ParseResponse = JSON.parse(raw);
					setParseResult(parsed);
					setUndoState({});
					setActiveAccountTypes(parsed.metrics.account_types || []);
					setLiveStatus('Session restored.');
					return;
				}
			} catch {/* ignore */}
		// Fallback if no cached content
		setLiveStatus('Original PDF not stored; select it again to resume.');
		try { (document.querySelector('.upload-btn input') as HTMLInputElement)?.focus(); } catch {/* ignore */}
	}, [recentFiles, loadDemoSample]);

	// Phase 3: defer framer-motion until first meaningful interaction for lighter initial bundle
	const [motionLib, setMotionLib] = useState<any>(null);
	// Ref for fancy Upload button tilt effect
	const uploadBtnRef = useRef<HTMLButtonElement | null>(null);
	const onUploadBtnMove = useCallback((e: React.MouseEvent) => {
		const el = e.currentTarget as HTMLElement;
		const rect = el.getBoundingClientRect();
		const mx = (e.clientX - rect.left) / rect.width; // 0..1
		const my = (e.clientY - rect.top) / rect.height; // 0..1
		el.style.setProperty('--mx', mx.toString());
		el.style.setProperty('--my', my.toString());
	}, []);
	const onUploadBtnLeave = useCallback((e: React.MouseEvent) => {
		const el = e.currentTarget as HTMLElement;
		el.style.removeProperty('--mx');
		el.style.removeProperty('--my');
	}, []);
	useEffect(() => {
		let loaded = false;
		const load = () => {
			if (loaded) return; loaded = true;
			import('framer-motion').then(mod => setMotionLib(mod)).catch(()=>{/* ignore */});
		};
		const first = (e: Event) => { load(); window.removeEventListener('pointerdown', first); window.removeEventListener('keydown', first); };
		window.addEventListener('pointerdown', first, { passive: true });
		window.addEventListener('keydown', first);
		// Safety idle fallback if no interaction within 3s
		const idleTimer = setTimeout(load, 3000);
		return () => { window.removeEventListener('pointerdown', first); window.removeEventListener('keydown', first); clearTimeout(idleTimer); };
	}, []);

	// Helpers to conditionally animate if motion loaded
	const MotionPresence: React.FC<{ children: React.ReactNode }> = ({ children }) => {
		const Comp: any = motionLib?.AnimatePresence || React.Fragment;
		return <Comp>{children}</Comp>;
	};
	const MotionSection: React.FC<React.HTMLAttributes<HTMLElement>> = ({ children, className }) => {
		const M: any = motionLib?.motion?.section;
		if (M) return <M className={className} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
			{children}
		</M>;
		return <section className={className}>{children}</section>;
	};
	const MotionDiv: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ children, className, style }) => {
		const M: any = motionLib?.motion?.div;
		if (M) return <M className={className} style={style} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
			{children}
		</M>;
		return <div className={className} style={style}>{children}</div>;
	};

	const parseStatementFile = useCallback(async (file: File) => {
		setLoading(true); setError(null); setLiveStatus('Uploading…');
		try {
			const form = new FormData(); form.append('file', file);
			const res = await axios.post<ParseResponse>('/api/parse?debug=1', form, { headers: { 'Content-Type': 'multipart/form-data' } });
			setParseResult(res.data); setUndoState({}); setActiveAccountTypes(res.data.metrics.account_types || []);
			setActiveSources([res.data.fileName]);
			setCategoriesApplied(false); // reset categorization state for new file
			refineAttemptedRef.current = false; // reset refine attempt for new data
			try { localStorage.setItem('lastParse', JSON.stringify(res.data)); localStorage.setItem('lastParse_ts', Date.now().toString()); } catch {/* ignore */}
			pushRecent(res.data.fileName, res.data.metrics.transaction_count);
			setLiveStatus(`Parsed ${res.data.metrics.transaction_count} transactions.`);
		} catch (err: any) {
			const detail = err?.response?.data?.detail;
			try { if (process.env.NODE_ENV !== 'production') console.error('Upload parse error', err?.response?.status, detail); } catch(_) {}
			if (detail && typeof detail === 'object') setError(detail.message || JSON.stringify(detail)); else setError(detail || err.message);
			setLiveStatus('Upload failed.');
		} finally { setLoading(false); }
	}, []);

	// Parse multiple PDFs (parallel with limited concurrency) then merge client-side
	const parseMultipleFiles = useCallback(async (files: File[]) => {
		if(!files.length) return;
		setLoading(true); setError(null); setLiveStatus(`Parsing ${files.length} PDFs…`);
		const results: ParseResponse[] = [];
		const concurrency = Math.min(3, files.length);
		let completed = 0;
		let index = 0;
		const runNext = async (): Promise<void> => {
			const i = index++; if(i >= files.length) return;
			const f = files[i];
			try {
				setLiveStatus(`(${completed+1}/${files.length}) ${f.name}…`);
				const form = new FormData(); form.append('file', f);
				const res = await axios.post<ParseResponse>('/api/parse', form, { headers: { 'Content-Type': 'multipart/form-data' } });
				results.push(res.data);
				pushRecent(res.data.fileName, res.data.metrics.transaction_count);
				} catch (e:any) {
				try { if (process.env.NODE_ENV !== 'production') console.error('Multi parse error', f.name, e); } catch(_) {}
				setUploadWarnings(w=> [...w, `Failed to parse ${f.name}: ${e?.response?.data?.detail || e.message}`]);
			} finally {
				completed++;
				setLiveStatus(`Completed ${completed}/${files.length}`);
				await runNext();
			}
		};
		await Promise.all(new Array(concurrency).fill(0).map(()=> runNext()));
		try {
			if(!results.length){ setError('All selected files failed to parse.'); setLiveStatus('Multi-upload failed.'); return; }
			if(results.length === 1) {
				const single = results[0];
				setParseResult(single);
				setUndoState({});
				setActiveAccountTypes(single.metrics.account_types || []);
				setActiveSources([single.fileName]);
				setCategoriesApplied(false); refineAttemptedRef.current = false;
				setLiveStatus(`Parsed 1 file (${single.metrics.transaction_count} transactions).`);
				try { localStorage.setItem('lastParse', JSON.stringify(single)); localStorage.setItem('lastParse_ts', Date.now().toString()); } catch {/* ignore */}
				return;
			}
			// Merge
			const mergedTxns: Txn[] = [];
			const allTypes = new Set<string>();
			let net = 0; let txnCount = 0;
			results.forEach(r => {
				mergedTxns.push(...r.transactions.map(tx => ({ ...tx, source_file: r.fileName })));
				txnCount += r.metrics.transaction_count;
				net += r.metrics.net_amount;
				(r.metrics.account_types||[]).forEach(t=> allTypes.add(t));
			});
			// Optional sort by date if present
			mergedTxns.sort((a,b)=> (a.date||'').localeCompare(b.date||''));
			const merged: CombinedParseResult = {
				fileName: results.map(r=> r.fileName).join(' + '),
				metrics: {
					transaction_count: txnCount,
					accounts: allTypes.size,
					net_amount: net,
					...(allTypes.size? { account_types: Array.from(allTypes).sort() }: {})
				},
				transactions: mergedTxns,
				unparsed_sample: results.flatMap(r=> r.unparsed_sample).slice(0,100),
				raw_line_count: results.reduce((s,r)=> s + r.raw_line_count, 0),
				balance_mismatches: results.flatMap(r=> r.balance_mismatches || []),
				sources: results
			};
			setParseResult(merged);
			setUndoState({});
			setActiveSources(results.map(r=> r.fileName));
			setActiveAccountTypes(merged.metrics.account_types || []);
			setCategoriesApplied(false); refineAttemptedRef.current = false;
			setLiveStatus(`Parsed ${results.length} files · ${txnCount} transactions combined.`);
			try { localStorage.setItem('lastParse', JSON.stringify(merged)); localStorage.setItem('lastParse_ts', Date.now().toString()); } catch {/* ignore */}
		} finally {
			setLoading(false);
		}
	}, [pushRecent]);

	// Lightweight PDF page count heuristic (avoid heavy pdfjs dependency) using pattern count
	const estimatePdfPageCount = useCallback(async (file: File): Promise<number | null> => {
		try {
			// Guard very large files (>20MB) to prevent memory spike (we already warn at 15MB)
			if(file.size > 20 * 1024 * 1024) return null;
			const buf = await file.arrayBuffer();
			// Decode as latin1 to preserve byte positions cheaply
			const text = new TextDecoder('latin1').decode(buf);
			// Count '/Type /Page' tokens (word boundary to avoid '/Type /Pages')
			const matches = text.match(/\/Type\s*\/Page\b/g);
			return matches ? matches.length : null;
		} catch { return null; }
	}, []);

	const handleSelectedFiles = useCallback(async (files: File[]) => {
		const pdfs = files.filter(f=> f.type==='application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
		if(!pdfs.length) return;
		if(pdfs.length === 1){
			const file = pdfs[0];
			const warnings: string[] = [];
			if(file.size > 15 * 1024 * 1024) warnings.push('File exceeds 15MB guideline (may parse slower).');
			const pages = await estimatePdfPageCount(file);
			if(pages !== null && pages > 12) warnings.push(`Detected ~${pages} pages (>12). Consider splitting to one statement.`);
			if(warnings.length) setUploadWarnings(warnings); else setUploadWarnings([]);
			await parseStatementFile(file);
			return;
		}
		// Multi-file: basic aggregate warnings
		const warnings: string[] = [];
		let largeCount = 0; let manyPages = 0;
		for(const f of pdfs){
			if(f.size > 15 * 1024 * 1024) largeCount++;
			const pages = await estimatePdfPageCount(f);
			if(pages !== null && pages > 12) manyPages++;
		}
		if(largeCount) warnings.push(`${largeCount} file(s) exceed 15MB guideline.`);
		if(manyPages) warnings.push(`${manyPages} file(s) detected with >12 pages.`);
		if(warnings.length) setUploadWarnings(warnings); else setUploadWarnings([]);
		await parseMultipleFiles(pdfs);
	}, [estimatePdfPageCount, parseStatementFile, parseMultipleFiles]);

	const onFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		const files = e.target.files ? Array.from(e.target.files) : [];
		if(files.length) handleSelectedFiles(files);
	}, [handleSelectedFiles]);
	// Debounced filter application (single effect)
	useEffect(() => { setFilter(debouncedFilter); }, [debouncedFilter]);

	// Keyboard shortcut for focusing filter (Meta/Ctrl + K) with flash animation
	useEffect(() => {
		const triggerFlash = () => {
			const el = filterInputRef.current; if(!el) return; el.classList.remove('filter-focus-anim'); void el.offsetWidth; el.classList.add('filter-focus-anim');
		};
		const handler = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); filterInputRef.current?.focus(); triggerFlash(); }
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, []);

	// Compute filtered rows and sum in one pass
	const { filteredTxns, filteredNet } = useMemo(() => {
		const result = { filteredTxns: [] as Txn[], filteredNet: 0 };
		if (!parseResult) return result;
		const fLower = filter.toLowerCase();
        const multiSources = (parseResult as any).sources && Array.isArray((parseResult as any).sources) && (parseResult as any).sources.length > 1;
		// Helper: parse YYYY-MM-DD or ambiguous forms into a LOCAL midnight timestamp to avoid UTC shift.
		const ymdLocalMs = (y:number,m:number,d:number) => new Date(y, m-1, d, 0,0,0,0).getTime();
		const parseTxDate = (raw?: string): number | null => {
			if(!raw) return null;
			// ISO fast path (YYYY-MM-DD) -> local
			const iso = raw.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/);
			if(iso){ const y=Number(iso[1]); const m=Number(iso[2]); const d=Number(iso[3]); return ymdLocalMs(y,m,d); }
			// Common MDY or DMY with / or - separators
			const m2 = raw.match(/^([0-9]{1,2})[/-]([0-9]{1,2})[/-]([0-9]{2,4})$/);
			if(m2){
				let a = parseInt(m2[1],10); let b = parseInt(m2[2],10); let yStr = m2[3];
				const year = yStr.length===2 ? Number('20'+yStr) : Number(yStr);
				// If clearly day-first
				if(a>12 && b<=12){ return ymdLocalMs(year, b, a); }
				if(b>12 && a<=12){ return ymdLocalMs(year, a, b); }
				// Default assume a=month, b=day
				return ymdLocalMs(year, a, b);
			}
			// Fallback: let Date try; then normalize to local Y/M/D to strip TZ
			const t = Date.parse(raw);
			if(isNaN(t)) return null;
			const d = new Date(t);
			return ymdLocalMs(d.getFullYear(), d.getMonth()+1, d.getDate());
		};
		const startMs = dateStart ? (()=>{ const m = dateStart.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/); if(m) return ymdLocalMs(Number(m[1]),Number(m[2]),Number(m[3])); return parseTxDate(dateStart); })() : null;
		const endMs = dateEnd ? (()=>{ const m = dateEnd.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/); if(m){ // add end of day (23:59:59.999)
			const base = ymdLocalMs(Number(m[1]),Number(m[2]),Number(m[3]));
			return base + (24*60*60*1000) - 1; }
			const p = parseTxDate(dateEnd); return p !== null ? p + (24*60*60*1000) - 1 : null; })() : null;
		// Support category-specific filter prefix: cat:food
		let filterCategory: string | null = null;
		if(filter.startsWith('cat:')){ filterCategory = filter.slice(4).trim().toLowerCase(); }
		for (const tx of parseResult.transactions) {
			if (filterCategory){
				if(!tx.category || tx.category.toLowerCase().indexOf(filterCategory) === -1) continue;
			} else if (filter && !tx.description?.toLowerCase().includes(fLower)) continue;
			if (activeAccountTypes.length && tx.account_type && !activeAccountTypes.includes(tx.account_type)) continue;
			if (multiSources && activeSources.length){
				// If tx has a source_file enforce membership; if missing, treat as excluded only if any source filters set
				if(!tx.source_file || !activeSources.includes(tx.source_file)) continue;
			}
			if (startMs !== null || endMs !== null) {
				const tms = parseTxDate(tx.date);
				if(tms === null) continue; // Exclude rows with un-parseable dates when date range active
				if(startMs !== null && tms < startMs) continue;
				if(endMs !== null && tms > endMs) continue;
			}
			result.filteredTxns.push(tx);
			if (typeof tx.amount === 'number') result.filteredNet += tx.amount;
		}
		if (sort) {
			const { key, dir } = sort;
			const mul = dir === 'asc' ? 1 : -1;
			result.filteredTxns.sort((a,b) => {
				let av: any; let bv: any;
				switch(key){
					case 'amount': av = a.amount ?? 0; bv = b.amount ?? 0; break;
					case 'balance': av = a.balance ?? 0; bv = b.balance ?? 0; break;
					case 'date': av = a.date || ''; bv = b.date || ''; break;
					case 'description': av = a.description || ''; bv = b.description || ''; break;
				}
				if (av < bv) return -1 * mul;
				if (av > bv) return 1 * mul;
				return 0;
			});
		}
		return result;
	}, [parseResult, filter, activeAccountTypes, activeSources, sort, dateStart, dateEnd]);

	// Filter-aware consistency report for UI (reacts to filters)
	const filteredConsistencyReport = useMemo(() => {
		try { return filteredTxns.length ? buildConsistencyReport(filteredTxns as any) : null; }
		catch { return null; }
	}, [filteredTxns]);
	const canExpandSavings = useMemo(() => {
		const seen: Record<string,1> = {};
		for(const t of filteredTxns){
			if((t.category||'').toLowerCase() !== 'savings') continue;
			const key = (t.account_number||'').trim();
			if(!key) continue; // ignore missing account numbers, treat as single aggregate
			seen[key] = 1;
			if(Object.keys(seen).length > 1) return true;
		}
		return false;
	}, [filteredTxns]);

	const canMonthlyAverage = useMemo(() => {
		const dates = filteredTxns.map(t=> t.date).filter(Boolean) as string[];
		if(dates.length < 2) return false;
		const sorted = [...dates].sort();
		const first = new Date(sorted[0]); const last = new Date(sorted[sorted.length-1]);
		const months = (last.getFullYear()-first.getFullYear())*12 + (last.getMonth()-first.getMonth()) + 1;
		return months > 1;
	}, [filteredTxns]);

	const toggleSort = (key:'date'|'description'|'amount'|'balance') => {
		setSort(prev => {
			if (!prev || prev.key !== key) return { key, dir:'asc' };
			if (prev.dir === 'asc') return { key, dir:'desc' };
			return null; // third click clears
		});
	};

	const filteredVsOverallChart = useMemo(() => {
		if (!parseResult) return null;
		// Use computed overall net from transactions for consistency with other metrics
		const overall = parseResult.transactions.reduce((sum, t) => sum + (typeof t.amount === 'number' ? t.amount : 0), 0);
		return {
			data: [{
				type: 'bar',
				orientation: 'h',
				x: [filteredNet, overall],
				y: ['Filtered', 'Overall'],
				marker: { color: [CHART_COLORS.accent, PLOT_COLORS.alt] },
				text: [formatInt(filteredNet), formatInt(overall)],
				textposition: 'inside',
				insidetextanchor: 'middle',
				textfont: { color: [PLOT_COLORS.markerEdge, PLOT_COLORS.text], size: 11 },
				hovertemplate: '%{y}: %{x:,.0f}<extra></extra>'
			}],
			layout: {
				height: CHART_HEIGHT,
				title: { text: 'Filtered vs Overall', font: { color: PLOT_COLORS.text, size: 13 } },
				margin: { l: 60, r: 6, t: 32, b: 22 },
				paper_bgcolor: 'rgba(0,0,0,0)',
				plot_bgcolor: 'rgba(0,0,0,0)',
				font: { color: PLOT_COLORS.text, size: 11 },
				xaxis: { gridcolor: PLOT_COLORS.grid, zerolinecolor: PLOT_COLORS.grid, linecolor: PLOT_COLORS.line, tickformat: ',.0f' },
				yaxis: { gridcolor: PLOT_COLORS.grid, zerolinecolor: PLOT_COLORS.grid, linecolor: PLOT_COLORS.line },
				showlegend: false
			}
		};
	}, [parseResult, filteredNet]);

	const dailyNetChart = useMemo(() => {
		if (!filteredTxns.length) return null;
		const byDay = new Map<string, number>();
		filteredTxns.forEach(t => { if (!t.date || typeof t.amount !== 'number') return; byDay.set(t.date, (byDay.get(t.date) || 0) + t.amount); });
		const days = [...byDay.keys()].sort();
		const vals = days.map(d => byDay.get(d) || 0);
		const cum: number[] = []; vals.reduce((acc, v) => { const n = acc + v; cum.push(n); return n; }, 0);
		// Determine y-range for potential hover shape
		const allY = vals.concat(cum);
		const yMin = Math.min(...allY);
		const yMax = Math.max(...allY);
		const shapes = [] as any[];
		let highlightTraces: any[] = [];
		if (hoverDate && days.includes(hoverDate)) {
			// (Line removed: rely on unified hover vertical guide styled via CSS to avoid duplicate lines)
			const idx = days.indexOf(hoverDate);
			if (idx > -1) {
				// Emphasized markers on both series at hovered date (outline matches dark bg)
				highlightTraces = [
					{
						type: 'scatter', mode: 'markers',
						x: [hoverDate], y: [vals[idx]],
						marker: { size: 11, color: CHART_COLORS.positive, line: { color: PLOT_COLORS.markerEdge, width: 2 } },
						showlegend: false, hoverinfo: 'skip'
					},
					{
						type: 'scatter', mode: 'markers',
						x: [hoverDate], y: [cum[idx]],
						marker: { size: 11, color: CHART_COLORS.accent, line: { color: PLOT_COLORS.markerEdge, width: 2 } },
						showlegend: false, hoverinfo: 'skip'
					}
				];
			}
		}
		return {
			data: [
				{ type: 'scatter', mode: 'lines+markers', x: days, y: vals, name: 'Daily', line: { color: CHART_COLORS.positive }, marker: { color: CHART_COLORS.positive, size: 5 }, hovertemplate: 'Daily %{x}<br>%{y:,.0f}<extra></extra>' },
				{ type: 'scatter', mode: 'lines', x: days, y: cum, name: 'Cumulative', line: { dash: 'dot', color: CHART_COLORS.accent }, hovertemplate: 'Cumulative %{x}<br>%{y:,.0f}<extra></extra>' },
				...highlightTraces
			],
			layout: {
				height: CHART_HEIGHT,
				title: { text: 'Daily Net', font: { color: PLOT_COLORS.text, size: 13 } },
				margin: { l: 60, r: 6, t: 32, b: 40 },
				paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { color: PLOT_COLORS.text, size: 11 },
				xaxis: { gridcolor: PLOT_COLORS.grid, linecolor: PLOT_COLORS.line, tickfont: { color: PLOT_COLORS.text, size: 10 } },
				yaxis: { gridcolor: PLOT_COLORS.grid, linecolor: PLOT_COLORS.line, tickformat: ',.0f', tickfont: { color: PLOT_COLORS.text, size: 10 }, automargin: true },
				legend: { orientation: 'h', x: 0, y: 1.12, font: { color: PLOT_COLORS.text, size: 10 } },
				shapes,
				hoverlabel: { bgcolor: PLOT_COLORS.hoverBg, bordercolor: PLOT_COLORS.hoverBorder, font: { color: PLOT_COLORS.text, size: 10 }, align: 'left' },
				dragmode: 'select',
				hovermode: 'x unified'
			},
			config: { displaylogo: false, modeBarButtonsToAdd: ['select2d','lasso2d'] }
		};
	}, [filteredTxns, hoverDate]);

	// Dynamic third chart: account type pie (checking/savings) OR credit card charges vs payments
	// Account type mix chart (pre-categorization fallback)
	const accountTypeMixChart = useMemo(() => {
		if(!filteredTxns.length) return null;
		const canonical = ['checking','savings','credit_card'];
		const sums: Record<string, number> = { checking:0, savings:0, credit_card:0 };
		for(const t of filteredTxns){
			const key = (t.account_type||'').toLowerCase();
			if(canonical.includes(key) && typeof t.amount === 'number') sums[key] += t.amount;
		}
		if(Object.values(sums).every(v => v === 0)) return null;
		const labels = canonical.map(k => k.replace('_',' '));
		const values = canonical.map(k => sums[k]);
		// Dynamic left margin: scale with longest label length (approx 7px per char) but clamp for consistency
		const longest = labels.reduce((a,b)=> a.length>b.length?a:b, '');
		const leftMargin = Math.min(105, Math.max(54, longest.length * 7));
		return {
			data: [{ type:'bar', x: values, y: labels, orientation:'h', marker:{ color:[CHART_COLORS.positive, CHART_COLORS.accent, CHART_COLORS.category1], line:{ color:PLOT_COLORS.grid, width:1 } }, text: values.map(v=> formatInt(v)), textposition:'inside', insidetextanchor:'middle', hovertemplate:'<b>%{y}</b><br>%{x:,.0f}<extra></extra>' }],
				layout: { height:CHART_HEIGHT, title:{ text:'Account Type Mix (Net Flow)', font:{ color:PLOT_COLORS.text, size:13 } }, margin:{ l:leftMargin, r:4, t:34, b:24 }, paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'rgba(0,0,0,0)', font:{ color:PLOT_COLORS.text, size:11 }, xaxis:{ tickformat:',.0f', gridcolor:PLOT_COLORS.grid, linecolor:PLOT_COLORS.line, zerolinecolor:PLOT_COLORS.grid }, yaxis:{ gridcolor:PLOT_COLORS.grid, linecolor:PLOT_COLORS.line, automargin:true }, showlegend:false }
		};
	}, [filteredTxns]);

	// Income / Savings / Expense chart (post-categorization)
	const incomeSavingsExpenseChart = useMemo(() => {
		if(!filteredTxns.length) return null;
		let income = 0, savings = 0, expenseOut = 0;
		for(const t of filteredTxns){
			if(typeof t.amount !== 'number') continue;
			const cat = (t.category || '').toLowerCase();
			if(cat === 'account transfer') continue;
			if(cat === 'income') { if(t.amount > 0) income += t.amount; continue; }
			if(cat === 'savings') { if(t.amount > 0) savings += t.amount; continue; }
			// Treat only negative amounts (money leaving) as expense contributions
			if(t.amount < 0) expenseOut += Math.abs(t.amount);
		}
		if(income === 0 && savings === 0 && expenseOut === 0) return null;
		const labels = ['Income','Savings','Expense'];
		const values = [income, savings, expenseOut];
		const colors = [CHART_COLORS.positive, CHART_COLORS.savings, CHART_COLORS.negative];
		const longest = labels.reduce((a,b)=> a.length>b.length?a:b,'');
		const leftMargin = Math.min(105, Math.max(54, longest.length * 7));
		return {
			data: [{ type:'bar', orientation:'h', x: values, y: labels, marker:{ color: colors, line:{ color:PLOT_COLORS.grid, width:1 } }, text: values.map(v=> formatInt(v)), textposition:'inside', insidetextanchor:'middle', hovertemplate:'<b>%{y}</b><br>%{x:,.0f}<extra></extra>' }],
				layout: { height:CHART_HEIGHT, title:{ text:'Income · Savings · Expense (Gross Flows)', font:{ color:PLOT_COLORS.text, size:13 } }, margin:{ l:leftMargin, r:4, t:34, b:24 }, paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'rgba(0,0,0,0)', font:{ color:PLOT_COLORS.text, size:11 }, xaxis:{ tickformat:',.0f', gridcolor:PLOT_COLORS.grid, linecolor:PLOT_COLORS.line, zerolinecolor:PLOT_COLORS.grid }, yaxis:{ gridcolor:PLOT_COLORS.grid, linecolor:PLOT_COLORS.line, automargin:true }, showlegend:false }
		};
	}, [filteredTxns]);

	// Unified variable used in render
	const accountMixChart = useMemo(() => {
		if(!filteredTxns.length) return null;
		return categoriesApplied ? incomeSavingsExpenseChart : accountTypeMixChart;
	}, [filteredTxns, categoriesApplied, incomeSavingsExpenseChart, accountTypeMixChart]);

	// Credit charges vs payments chart (shown if any credit_card present)
	const creditChargesChart = useMemo(() => {
		if(!filteredTxns.length) return null;
		const creditTxns = filteredTxns.filter(t => (t.account_type||'').toLowerCase()==='credit_card');
		let charges=0, payments=0;
		if(creditTxns.length){
			for(const t of creditTxns){ if(typeof t.amount!=='number') continue; if(t.amount<0) charges+= -t.amount; else payments+= t.amount; }
		} else {
			// No direct credit card account present. Infer payments from checking/savings Account Transfers referencing credit card.
			for(const t of filteredTxns){
				if(!t.category || t.category.toLowerCase() !== 'account transfer') continue;
				if(typeof t.amount !== 'number') continue;
				// Looking for negative outflows that mention credit card keywords
				if(t.amount < 0 && /credit card|visa|mastercard|amex|discover/i.test(t.description || '')) {
					payments += -t.amount; // treat as payment magnitude
				}
			}
			// Without credit card statement we can't derive charges; show nothing if no inferred payments
			if(payments === 0) return null;
		}
		if(charges===0 && payments===0) return null;
		const payoffRatio = charges>0 ? payments/charges : null;
		const labels = ['Charges','Payments'];
		const longest = labels.reduce((a,b)=> a.length>b.length?a:b,'');
		const leftMargin = Math.min(105, Math.max(54, longest.length * 7));
		return {
			data:[{ type:'bar', orientation:'h', x:[charges,payments], y:['Charges','Payments'], marker:{ color:[CHART_COLORS.negative, CHART_COLORS.positive], line:{ color:PLOT_COLORS.grid, width:1 } }, text:[formatInt(charges), formatInt(payments)], textposition:'inside', insidetextanchor:'middle', textfont:{ color:PLOT_COLORS.markerEdge, size:11 }, hovertemplate:'<b>%{y}</b><br>%{x:,.0f}<extra></extra>' }],
				layout:{ height:CHART_HEIGHT, title:{ text:'Credit Charges vs Payments'+(payoffRatio!==null?` (Payoff ${Math.round(payoffRatio*1000)/10}% )`:(charges===0? ' (Inferred Payments)':'') ) , font:{ color:PLOT_COLORS.text, size:13 } }, margin:{ l:leftMargin, r:4, t:34, b:26 }, paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'rgba(0,0,0,0)', font:{ color:PLOT_COLORS.text, size:11 }, xaxis:{ tickformat:',.0f', gridcolor:PLOT_COLORS.grid, linecolor:PLOT_COLORS.line, zerolinecolor:PLOT_COLORS.grid }, yaxis:{ gridcolor:PLOT_COLORS.grid, linecolor:PLOT_COLORS.line, automargin:true }, showlegend:false, hoverlabel:{ bgcolor:PLOT_COLORS.hoverBg, bordercolor:PLOT_COLORS.hoverBorder, font:{ color:PLOT_COLORS.text, size:10 } }, shapes:(charges>0 && payments>0)?[{ type:'line', x0:charges, x1:charges, y0:-0.5, y1:1.5, line:{ color:PLOT_COLORS.line, width:1, dash:'dot' }}]:[] }
		};
	}, [filteredTxns]);

	// Redesigned Sankey: three conceptual levels for clarity:
	// Level 0: Income (single aggregated source)
	// Level 1: Allocation buckets (Savings, Spending)
	// Level 2: Top Spending Categories (grouped tail as Other)
	// Rationale: Users read left→right story: "Where did income go?" rather than mixing savings with categories directly.
	const sankeyChart = useMemo(() => {
		if(!filteredTxns.length) return null;
		let totalIncome = 0; let totalSavings = 0; const spendingByCat: Record<string, number> = {};
		const savingsByAcct: Record<string, number> = {};
		let anonCounter = 0;
		for(const t of filteredTxns){
			if(typeof t.amount !== 'number') continue;
			const cat = (t.category||'').toLowerCase();
			if(cat === 'account transfer') continue;
			// Align with allocation logic: ignore credit card positives as income
			if(cat === 'income' && t.amount > 0){
				if((t.account_type||'').toLowerCase() !== 'credit_card') { totalIncome += t.amount; }
				continue;
			}
			if(cat === 'savings' && t.amount > 0){
				totalSavings += t.amount;
				let key = (t.account_number||'').trim();
				if(!key) key = `__anon_${++anonCounter}`;
				savingsByAcct[key] = (savingsByAcct[key]||0) + t.amount;
				continue;
			}
			if(t.amount < 0){
				const label = t.category && cat !== 'income' && cat !== 'savings' ? t.category : 'Uncategorized';
				spendingByCat[label] = (spendingByCat[label]||0) + Math.abs(t.amount);
			}
		}
		const totalSpending = Object.values(spendingByCat).reduce((s,v)=> s+v,0);
		if(totalIncome===0 && totalSavings===0 && totalSpending===0) return null;
		let catEntries = Object.entries(spendingByCat).sort((a,b)=> b[1]-a[1]);
		const MAX_CATS = 8; const MIN_SHARE = 0.03;
		if(catEntries.length > MAX_CATS){
			const head: [string,number][] = []; let otherVal = 0;
			catEntries.forEach((e,i)=>{ const share = totalSpending? e[1]/totalSpending:0; if(i<MAX_CATS && share>=MIN_SHARE) head.push(e); else otherVal += e[1]; });
			catEntries = otherVal>0? [...head, ['Other', otherVal]] : head;
		}
		const categories = catEntries.map(e=> e[0]);
		const catValues = catEntries.map(e=> e[1]);
		const savingsAcctKeys = Object.entries(savingsByAcct).filter(([,v])=> v>0).sort((a,b)=> b[1]-a[1]).map(([k])=> k);
		const multiSavings = expandSavings && savingsAcctKeys.length > 1;
		const incomeIdx = 0;
		let spendingIdx: number; let savingsIdx: number | null = null; let firstSavingsIdx = -1; let catOffset: number;
		// Optional monthly averages annotation (kept compact)
		let months = 1;
		if(showMonthlyAverages){
			const dates = filteredTxns.map(t=> t.date).filter(Boolean) as string[];
			if(dates.length){
				const sorted = [...dates].sort();
				const first = new Date(sorted[0]); const last = new Date(sorted[sorted.length-1]);
				months = (last.getFullYear()-first.getFullYear())*12 + (last.getMonth()-first.getMonth()) + 1;
				if(months < 1) months = 1;
			}
		}
		const fmt = (v:number)=> formatInt(Math.round(v));
		const avgSuffix = (v:number)=> showMonthlyAverages && months>1 ? `\n(avg ${fmt(v/months)}/mo)` : '';
		const nodes: string[] = [`Income${avgSuffix(totalIncome)}`];
		if(multiSavings){
			spendingIdx = nodes.length; nodes.push(`Spending${avgSuffix(totalSpending)}`);
			firstSavingsIdx = nodes.length;
			savingsAcctKeys.forEach((acctKey, i) => {
				const digits = acctKey.replace(/\D/g,'');
				const suffix = digits ? digits.slice(-4) : String(i+1);
				nodes.push(`Savings ${suffix}`);
			});
			catOffset = nodes.length; // provisional; may shift if Unallocated added
		} else {
			savingsIdx = nodes.length; nodes.push(`Savings${avgSuffix(totalSavings)}`);
			spendingIdx = nodes.length; nodes.push(`Spending${avgSuffix(totalSpending)}`);
			catOffset = nodes.length; // provisional; may shift if Unallocated added
		}
		// Determine allocation & residual BEFORE adding categories
		const allocSavings = Math.min(totalSavings, totalIncome);
		const allocSpending = Math.min(totalSpending, totalIncome - allocSavings);
		const residual = totalIncome - allocSavings - allocSpending; // income not explained by savings or spending outflows in period
		let unallocatedIdx: number | null = null;
		if(residual > Math.max(0.005 * totalIncome, 1)){ // show if >0.5% of income or >1 unit
			unallocatedIdx = nodes.length; nodes.push(`Unallocated${avgSuffix(residual)}`);
		}
		catOffset = nodes.length;
		nodes.push(...categories);
		const source:number[] = []; const target:number[] = []; const value:number[] = []; const linkColor:string[] = []; const customPercent: number[] = [];

		// --- Color ramp helpers ---
		const hexToRgb = (hex:string): [number,number,number] => {
			const clean = hex.replace('#','');
			return [parseInt(clean.substring(0,2),16), parseInt(clean.substring(2,4),16), parseInt(clean.substring(4,6),16)];
		};
		const lerp = (a:number,b:number,t:number)=> a + (b-a)*t;
		const interpHex = (c1:string,c2:string,t:number)=>{
			const [r1,g1,b1] = hexToRgb(c1); const [r2,g2,b2] = hexToRgb(c2);
			const r = Math.round(lerp(r1,r2,t)); const g = Math.round(lerp(g1,g2,t)); const b = Math.round(lerp(b1,b2,t));
			return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
		};
		const buildGradient = (start:string,end:string,steps:number)=>{
			if(steps<=1) return [start];
			const arr:string[] = [];
			for(let i=0;i<steps;i++) arr.push(interpHex(start,end, i/(steps-1)));
			return arr;
		};
		const valueGradient = (values: number[], start: string, end: string) => {
				if(!values || !values.length) return [] as string[];
				const base = buildGradient(start, end, values.length);
				const max = Math.max(...values); const min = Math.min(...values);
				const range = Math.max(1e-9, max - min);
				return values.map((v,i) => {
					const rel = (v - min)/range; // 0..1
					const influence = rel * 0.35; // cap darkening to 35%
					return interpHex(base[i], end, influence);
				});
			};
			const hexToRgba = (hex: string, a: number) => {
				const [r,g,b] = hexToRgb(hex);
				return `rgba(${r}, ${g}, ${b}, ${a})`;
			};
		const savingsValues = multiSavings ? savingsAcctKeys.map(k => savingsByAcct[k]) : [];
	let savingsGradient = multiSavings ? valueGradient(savingsValues, CHART_COLORS.savingsLight, CHART_COLORS.savings) : [];
	let categoryGradient = valueGradient(catValues, CHART_COLORS.accent, CHART_COLORS.negative);
		// Reverse gradient order per user request
		if(savingsGradient.length) savingsGradient = [...savingsGradient].reverse();
		if(categoryGradient.length) categoryGradient = [...categoryGradient].reverse();
		if(multiSavings){
			if(allocSpending>0){ source.push(incomeIdx); target.push(spendingIdx); value.push(allocSpending); linkColor.push(hexToRgba(CHART_COLORS.accent,0.7)); }
			if(allocSavings>0){ savingsAcctKeys.forEach((k,i)=> { const v = savingsByAcct[k]; if(v>0){ const capped = Math.min(v, allocSavings); source.push(incomeIdx); target.push(firstSavingsIdx + i); value.push(capped); linkColor.push(hexToRgba(savingsGradient[i],0.65)); }}); }
		} else {
			if(allocSavings>0 && savingsIdx!==null){ source.push(incomeIdx); target.push(savingsIdx); value.push(allocSavings); linkColor.push(hexToRgba(CHART_COLORS.savings,0.7)); }
			if(allocSpending>0){ source.push(incomeIdx); target.push(spendingIdx); value.push(allocSpending); linkColor.push(hexToRgba(CHART_COLORS.accent,0.7)); }
		}
	if(unallocatedIdx!==null){ source.push(incomeIdx); target.push(unallocatedIdx); value.push(residual); linkColor.push(hexToRgba(CHART_COLORS.muted,0.55)); }
		catValues.forEach((v,i)=> { if(v>0){ source.push(spendingIdx); target.push(catOffset + i); value.push(v); linkColor.push(hexToRgba(categoryGradient[i],0.34)); }});
		const srcTotals: Record<number, number> = {};
		value.forEach((v,i)=> { srcTotals[source[i]] = (srcTotals[source[i]]||0) + v; });
		for(let i=0;i<value.length;i++){ const tot = srcTotals[source[i]]||0; customPercent[i] = tot? (value[i]/tot*100) : 0; }
	const catPalette = [CHART_COLORS.category1, CHART_COLORS.savings, CHART_COLORS.accent, CHART_COLORS.positive, CHART_COLORS.savings, CHART_COLORS.accent, CHART_COLORS.positive, CHART_COLORS.savings, CHART_COLORS.accent, CHART_COLORS.positive];
		let nodeColors: string[];
		if(multiSavings){
			nodeColors = [CHART_COLORS.positive, CHART_COLORS.accent, ...savingsGradient];
		} else {
			nodeColors = [CHART_COLORS.positive, CHART_COLORS.savings, CHART_COLORS.accent];
		}
		if(unallocatedIdx!==null){ nodeColors.push(CHART_COLORS.muted); }
		nodeColors.push(...categoryGradient);
		// --- Explicit node positioning to align Savings & Unallocated with Spending layer ---
		const nodeX = new Array(nodes.length).fill(0);
		const nodeY = new Array(nodes.length).fill(0);
		const incomeX = 0.03;
		const allocX = 0.38; // Allocation layer (Spending, Savings, Unallocated, per-account savings)
		const catX = 0.85;   // Category layer
		nodeX[incomeIdx] = incomeX; nodeY[incomeIdx] = 0.5;
		// Collect allocation indices
		const allocationIndices: number[] = [];
		allocationIndices.push(spendingIdx);
		if(multiSavings){
			for(let i=0;i<savingsAcctKeys.length;i++){ allocationIndices.push(firstSavingsIdx + i); }
		}else if(savingsIdx!==null){ allocationIndices.push(savingsIdx); }
		if(unallocatedIdx!==null) allocationIndices.push(unallocatedIdx);
		// Unique & sort for stability
		const allocUnique = [...new Set(allocationIndices)];
		// Category indices
		const categoryIndices: number[] = [];
		for(let i=0;i<categories.length;i++){ categoryIndices.push(catOffset + i); }
		// Helper to vertically distribute
		const distribute = (ids:number[], top=0.06, bottom=0.94) => {
			const n = ids.length; if(!n) return;
			for(let i=0;i<n;i++){
				const y = n===1? 0.5 : top + (bottom-top)*(i/(n-1));
				nodeY[ids[i]] = y;
			}
		};
		allocUnique.forEach(i=> { nodeX[i] = allocX; });
		distribute(allocUnique, 0.15, 0.85);
		categoryIndices.forEach(i=> { nodeX[i] = catX; });
		distribute(categoryIndices, 0.06, 0.94);
			return { data:[{ type:'sankey', orientation:'h', node:{ pad:12, thickness:14, label:nodes, color:nodeColors, line:{ color:CHART_COLORS.muted, width:1 }, x: nodeX, y: nodeY }, link:{ source, target, value, color:linkColor, customdata: customPercent, hovertemplate:'%{source.label} → %{target.label}<br><b>%{value:,.0f}</b> (%{customdata:.1f}% of source)<extra></extra>' } }], layout:{ height: multiSavings? 260:220, title:{ text:'Income Allocation Sankey', font:{ color:PLOT_COLORS.text, size:13 } }, paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'rgba(0,0,0,0)', font:{ color:PLOT_COLORS.text, size:11 }, margin:{ l:20, r:20, t:34, b:10 } } };
	}, [filteredTxns, expandSavings, showMonthlyAverages]);

		// --- Account display helpers (savings labeling) ---
		const savingsAccountLabelMap = useMemo(() => {
			const map: Record<string,string> = {};
			let anonIdx = 0;
			for(const t of filteredTxns){
				if((t.account_type||'').toLowerCase() !== 'savings') continue;
				let key = (t.account_number||'').trim();
				if(!key) key='__anon__';
				if(!(key in map)){
					if(key==='__anon__') map[key] = `Savings ${++anonIdx}`; else {
						const digits = key.replace(/\D/g,'');
						const suffix = digits? digits.slice(-4) : key.slice(-4);
						map[key] = `Savings ${suffix}`;
					}
				}
			}
			return map;
		}, [filteredTxns]);

		const getAccountDisplay = useCallback((t: Txn) => {
			const type = (t.account_type||'').trim();
			if(!type) return '';
			const lower = type.toLowerCase();
			if(lower==='savings'){
				let key = (t.account_number||'').trim(); if(!key) key='__anon__';
				return savingsAccountLabelMap[key] || 'Savings';
			}
			if(t.account_number){
				const digits = t.account_number.replace(/\D/g,''); if(digits){ return `${type.charAt(0).toUpperCase()+type.slice(1)} ${digits.slice(-4)}`; }
			}
			return type.charAt(0).toUpperCase()+type.slice(1);
		}, [savingsAccountLabelMap]);

	const downloadCSV = useCallback(() => {
		if (!filteredTxns.length) return;
		const headers = ['date','description','amount','balance','account', ...(visibleCols.source? ['source'] : [])];
		const rows = filteredTxns.map(t => [formatDate(t.date)||'', t.description.replace(/,/g,' '), t.amount??'', t.balance??'', getAccountDisplay(t), ...(visibleCols.source? [t.source_file||''] : [])]);
		const csv = [headers.join(','), ...rows.map(r=>r.join(','))].join('\n');
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a'); a.href = url; a.download = `${parseResult?.fileName || 'transactions'}.csv`; a.click(); URL.revokeObjectURL(url);
		}, [filteredTxns, parseResult, formatDate, visibleCols.source, getAccountDisplay]);

	// (Removed duplicate deriveAmountStats - module version used)

	const downloadExcel = useCallback(async () => {
		if (!filteredTxns.length) return;
		const XLSX = await import('xlsx');
		const wsData = filteredTxns.map(t => ({ Date: formatDate(t.date) || '', Description: t.description, Amount: t.amount ?? '', Balance: t.balance ?? '', Account: getAccountDisplay(t), ...(visibleCols.source? { Source: t.source_file || '' } : {}) }));
		const ws = XLSX.utils.json_to_sheet(wsData);
		// Build summary sheet using shared stats helper
		const stats = deriveAmountStats(filteredTxns) || { total:0, avg:0, median:0, min:0, max:0, charges:0, credits:0, largestInflow:0, largestOutflow:0 };
		const byAccount: Record<string, number> = {};
		filteredTxns.forEach(t=> { const label = getAccountDisplay(t); if(label && typeof t.amount==='number') byAccount[label] = (byAccount[label]||0) + t.amount; });
		const summaryRows = [
			{ Metric: 'Filtered Transactions', Value: filteredTxns.length },
			{ Metric: 'Net Amount', Value: filteredNet },
			{ Metric: 'Average Amount', Value: stats.avg },
			{ Metric: 'Median Amount', Value: stats.median },
			{ Metric: 'Total Charges (neg sum)', Value: stats.charges },
			{ Metric: 'Total Credits (pos sum)', Value: stats.credits },
			{ Metric: 'Largest Inflow', Value: stats.largestInflow },
			{ Metric: 'Largest Outflow', Value: stats.largestOutflow },
			...Object.entries(byAccount).map(([k,v]) => ({ Metric: `Account Total: ${k}`, Value: v }))
		];
		const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
		const wb = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
		XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
		const fname = `${parseResult?.fileName || 'transactions'}.xlsx`;
		XLSX.writeFile(wb, fname);
	}, [filteredTxns, parseResult, filteredNet, formatDate, visibleCols.source, getAccountDisplay]);

	const copyMarkdown = useCallback(() => {
		if(!filteredTxns.length) return;
		const headers = ['Date','Description','Amount','Balance','Account', ...(visibleCols.source? ['Source'] : [])];
		const lines = filteredTxns.slice(0,500).map(t=>`| ${t.date||''} | ${t.description.replace(/\|/g,'/')} | ${typeof t.amount==='number'?formatNumber(t.amount):''} | ${typeof t.balance==='number'?formatNumber(t.balance):''} | ${getAccountDisplay(t)} |${visibleCols.source? ` ${t.source_file||''} |` : ''}`);
		const table = ['| '+headers.join(' | ')+' |','| '+headers.map(()=> '---').join(' | ')+' |', ...lines].join('\n');
		navigator.clipboard.writeText(table).then(()=> setLiveStatus('Copied markdown table.')); },[filteredTxns, getAccountDisplay, visibleCols.source]);

	// Quick stats (memoized) reuse shared computation
	const amountStatsSummary = useMemo(() => {
		if(!filteredTxns.length) return null;
		const stats = deriveAmountStats(filteredTxns);
		if(!stats) return null;
		const { total, avg, median, min, max, credits, charges } = stats as any;
		return { total, avg, median, min, max, credits, charges };
	}, [filteredTxns]);

	// (helpers moved above export functions)

	// Phase 3: simple quality heuristic of parse (heuristic only; not persisted)
	const qualityHeuristic = useMemo(() => {
		if(!parseResult) return null;
		const tx = parseResult.metrics.transaction_count;
		const unparsed = parseResult.unparsed_sample.length;
		const typeCount = parseResult.metrics.account_types?.length || 0;
		const txnScore = Math.min(1, Math.log10(Math.max(1, tx)) / 3); // saturates around 1000
		const unparsedPenalty = unparsed > 0 ? Math.min(0.4, unparsed / 50) : 0;
		const typeBoost = Math.min(0.2, typeCount * 0.08);
		const score = Math.max(0, Math.min(1, txnScore + typeBoost - unparsedPenalty));
		let percent = Math.round(score * 100);
		// If there are zero unparsed lines, treat parse quality as perfect (100%)
		if (Array.isArray(parseResult.unparsed_sample) && parseResult.unparsed_sample.length === 0) {
			percent = 100;
			// also ensure score reflects perfect parsing
			// (keeps percent/score consistent for any downstream use)
			// but don't strictly require changing score variable for display logic
		}
		// Derive label from the finalized percent so color always matches displayed percent
		let label = 'Good';
		if (percent > 75) label = 'Excellent'; else if (percent < 45) label = 'Fair';
		return { score, label, percent };
	}, [parseResult]);

	// ---------------- Richer Top Metrics Derivations ---------------- //
	const totalNet = useMemo(() => filteredTxns.reduce((a, t) => a + (typeof t.amount==='number'? t.amount:0), 0), [filteredTxns]);
	const overallNet = useMemo(() => parseResult?.transactions.reduce((a, t) => a + (typeof t.amount==='number'? t.amount:0), 0) || 0, [parseResult]);
	const hasActiveFilters = !!(rawFilter || activeAccountTypes.length>0 || dateStart || dateEnd || activeSources.length>0);

	const coverageStats = useMemo(() => {
		const list = filteredTxns;
		if(!list.length) return { categoryCoverage: 0, top3: [] as [string,number][], top3Share: 0 };
		// Exclude opening/ending balance marker rows from coverage math
		const isBalanceMarker = (desc?: string) => !!(desc && (
			/\b(beginning|opening)\s+balance\b/i.test(desc) ||
			/\b(ending|closing)\s+balance\b/i.test(desc) ||
			/\bbalance\s+forward\b/i.test(desc) ||
			/\bnew\s+balance\b/i.test(desc)
		));
		const work = list.filter(t => !isBalanceMarker(t.description));
		if(!work.length) return { categoryCoverage: 0, top3: [] as [string,number][], top3Share: 0 };
		const categorized = work.filter(t => t.category && t.category !== 'Uncategorized');
		const categoryCoverage = categorized.length / work.length;
		const expenseTx = work.filter(t => typeof t.amount==='number' && t.amount < 0);
		const totalExpenseAbs = expenseTx.reduce((a,t)=> a + Math.abs(t.amount||0),0);
		const byCategory = new Map<string, number>();
		expenseTx.forEach(t => {
			const key = t.category || 'Uncategorized';
			byCategory.set(key, (byCategory.get(key)||0) + Math.abs(t.amount||0));
		});
		const sorted = [...byCategory.entries()].sort((a,b)=>b[1]-a[1]);
		const top3 = sorted.slice(0,3) as [string, number][];
		const top3Share = totalExpenseAbs ? top3.reduce((a, [,v])=>a+v,0)/totalExpenseAbs : 0;
		return { categoryCoverage, top3, top3Share };
	}, [filteredTxns]);

	const allocationStats = useMemo(() => {
		// If categories aren't applied yet, avoid defaulting to 100% expense; disable view
		if(!categoriesApplied) return { income:0, expenses:0, savings:0, unallocated:0, pIncome:0, pExpenses:0, pSavings:0, pUnallocated:0, creditCardOnly:false, overspend:false, disabled: true } as const;
		if(!filteredTxns.length) return { income:0, expenses:0, savings:0, unallocated:0, pIncome:0, pExpenses:0, pSavings:0, pUnallocated:0, creditCardOnly:false, overspend:false };
		let income = 0, expenses = 0, savings = 0;
		for(const t of filteredTxns){
			if(typeof t.amount !== 'number') continue;
			const cat = (t.category||'').toLowerCase();
			if(cat === 'account transfer') continue; // ignore transfers entirely
			if(cat === 'income' && t.amount > 0){
				// treat credit card positive payments as not income
				if((t.account_type||'').toLowerCase() !== 'credit_card') income += t.amount;
				continue;
			}
			if(cat === 'savings' && t.amount > 0){ savings += t.amount; continue; }
			if(t.amount < 0){ expenses += Math.abs(t.amount); }
		}
		// Unallocated = leftover income after savings & expenses (no negative)
		let unallocated = Math.max(0, income - savings - expenses);
		const total = income + savings + expenses + unallocated;
		const creditCardOnly = filteredTxns.length>0 && filteredTxns.every(t => (t.account_type||'').toLowerCase()==='credit_card');
		let pIncome = 0, pSavings = 0, pExpenses = 0, pUnallocated = 0;
		let overspend = false;
		if(income > 0){
			pIncome = 1; // conceptual base
			if(expenses > income) { overspend = true; }
			pSavings = Math.min(savings / income, 1);
			pExpenses = Math.min(expenses / income, 1 - pSavings + (overspend?0:0));
			pUnallocated = Math.max(0, 1 - pSavings - pExpenses);
		} else if(total > 0){
			// fallback: distribute over observed totals (e.g., credit card only => 100% expense)
			pSavings = savings/total;
			pExpenses = expenses/total;
			pUnallocated = unallocated/total;
		}
		return { income, expenses, savings, unallocated, pIncome, pExpenses, pSavings, pUnallocated, creditCardOnly, overspend };
	}, [filteredTxns, categoriesApplied]);

	const consistencySummary = useMemo(() => {
		const rep = filteredConsistencyReport || consistencyReport;
		if(!rep) return null;
		const { probableTransfers, duplicateAmountSameDayOppositeSign, creditCardPaymentPairs, suspiciousIncomePositives, inconsistentCategories } = rep;
		const issueCount = (probableTransfers>0?1:0)+(duplicateAmountSameDayOppositeSign>0?1:0)+(creditCardPaymentPairs>0?1:0)+(suspiciousIncomePositives>0?1:0)+(inconsistentCategories>0?1:0);
		// Highlight in orange (warn) when any potential issues are present; avoid red styling.
		let status: 'good'|'warn'|'attn' = 'good';
		if(issueCount>=1) status='warn';
		return { issueCount, status };
	}, [filteredConsistencyReport, consistencyReport]);

	const accountTypeCounts = useMemo(() => {
		const m: Record<string, number> = {};
		filteredTxns.forEach(t => { const k=(t.account_type||'unknown').toLowerCase(); m[k]=(m[k]||0)+1; });
		return m;
	}, [filteredTxns]);

	const filteredAccountsCount = useMemo(() => {
		if(!filteredTxns.length) return 0;
		const set = new Set<string>();
		for(const t of filteredTxns){
			const type = (t.account_type||'').toLowerCase();
			const num = (t.account_number||'').trim();
			const key = type + '|' + (num || type);
			set.add(key);
		}
		return set.size;
	}, [filteredTxns]);

	const fmtShort = (n:number) => formatNumber(n);

	// Consistency issues popover state
	const [showConsistencyDetails, setShowConsistencyDetails] = useState(false);
	const consistencyRef = useRef<HTMLDivElement|null>(null);
	useEffect(()=> {
		if(!showConsistencyDetails) return;
		const onDocClick = (e: MouseEvent) => {
			if(!consistencyRef.current) return;
			if(!consistencyRef.current.contains(e.target as Node)) {
				setShowConsistencyDetails(false);
			}
		};
		const onKey = (e: KeyboardEvent) => { if(e.key === 'Escape') setShowConsistencyDetails(false); };
		document.addEventListener('mousedown', onDocClick);
		document.addEventListener('keydown', onKey);
		return () => { document.removeEventListener('mousedown', onDocClick); document.removeEventListener('keydown', onKey); };
	}, [showConsistencyDetails]);

	// Close quality popover on outside click or Escape
	useEffect(()=> {
		if(!showQualityInfo) return;
		const onDocClick = (e: MouseEvent) => {
			if(!qualityRef.current) return;
			if(!qualityRef.current.contains(e.target as Node)) {
				setShowQualityInfo(false);
			}
		};
		const onKey = (e: KeyboardEvent) => { if(e.key === 'Escape') setShowQualityInfo(false); };
		document.addEventListener('mousedown', onDocClick);
		document.addEventListener('keydown', onKey);
		return () => { document.removeEventListener('mousedown', onDocClick); document.removeEventListener('keydown', onKey); };
	}, [showQualityInfo]);

	// Persist UI prefs (single unified writer)
	useEffect(() => {
		try {
			localStorage.setItem('uiPrefs', JSON.stringify({ dateFormat, showCols: visibleCols, types: activeAccountTypes, sort, useAI }));
		} catch {/* ignore */}
	}, [dateFormat, visibleCols, activeAccountTypes, sort, useAI]);
	useEffect(()=> { try { const raw = localStorage.getItem('showMonthlyAverages'); if(raw) setShowMonthlyAverages(JSON.parse(raw)); } catch {/* ignore */} }, []);
	useEffect(()=> { try { localStorage.setItem('showMonthlyAverages', JSON.stringify(showMonthlyAverages)); } catch {/* ignore */} }, [showMonthlyAverages]);
	useEffect(()=> { try { const raw = localStorage.getItem('expandSavings'); if(raw) setExpandSavings(JSON.parse(raw)); } catch {/* ignore */} }, []);
	useEffect(()=> { try { localStorage.setItem('expandSavings', JSON.stringify(expandSavings)); } catch {/* ignore */} }, [expandSavings]);
	useEffect(()=> { if(!canExpandSavings && expandSavings) setExpandSavings(false); }, [canExpandSavings, expandSavings]);
	useEffect(()=> { try { localStorage.setItem('showSankeyFlow', JSON.stringify(showSankeyFlow)); } catch {/* ignore */} }, [showSankeyFlow]);
	// Simple manual virtualization (windowed rendering) to avoid heavy dependencies if mismatch
	// Windowed rows (virtualization) — explicitly clamp to show at least 11 rows
	const windowedRows = useWindowedRows(filteredTxns, TXN_ROW_HEIGHT, 5, 400, 600, 11);

	// Consolidated Filters dropdown state
	const [showFilterPanel, setShowFilterPanel] = useState(true);

	// Determine if Reset should be shown (hide when only date filters are at dataset defaults)
	const shouldShowReset = useMemo(() => {
		const hasText = !!rawFilter;
		const hasTypes = activeAccountTypes.length > 0;
		const hasSources = activeSources.length > 0; // default all-sources is empty list
		let hasDateDeviation = false;
		if (dateStart || dateEnd) {
			// If bounds exist, only treat as active when deviating from them; else any non-empty counts
			if (dataMinDate && dataMaxDate) {
				hasDateDeviation = !(dateStart === dataMinDate && dateEnd === dataMaxDate);
			} else {
				hasDateDeviation = true;
			}
		}
		return hasText || hasTypes || hasSources || hasDateDeviation;
	}, [rawFilter, activeAccountTypes, activeSources, dateStart, dateEnd, dataMinDate, dataMaxDate]);

	const resetApp = useCallback(() => {
		setParseResult(null);
		setUndoState({});
		setFilter('');
		setActiveAccountTypes([]);
		setError(null);
		setLiveStatus('');
		setCategoriesApplied(false);
		setVisibleCols(v => ({...v, category:false}));
		if (fileInputRef.current) fileInputRef.current.value = '';
		// Keep cached parse so user can resume unless explicitly cleared via clear cache control
	}, []);

	const clearCache = useCallback(() => {
		localStorage.removeItem('lastParse');
		localStorage.removeItem('lastParse_ts');
		setCachedMeta(null);
		setLiveStatus('Cached session cleared.');
	}, []);

	const clearAllLocal = useCallback(() => {
		setShowConfirmClear(true);
	}, []);

	// Themed confirm modal state & logic
	const [showConfirmClear, setShowConfirmClear] = useState(false);
	const confirmBtnRef = useRef<HTMLButtonElement|null>(null);

	const performClearAll = useCallback(() => {
	       // List of all localStorage keys to clear for a true full reset
	       const keysToClear = [
		       'lastParse',
		       'lastParse_ts',
		       'uiPrefs',
		       'recentFiles',
		       'showMonthlyAverages',
		       'expandSavings',
		       'showSankeyFlow',
		       'aiConsent',
		       'aiConsentRemember'
	       ];
	       keysToClear.forEach(k => localStorage.removeItem(k));
	       setCachedMeta(null);
	       setRecentFiles([]); // clear recents in React state too
	       setLiveStatus('All local data cleared.');
		fetch('/api/clear-caches', { method: 'POST' }).then(async r => {
			if(r.ok){
				try{ const js = await r.json(); setLiveStatus('All local data + backend caches cleared.'); }catch{/* ignore parse */}
			}
		}).catch(()=>{/* offline */});
	       fetch('/api/telemetry', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ event:'ui_clear_all', meta:{ aiEnabled: useAI } }) }).catch(()=>{});
	       setShowConfirmClear(false);
	}, [useAI]);

	useEffect(() => {
		if(showConfirmClear){
			// focus primary destructive action
			setTimeout(()=>{ confirmBtnRef.current?.focus(); }, 10);
			const onKey = (e: KeyboardEvent) => { if(e.key === 'Escape'){ setShowConfirmClear(false); } };
			window.addEventListener('keydown', onKey);
			return () => window.removeEventListener('keydown', onKey);
		}
	}, [showConfirmClear]);

	// Drag & drop events
	const onDragOver = (e: React.DragEvent) => { e.preventDefault(); if(!isDropActive){ setIsDropActive(true); setDragAnnounce('PDF detected – release to upload'); } };
	const onDragLeave = (e: React.DragEvent) => { if (e.currentTarget === e.target){ setIsDropActive(false); setDragAnnounce(''); } };
	const onDrop = (e: React.DragEvent) => {
		e.preventDefault(); setIsDropActive(false); setDragAnnounce('');
		const files = Array.from(e.dataTransfer.files).filter(f=> f.type==='application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
		if(files.length) handleSelectedFiles(files);
	};

	// Highlight description matches
	const highlightDescription = useCallback((desc: string) => {
		if (!filter || filter.length < 2) return desc;
		const safe = filter.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
		const re = new RegExp(`(${safe})`, 'ig');
		return desc.split(re).map((part, i) => re.test(part)
			? <mark key={i} className="match-highlight">{part}</mark>
			: <React.Fragment key={i}>{part}</React.Fragment>);
	}, [filter]);

	// ------------------------ Categorization Logic (Client) ------------------------ //
	// Fallback client-side heuristics if backend categorization endpoint is absent.
	const clientCategoryHeuristics: { cat: string; re: RegExp }[] = [
		// Account transfers (must precede Finance so 'transfer' isn't captured there)
		{ cat: 'Account Transfer', re: /(\bxfer\b|internal transfer|funds? transfer|account transfer|transfer to (credit|checking|savings|card)|transfer from (credit|checking|savings|card)|to credit card payment|payment to credit card|move to savings|auto ?transfer|online transfer|between accounts)/i },
		{ cat: 'Housing', re: /(rent|mortgage|lease|landlord|realty|home\s?dep|lowe's|lowes|hoa|property tax|apartment|\bapt\b|hvac|plumb(er|ing)|electrician|roof(ing)?|pest control|lawn care|landscaping|furniture|ikea|wayfair|security system|adt|ring subscription)/i },
		{ cat: 'Transportation', re: /(uber|lyft|shell|chevron|exxon|fuel|metro|transit|parking|toll|autozone|o'reilly|advance auto|napa auto|oil change|mechanic|tire|u-?haul|rental car|enterprise|hertz|avis|dmv|vehicle reg|emissions test|smog check|ev charge|supercharger|chase automotive|automotive|auto finance|auto pmt|auto payment)/i },
		{ cat: 'Food', re: /(restaurant|cafe|coffee|starbucks|mcdonald|burger|kfc|pizza|grocery|supermart|whole\s?foods|trader\s?joe|walmart|costco|sam's club|bjs|panera|wendy's|kfc|popeyes|domino'?s|dunkin|jimmy john's|liquor|winery|distillery|beer store|alcohol|instacart|meal kit|blue apron|hellofresh|farmers market|fresh market|d&w fresh market|d&w fresh|meijer|h\.?e\.?b\.?|heb|shoprite|shop rite|stop ?& ?shop|food lion|giant eagle|giant\b|harris teeter|sprouts|winco|ralphs|king soopers|fry'?s food|fry'?s|frys food|jewel-?osco|piggly wiggly|market basket|albertsons?|butcher shop|deli)/i },
		{ cat: 'Utilities', re: /(internet|comcast|verizon|att\b|t-mobile|electric|water\s?bill|utility|sewer|trash|energy|duke energy|pge|con edison|national grid|spectrum|charter|cox|directv|dish|solar (lease|city)|sunrun|hosting|cloud storage|google workspace|microsoft 365)/i },
		{ cat: 'Health', re: /(pharmacy|cvs|walgreens|clinic|dental|dentist|doctor|hospital|fitness|gym|wellness|blue cross|blue shield|aetna|cigna|kaiser|united health|optum|labcorp|quest diagnostics|radiology|imaging center|physical therapy|pt visit|occupational therapy|speech therapy|urgent care|walk-in clinic|emergency room|vision center|optical|eye care|dermatology|pediatric|cardiology|\bdr\.?\b|\bm\.?d\.?\b|\bdds\b|\bdpm\b|\bdo\b)/i },
		{ cat: 'Recreation', re: /(netflix|spotify|prime\s?video|hulu|amzn\s?prime|cinema|theater|travel|airbnb|hotel|booking|expedia|ticket|game|entertain|youtube premium|playstation|xbox live|epic games|nintendo|ticketmaster|eventbrite|stubhub|fandango|golf course|ski pass|resort fee|museum|theme park|gym membership|pilates|yoga studio|dance class)/i },
		{ cat: 'Finance', re: /(payroll|salary|interest|dividend|fee|wire|ach|refund|reversal|credit\s?card|loan|payment|vanguard|fidelity|schwab|robinhood|etrade|merrill|coinbase|crypto|bitcoin|zelle|venmo|paypal|cash app|apple cash|irs payment|tax payment|tax refund|bill pay|auto pay|direct pay|electronic payment)/i },
	];

	const guessClientCategory = (desc: string): string => {
		if(!desc) return 'Recreation'; // neutral default
		// Skip statement roll-forward lines (leave blank category)
		if(/\b(beginning|opening) balance\b/i.test(desc) || /\b(ending|closing) balance\b/i.test(desc) || /\bbalance forward\b/i.test(desc) || /\bnew balance\b/i.test(desc)) {
			return '';
		}
		for (const {cat,re} of clientCategoryHeuristics) if(re.test(desc)) return cat;
		return 'Recreation';
	};

	const categorizeTransactions = useCallback(async (mode: 'initial' | 'refine' = 'initial') => {
		if(!parseResult) return;
		// Prevent double-trigger if an initial categorize is in flight
		if(mode === 'initial' && categorizeLoading) return;
		if(mode === 'initial') setCategorizeLoading(true);
		setLiveStatus(mode==='refine' ? 'Refining with AI…' : 'Categorizing…');
		// Try backend first
		const records = parseResult.transactions.map(t => ({ description: t.description || '', amount: t.amount ?? null, account_type: t.account_type || null }));
		let categories: string[] | null = null;
		let metadata: any[] | null = null;
		try {
			const res = await axios.post('/api/categorize', { records, use_ai: useAI }); // backend respects use_ai override
			if(Array.isArray(res.data?.categories) && res.data.categories.length === records.length) {
				categories = res.data.categories;
				if(Array.isArray(res.data?.metadata)) metadata = res.data.metadata;
			}
		} catch {/* ignore: fallback to client heuristic */}
		if(!categories){
			categories = records.map(r => guessClientCategory(r.description));
		}
		// Merge categories into transactions
		setParseResult(prev => {
			if(!prev) return prev;
			const isRefine = mode === 'refine' && useAI;
			const nextTxns = prev.transactions.map((t,i) => {
				let cat = categories![i];
				let source: string | undefined = metadata?.[i]?.source;
				const overrideApplied = metadata?.[i]?.override_applied;
				const overrideReason = metadata?.[i]?.override_reason ?? null;
				const amt = t.amount;
				const acct = (t.account_type || '').toLowerCase();
				// Preserve explicit Account Transfer categorization (do not override to Income/Savings)
				const isTransfer = /account transfer/i.test(cat);
				if(!isTransfer){
					// Rule: All positive checking account amounts are treated as Income (hard override)
					if (acct === 'checking' && typeof amt === 'number' && amt > 0) {
						cat = 'Income';
						source = 'income_rule';
					} else if (!overrideApplied && typeof amt === 'number' && amt > 0 && acct === 'savings') {
						// Auto-classify positive savings-account deposits as Savings and mark provenance
						// with a distinct token so they are not treated as a user 'override'.
						cat = 'Savings';
						source = source || 'savings_rule';
					}
				}
				if(overrideApplied && source !== 'override') source = 'override';

					// Numeric rule: only reclassify large outflows to Housing when
					// the transaction is an outflow (amt < -1000) AND the account is checking,
					// and the original category is Recreation. Do not override if an explicit
					// backend override was applied.
					if (!overrideApplied && typeof amt === 'number' && amt < -1000 && acct === 'checking' && String(cat).toLowerCase() === 'recreation') {
						cat = 'Housing';
						source = source || 'amount_rule';
					}
				// If refining with AI but backend didn't tag, mark as ai to prevent repeated loops
				if(isRefine && (!source || source === 'regex' || source === 'fallback')) source = 'ai';
				return { ...t, category: cat, category_source: source, category_override_reason: overrideReason };
			});
			const next = { ...prev, transactions: nextTxns } as ParseResponse & { transactions: Txn[] };
			try { // update cached parse copy (augment only)
				localStorage.setItem('lastParse', JSON.stringify(next));
			} catch {/* ignore */}
			return next;
		});
		if(mode === 'initial') {
			setVisibleCols(v => ({...v, category:true}));
			setCategoriesApplied(true);
			lastCategorizedSnapshotRef.current = parseResult; // keep original pre-categorize state for undo
			setJustCategorizedFlash(true);
			if(flashTimeoutRef.current) window.clearTimeout(flashTimeoutRef.current);
			flashTimeoutRef.current = window.setTimeout(()=> setJustCategorizedFlash(false), 1600);
			setCategorizeLoading(false);
			setLiveStatus('Categories applied.');
			refineAttemptedRef.current = false; // allow future refine attempt if AI turned on after initial categorize
		} else {
			// refinement complete
			setLiveStatus('AI refinement applied.');
		}
	}, [parseResult, categorizeLoading, useAI]);
    
	// Remove all categories (set to undefined) and mark as not applied
	const uncategorizeAll = useCallback(() => {
		if(!parseResult) return;
		setParseResult(prev => {
			if(!prev) return prev;
			const nextTxns = prev.transactions.map(t => {
				// Strip category related fields
				const { category, category_source, category_override_reason, ...rest } = t as any;
				return { ...rest };
			});
			const next = { ...prev, transactions: nextTxns } as ParseResponse & { transactions: Txn[] };
			try { localStorage.setItem('lastParse', JSON.stringify(next)); } catch {/* ignore */}
			return next;
		});
		setCategoriesApplied(false);
		setLiveStatus('Categories cleared.');
		refineAttemptedRef.current = false;
	}, [parseResult]);

	// Category options used in per-row dropdowns. Combine heuristic set + any existing categories found in data.
	const categoryOptions = useMemo(() => {
		const s = new Set<string>(['Uncategorized', 'Income', 'Savings', 'Account Transfer']);
		clientCategoryHeuristics.forEach(h => s.add(h.cat));
		if (parseResult) {
			parseResult.transactions.forEach(tx => { if (tx.category) s.add(tx.category); });
		}
		return Array.from(s).sort((a,b)=> a.localeCompare(b));
	}, [parseResult]);

	// Per-row undo state: stores previous category/source for a brief undo window.
	const [undoState, setUndoState] = useState<Record<number, { prevCategory?: string | null; prevSource?: string | undefined }>>({});
	const undoTimersRef = useRef<Record<number, number>>({});

	const handleCategoryChange = useCallback((tx: Txn, newCat: string) => {
		if (!parseResult) return;
		const idx = parseResult.transactions.findIndex(p => p === tx);
		if (idx === -1) return;
		const prevTx = parseResult.transactions[idx];
		// Persist new category and mark as user override
		setParseResult(prev => {
			if (!prev) return prev;
			const nextTxns = prev.transactions.map((p,i) => i === idx ? { ...p, category: newCat, category_source: 'override', category_override_reason: null } : p);
			const next = { ...prev, transactions: nextTxns } as typeof prev;
			try { localStorage.setItem('lastParse', JSON.stringify(next)); } catch {/* ignore */}
			return next;
		});

		// Set undo entry and keep it until the user explicitly reverts it.
		setUndoState(s => ({ ...s, [idx]: { prevCategory: prevTx.category ?? null, prevSource: prevTx.category_source } }));

		setCategoriesApplied(true);
		setLiveStatus(`Category set to ${newCat}`);
	}, [parseResult]);

	// Revert a single transaction to its previous category/source
	const handleUndo = (globalIdx: number) => {
		const undo = undoState[globalIdx];
		if (!undo || !parseResult) return;
		setParseResult(prev => {
			if (!prev) return prev;
			const nextTxns = prev.transactions.map((p,i) => i === globalIdx ? { ...p, category: undo.prevCategory ?? undefined, category_source: undo.prevSource } : p);
			const next = { ...prev, transactions: nextTxns } as typeof prev;
			try { localStorage.setItem('lastParse', JSON.stringify(next)); } catch {/* ignore */}
			return next;
		});
		// Clear undo state
		setUndoState(s => { const cp = { ...s }; delete cp[globalIdx]; return cp; });
		setLiveStatus('Change reverted');
	};

	// If user enables AI after an initial non-AI categorization, auto-refine with AI
	useEffect(() => {
		if (
			useAI &&
			categoriesApplied &&
			parseResult &&
			!categorizeLoading &&
			!isRefiningAI &&
			!refineAttemptedRef.current &&
			!parseResult.transactions.some(t => t.category_source === 'ai')
		) {
			refineAttemptedRef.current = true; // lock to single attempt for this dataset
			setIsRefiningAI(true);
			refineStartRef.current = performance.now();
			categorizeTransactions('refine').finally(()=> {
				const MIN_SHOW = 650; // ms minimum indicator visibility to avoid flicker
				const elapsed = refineStartRef.current ? performance.now() - refineStartRef.current : MIN_SHOW;
				const remaining = elapsed < MIN_SHOW ? MIN_SHOW - elapsed : 0;
				setTimeout(() => { setIsRefiningAI(false); refineStartRef.current = null; }, remaining);
			});
		}
	}, [useAI, categoriesApplied, parseResult, categorizeLoading, categorizeTransactions, isRefiningAI]);

	return (
	<React.Suspense fallback={<div style={{padding:'2rem',color:PLOT_COLORS.text}}>Loading interface…</div>}>
			{showConfirmClear && (
				<div className="themed-modal" role="dialog" aria-modal="true" aria-labelledby="clr-title" aria-describedby="clr-desc">
					<div className="themed-backdrop" onClick={()=> setShowConfirmClear(false)} />
					<div className="themed-modal-content">
						<h2 id="clr-title">Confirm full reset</h2>
						<p id="clr-desc">This will remove all locally stored statement data, UI preferences, and request the backend to clear its caches. This action cannot be undone.</p>
						<div className="themed-actions">
							<button onClick={()=> setShowConfirmClear(false)} className="btn-cancel">Cancel</button>
							<button ref={confirmBtnRef} onClick={performClearAll} className="btn-danger">Erase everything</button>
						</div>
					</div>
				</div>
			)}
			<div className="app-shell">
				<DragonBallHeader />
				<main>
					{/* Cover section */}
					{!parseResult && !loading && (
						<section className={"cover" + (isDropActive?" drop-active":"")} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} aria-labelledby="cover-title" aria-describedby="cover-desc">
							<h1 id="cover-title" className="cover-global-title">Statement Insight Dashboard</h1>
							{/* Tagline moved lower beside upload for tighter onboarding focus */}
							<div className="cover-grid divided">
								<div className="cover-left">
									<h2 className="cover-left-title">Upload & Explore</h2>
								{/* capability & trust sections moved to right column */}
									{/* Tagline now lives here (replacing prior privacy pill) */}
									<p id="cover-desc" className="tagline global-tagline moved" role="note">Upload a bank or credit card PDF to parse on our secured backend. PDFs are uploaded over HTTPS and parsed in-memory on the server; parsed results are returned to your browser and are not persisted by default.</p>
									<div className="cta-row">
										<button ref={uploadBtnRef} className="primary-cta primary-cta--ultra" onClick={()=>fileInputRef.current?.click()} aria-describedby="cover-desc" onMouseMove={onUploadBtnMove} onMouseLeave={onUploadBtnLeave}>
											<DragonOrbIcon size={22} className="orb-icon" />
											<span className="kw">Upload PDF(s)</span>
										</button>
										<span className="upload-secure-note" aria-hidden>🔒 Encrypted upload to mybudgetnerd.com — HTTPS</span>
										<button className="secondary-cta" onClick={loadDemoSample}><span className="kw">Try sample</span></button>
										<input ref={fileInputRef} type="file" aria-hidden="true" accept="application/pdf" multiple style={{display:'none'}} onChange={onFileInputChange} />
									</div>
									<div className="drop-hint" aria-hidden="true">Or <span className="kw">drop a PDF</span> here</div>
									<div className="prefs-summary" aria-hidden="true">Prefs: {dateFormat.toUpperCase()} · {isHighContrast? 'High Contrast':'Normal Contrast'}</div>
									<div className="supported-note" role="note" aria-label="Supported statement types">Supported: Checking · Savings · Credit card <span className="muted">(Other formats may partially parse)</span></div>
									{/* Removed guidelines line per request; tips still accessible via separate control if needed */}
									<div className="instruction-accordion" role="region" aria-label="How it works">
										<div className="ia-item">
											<button
												className={"dropdown-btn neutral wide" + (openStep.upload ? " open" : "")}
												aria-expanded={openStep.upload}
												aria-controls="ia-upload"
												onClick={() => setOpenStep(s => ({ ...s, upload: !s.upload }))}
											>
												<span className="step-index">1</span> Upload
											</button>
											{openStep.upload && (
												<div id="ia-upload" className="ia-body">
													<p>Drag and drop PDF(s) or click <em><span className="kw">Upload PDF(s)</span></em>. Files are uploaded to the backend over HTTPS and parsed in-memory on the server; nothing is persisted by default.</p>
													<ul className="tips">
														<li>Supports Checking, Savings, and Credit Card statements; others may partially parse.</li>
														<li>Upload single or multiple files. Large files may parse slower.</li>
														<li>Just exploring? Use <em><span className="kw">Try sample</span></em> to view the demo.</li>
													</ul>
												</div>
											)}
										</div>
										<div className="ia-item">
											<button
												className={"dropdown-btn neutral wide" + (openStep.filter ? " open" : "")}
												aria-expanded={openStep.filter}
												aria-controls="ia-filter"
												onClick={() => setOpenStep(s => ({ ...s, filter: !s.filter }))}
											>
												<span className="step-index">2</span> Filter
											</button>
											{openStep.filter && (
												<div id="ia-filter" className="ia-body">
													<p>Refine results using the <span className="kw">search box</span>, <span className="kw">date range</span>, <span className="kw">account types</span>, and <span className="kw">sources</span> (when multiple PDFs are loaded).</p>
													<ul className="tips">
														<li>Search supports <code>cat:&lt;name&gt;</code> (e.g., <code>cat:food</code>) and plain-text matches in descriptions.</li>
														<li>Date pickers default to dataset bounds — use <em><span className="kw">Reset</span></em> to revert filters.</li>
														<li>Shortcut: press <kbd>⌘/Ctrl</kbd> + <kbd>K</kbd> to focus the search box.</li>
													</ul>
												</div>
											)}
										</div>
										<div className="ia-item">
											<button
												className={"dropdown-btn neutral wide" + (openStep.analyze ? " open" : "")}
												aria-expanded={openStep.analyze}
												aria-controls="ia-analyze"
												onClick={() => setOpenStep(s => ({ ...s, analyze: !s.analyze }))}
											>
												<span className="step-index">3</span> Analyze
											</button>
											{openStep.analyze && (
												<div id="ia-analyze" className="ia-body">
													<p>Click <em><span className="kw">Categorize</span></em> to label transactions. Charts update with your filters: Daily Net, Account Mix, Income·Savings·Expense, Credit Charges vs Payments, and the Income Allocation Sankey.</p>
													<ul className="tips">
														<li>Enable <span className="kw">AI</span> (opt‑in) to refine categories on the backend. Transfers are excluded from analytics.</li>
														<li><span className="kw">Hover</span> charts for unified tooltips; select a range on Daily Net to focus dates.</li>
														<li>Toggle <span className="kw">Flow</span> to enable the Sankey; expand <span className="kw">Savings</span> to split by account.</li>
														<li><strong>Inline review:</strong> Each row includes a category dropdown for quick reclassification; user overrides show in <span className="kw">theme yellow</span> and a mini-undo is available.</li>
													</ul>
												</div>
											)}
										</div>
										<div className="ia-item">
											<button
												className={"dropdown-btn neutral wide" + (openStep.export ? " open" : "")}
												aria-expanded={openStep.export}
												aria-controls="ia-export"
												onClick={() => setOpenStep(s => ({ ...s, export: !s.export }))}
											>
												<span className="step-index">4</span> Export
											</button>
											{openStep.export && (
												<div id="ia-export" className="ia-body">
													<p>Export the filtered table to <span className="kw">CSV</span> or <span className="kw">Excel</span>, or copy a <span className="kw">Markdown</span> snapshot. Sort columns and toggle fields before export.</p>
													<ul className="tips">
														<li><span className="kw">CSV</span> is ideal for quick imports; <span className="kw">Excel</span> includes a Summary sheet.</li>
														<li><span className="kw">Markdown</span> is convenient for sharing—top 500 rows included.</li>
													</ul>
												</div>
											)}
										</div>
									</div>
									<ul className="shortcut-hints" aria-label="Keyboard shortcuts">
										{/* Hotkeys moved into settings panel */}
									</ul>
										{/* Removed dedicated last session bubble */}
									{recentFiles.length > 0 && (
										<div className="recent-card" aria-label="Recent sessions">
											<div className="recent-card-head">
												<span className="recent-title">Recent</span>
												<button type="button" className="resume-btn" onClick={resumeLastSession} aria-label="Resume last session">Resume</button>
												<button type="button" className="clear-all-btn small" onClick={clearAllLocal} aria-label="Clear all data">
													<svg className="clear-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
														<path d="M3 6h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
														<path d="M8 6v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
														<path d="M10 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
														<path d="M14 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
														<path d="M9 3h6l-1 3H10L9 3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
													</svg>
													<span className="clear-label">Clear</span>
												</button>
											</div>
											<ul className="recent-list">
												{recentFiles.map(r => (
													<li key={r.name} className="recent-list-item">
														<span className="recent-filename">{r.name}</span>
														<span className="recent-meta">{r.txns} txns · {formatRelativeTime(r.ts)}</span>
													</li>
												))}
											</ul>
										</div>
									)}
									<div className="primary-actions">
										<button className="tour-btn" onClick={()=> setTourOpen(true)}>Tour</button>
										<button className="settings-btn" aria-expanded={showSettings} onClick={()=> setShowSettings(s=>{ const next=!s; if(next) setShowInfoPanel(false); return next; })} title="Settings">⚙ Settings</button>
										<button
											className="settings-btn filters-toggle"
											aria-expanded={showInfoPanel}
											aria-haspopup="true"
											aria-controls="help-tools-panel"
											onClick={()=> setShowInfoPanel(s=>{ const next=!s; if(next) setShowSettings(false); return next; })}
											title="Help & tools"
										>
											{showInfoPanel ? 'Help & Tools ▴' : 'Help & Tools ▾'}
										</button>
									</div>
									{showSettings && (
										<div className="settings-panel" aria-label="Advanced settings">
											<div className="setting-row">
												<button className="contrast-btn" onClick={()=> setIsHighContrast(h=>!h)} aria-pressed={isHighContrast}>{isHighContrast? 'Normal contrast':'High contrast'}</button>
												<button className="date-btn" onClick={()=> setDateFormat(f=> f==='mdy'?'dmy':'mdy')} aria-pressed={dateFormat==='dmy'}>{dateFormat==='mdy' ? 'Date M/D/Y' : 'Date D/M/Y'}</button>
											</div>
											{/* Utilities moved to Info & Tools panel */}
										</div>
									)}
									{showInfoPanel && (
										<div id="help-tools-panel" className="settings-panel" aria-label="Help & tools">
											<div className="setting-row">
												<button className="faq-btn" onClick={()=> setFaqOpen(o=>!o)} aria-expanded={faqOpen}>{faqOpen? 'Hide FAQ':'FAQ'}</button>
												<button className="shortcuts-btn" onClick={()=> setShowShortcuts(s=>!s)} aria-expanded={showShortcuts}>{showShortcuts? 'Hide Shortcuts':'Shortcuts'}</button>
												{/* Clear all moved to Recent card */}
											</div>
											{showShortcuts && (
												<div className="shortcuts-card" aria-label="Keyboard shortcuts">
													<ul className="shortcut-hints">
														<li><kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>K</kbd> focus filter</li>
														<li><kbd>↵</kbd> / <kbd>Space</kbd> activates buttons</li>
														<li>Sort columns by clicking headers</li>
													</ul>
												</div>
											)}
										</div>
									)}
										{areMoreActionsOpen && (
										<div className="more-actions" aria-label="Additional actions">
											<button className="contrast-btn" onClick={()=> setIsHighContrast(h=>!h)} aria-pressed={isHighContrast}>{isHighContrast? 'Normal':'High Contrast'}</button>
											<button className="date-btn" onClick={()=> setDateFormat(f=> f==='mdy'?'dmy':'mdy')} aria-pressed={dateFormat==='dmy'}>{dateFormat==='mdy' ? 'Date M/D/Y' : 'Date D/M/Y'}</button>
											<button className="clear-all-btn" onClick={clearAllLocal}>Clear All Data</button>
											<button className="faq-btn" onClick={()=> setFaqOpen(o=>!o)} aria-expanded={faqOpen}>{faqOpen? 'Hide FAQ':'FAQ'}</button>
											{/* About toggle removed; section always visible */}
										</div>
									)}
								</div>
								<div className="cover-right">
											<h2 className="benefits-heading">Benefits & Capabilities</h2>
											<div className="value-grid merged" aria-label="Key capabilities">
												<div className="val-item"><strong>Private & Ephemeral</strong><span>PDFs are uploaded over HTTPS and parsed in-memory on the backend; results are returned to the browser and not persisted by default.</span></div>
												<div className="val-item"><strong>Fast & Flexible</strong><span>Hundreds of lines parsed instantly; supports checking, savings, and credit card PDFs.</span></div>
												<div className="val-item"><strong>Reviewable Categories</strong><span>Automatic, transparent categorization—optionally refine with AI (backend, opt‑in). Each row includes an inline category control so you can reclassify instantly; user overrides are highlighted and a mini-undo is available.</span></div>
												<div className="val-item"><strong>Insightful Visuals</strong><span>Trends, distributions, and comparisons update live as you filter.</span></div>
												<div className="val-item"><strong>Easy Export</strong><span>Download filtered tables as CSV, Excel, or Markdown for your records.</span></div>
											</div>
											<div className="cover-sub-sections merged-panels">
												<div className="use-cases" aria-label="Common use cases">
													<h2>Use Cases</h2>
													<ul>
														<li>Budgeting and month-end reconciliation</li>
														<li>Tracking card payoff and surplus</li>
														<li>Spotting outliers or fee spikes</li>
														<li>Cleaning up data before import</li>
														<li>Comparing filtered vs. full statement</li>
													</ul>
												</div>
												<div className="trust-badges" aria-label="Trust & guarantees">
													<h2>Why Trust It</h2>
													<ul className="trust-condensed" role="list">
														<li><span className="badge-local">Server-side</span> processing—PDFs are uploaded over HTTPS and parsed in-memory on the backend</li>
														<li>Ephemeral by default—parsed transactions are held only for the session and not persisted by default</li>
														<li>AI refinement runs on the backend and is strictly opt-in; no external categorization calls are made</li>
														<li>Open source—inspect, verify, or run the code yourself</li>
														<li>One-click purge—clear all session data immediately</li>
													</ul>
												</div>
											</div>
											{/* Removed original benefit cards (Immediate insight, Cleaner data, Flexible export) as redundant with capability tiles */}
											{/*! Sample preview (Phase 3) */}
											<MotionDiv className="sample-preview" aria-label="Preview of charts you'll see after parsing a PDF">
												<div className="sp-head">Sample Preview</div>
												<div className="sp-body" style={{ justifyContent: 'space-between', display: 'flex', alignItems: 'center' }}>
													<svg className="sp-spark" viewBox="0 0 120 32" role="img" aria-label="Demo net flow trend line">
														<defs>
															<linearGradient id="spGrad" x1="0" x2="0" y1="0" y2="1">
																<stop offset="0%" stopColor="var(--accent)" stopOpacity="0.9" />
																<stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
															</linearGradient>
															<radialGradient id="pulseGrad" cx="50%" cy="50%" r="50%">
																<stop offset="0%" stopColor="var(--chart-savings-light)" stopOpacity="1" />
																<stop offset="38%" stopColor="var(--chart-savings)" stopOpacity="0.72" />
																<stop offset="72%" stopColor="color-mix(in srgb, var(--chart-savings) 60%, var(--chart-accent) 40%)" stopOpacity="0.35" />
																<stop offset="100%" stopColor="color-mix(in srgb, var(--chart-savings) 30%, var(--chart-muted) 70%)" stopOpacity="0" />
															</radialGradient>
														</defs>
														<path id="spLine" d="M0 18 L10 16 L20 20 L30 12 L40 14 L50 8 L60 10 L70 6 L80 9 L90 5 L100 7 L110 4 L120 6" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
														<path d="M0 32 L0 18 L10 16 L20 20 L30 12 L40 14 L50 8 L60 10 L70 6 L80 9 L90 5 L100 7 L110 4 L120 6 L120 32 Z" fill="url(#spGrad)" />
														{/* Animated pulse traveling along curve */}
														<circle r="5" className="sp-pulse" fill="url(#pulseGrad)" style={{ mixBlendMode: 'screen' }}>
															<animateMotion dur="3.2s" repeatCount="indefinite" keyTimes="0;1" keySplines="0.4 0 0.2 1" calcMode="spline" path="M0 18 L10 16 L20 20 L30 12 L40 14 L50 8 L60 10 L70 6 L80 9 L90 5 L100 7 L110 4 L120 6" />
														</circle>
													</svg>
													<div className="sp-metrics">
														<div><span className="lbl">Net Flow</span><strong>+$4,210</strong></div>
														<div><span className="lbl">Payoff</span><strong>102%</strong></div>
														<div><span className="lbl">Quality</span><strong>Excellent</strong></div>
														<div><span className="lbl">Credit Card</span><strong>Active</strong></div>
													</div>
													<button className="primary-cta sp-try-btn" type="button" onClick={loadDemoSample} style={{ marginLeft: '1.2em', marginTop: '.2em', alignSelf: 'flex-start' }}>Try sample</button>
												</div>
												<div className="sp-foot">
													Upload your PDF to replace this demo snapshot with live interactive charts.
												</div>
											</MotionDiv>
									{/* Removed legacy info-list (supported/guidelines) now shown inline near upload */}
									{/* Developer inline link removed per request */}
									{/* Moved stack badges & repo link to anchored bottom-right container */}
									<div className="dev-card" aria-labelledby="dev-heading">
										<h2 id="dev-heading">About the Developer</h2>
											<p><strong>Vahidin Jupic</strong> — Data Scientist & U.S. Marine Corps veteran with 9 years Department of Defense experience delivering secure, high‑integrity analytics.</p>
											<ul style={{margin:'0 0 .4rem 1rem', padding:0, listStyle:'disc', fontSize:'.58rem', lineHeight:1.35}}>
												<li>Expertise: data extraction, NLP patterning, anomaly detection, financial normalization.</li>
												<li>Focus: privacy‑first engineering & transparent, reviewable categorization.</li>
												<li>Built tools supporting mission decision workflows & secure data enclaves.</li>
											</ul>
											<p className="dev-links">
											<a href="https://www.linkedin.com/in/vahidin-jupic-0947b534b/" target="_blank" rel="noopener noreferrer" className="dev-link linkedin" aria-label="Open developer LinkedIn profile in new tab">Meet the Developer ↗</a>
											<a href="https://github.com/vahidinj" target="_blank" rel="noopener noreferrer" className="dev-link" aria-label="Open project GitHub repository in new tab">GitHub ↗</a>
										</p>
									</div>
									{isDropActive && (
										<div className="drag-overlay" aria-hidden="true">
											<div className="drag-overlay-inner">Drop to upload and parse on the secure backend</div>
										</div>
									)}
									{faqOpen && (
										<div className="faq condensed" aria-label="Frequently asked questions">
											<details open>
												<summary>Data privacy?</summary>
												<p>Server-side processing—PDFs are uploaded over HTTPS and parsed in-memory on the backend; parsed transactions are ephemeral by default and not persisted. AI refinement runs on the backend and is strictly opt-in; no external categorization calls are made. Use the one-click purge to clear session data immediately.</p>
											</details>
											<details>
												<summary>Best statement format?</summary>
												<p>Checking / Savings & credit card PDFs with clear tabular rows.</p>
											</details>
											<details>
												<summary>Payoff ratio?</summary>
												<p>Payments & credits ÷ charges (same period).</p>
											</details>
										</div>
									)}
								</div>
							</div>
							<div className="cover-corner" aria-label="Repository link">
								<a className="repo-link fine-print" href="https://github.com/vahidinj/pdf_parser" target="_blank" rel="noopener noreferrer" aria-label="Open project GitHub repository in new tab">GitHub Repo ↗</a>
							</div>
						</section>
					)}
					<a href="#charts-start" className="skip-link">Skip to charts</a>
					<a href="#table-start" className="skip-link">Skip to table</a>

					<section className={"upload-panel" + (isDropActive?" drop-active":"")} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
						{parseResult && (
							<label className="upload-btn"><DragonOrbIcon size={16} className="orb-icon" /> Upload PDF(s)
								<input ref={fileInputRef} type="file" accept="application/pdf" multiple onChange={onFileInputChange} />
							</label>
						)}
						{parseResult && !loading && (
							<button className="reset-btn" onClick={resetApp} title="Clear parsed data and return to cover">↩︎ Back</button>
						)}
							{backendStatus === 'down' && <div className="error">Backend offline (start API on :8000)</div>}
							{uploadWarnings.length > 0 && (
								<div className="upload-warning" role="alert" aria-live="polite">
									<ul>{uploadWarnings.map((w,i)=><li key={i}>{w}</li>)}</ul>
									<button type="button" className="dismiss-upload-warning" aria-label="Dismiss upload warnings" onClick={()=> setUploadWarnings([])}>×</button>
								</div>
							)}
						{loading && <div className="spinner" />}
						{error && <div className="error">{error}</div>}
					</section>
					{parseResult && !loading && (
							<section className="metrics">
								<div className={`metric composite accounts-metric ${consistencySummary? ('status-'+consistencySummary.status):''}`}>
									<span>Transactions · Accounts</span>
									{/* First row: transactions text only (no badges) */}
									<strong className="txns-line">
										{filteredTxns.length} <span className="label">transactions</span>
									</strong>
									{/* Composition rail + chips */}
									{Object.keys(accountTypeCounts).length>0 && (()=>{
										const entries = Object.entries(accountTypeCounts) as Array<[string, number]>;
										const total = entries.reduce((s,[,v])=> s+v, 0) || 1;
										return (
											<div className="acct-legend" aria-label="Account type composition">
												<div className="mix-bar" role="img" aria-label="Account composition bar">
													{entries.map(([k,v])=> {
														const pct = Math.max(0, Math.min(100, (v/total)*100));
														const cls = `seg ${k.toLowerCase()==='credit_card'?'credit-card':k.toLowerCase()}`;
														return <span key={k} className={cls} style={{width: pct+"%"}} title={`${k}: ${v} (${Math.round(pct)}%)`} />;
													})}
												</div>
												<div className="acct-mini-counts">
													{entries.map(([k,v])=> {
														const typeClass = (k||'').toLowerCase()==='credit_card' ? 'credit-card' : (k||'').toLowerCase();
														const labelType = (k||'').replace('_',' ');
														return (
															<span key={k} className={`acct-chip ${typeClass}`} title={`${v} ${labelType}`}>
																{labelType}: {v}
															</span>
														);
													})}
												</div>
											</div>
										);
									})()}
										{consistencySummary && (
											<div className="consistency-badge-wrap possible-issues-cta" ref={consistencyRef}>
												<button
													ref={(el) => { if (el) (consistencyRef.current as any) = el; }}
													className={`badge-inline ${consistencySummary.status} pop-btn possible ${showConsistencyDetails? 'open':''}`}
													type="button"
													aria-haspopup="dialog"
													aria-expanded={showConsistencyDetails}
													onClick={()=> setShowConsistencyDetails(v=> !v)}
													title="Open possible data issues"
												>
													{consistencySummary.issueCount === 0
														? 'no issues'
														: `${consistencySummary.issueCount} possible ${consistencySummary.issueCount === 1 ? 'issue' : 'issues'}`}
												</button>
												{showConsistencyDetails && (filteredConsistencyReport || consistencyReport) && (
													(() => {
														const popReport = (hasActiveFilters && filteredConsistencyReport) ? filteredConsistencyReport : consistencyReport;
														const totalIssues = consistencyReport?.issues?.length ?? 0;
														const filteredIssues = popReport?.issues?.length ?? 0;
														return (
															// PortalPopover used to escape stacking contexts created by filters
															<React.Suspense>
																{/* lazy positioning via PortalPopover */}
																{/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */}
																{/* @ts-ignore */}
																<PortalPopover anchorRef={consistencyRef as any} isOpen={true} className="consistency-popover">
																	<div className="cp-head">
																		Possible issues {hasActiveFilters && filteredConsistencyReport && <span className="micro">filtered</span>}
																		{hasActiveFilters && filteredConsistencyReport && (typeof filteredIssues === 'number') && (typeof totalIssues === 'number') && (
																			<span className="cp-subcount"> {filteredIssues} of {totalIssues}</span>
																		)}
																	</div>
																	{(!popReport || popReport.issues.length === 0) && <div className="cp-empty">No issues detected.</div>}
																	{popReport && (
																	<ul className="cp-list">
																		{popReport.issues.map((iss,i)=> (
																		<li key={i} className={`cp-item lvl-${iss.level}`}>
																			<span className="lvl-icon" aria-hidden="true">{iss.level==='error'?'⛔': iss.level==='warn'?'⚠':'ℹ'}</span>
																			<span className="msg">{iss.message}</span>
																		</li>
																		))}
																	</ul>
																	)}
																	<button className="cp-close" type="button" onClick={()=> setShowConsistencyDetails(false)} aria-label="Close possible issues panel">×</button>
																</PortalPopover>
															</React.Suspense>
															);
														})()
												)}
											</div>
									)}
								</div>
				
								<div className={`metric composite ${allocationStats && !allocationStats.disabled && allocationStats.overspend && !allocationStats.creditCardOnly ? 'status-warn' : ''}`}>
									<span>Allocation</span>
									{allocationStats ? (
										<>
											<strong>
												{allocationStats.disabled ? (
													<>
														Needs categories
																<span className="hint-inline" style={{marginLeft:6, fontWeight:400, fontSize:'0.97em'}}>
																<span aria-hidden="true">→</span> Click <b style={{color:'var(--accent)'}}>Categorize</b> below to enable insights
																</span>
													</>
												) : allocationStats.creditCardOnly ? 'Card activity' : (allocationStats.pSavings*100).toFixed(1)+"% saved"}
												{!allocationStats.disabled && allocationStats.overspend && !allocationStats.creditCardOnly && <span className="badge-inline warn" title="Expenses exceed income in this window">Overspend</span>}
											</strong>
												{allocationStats.disabled ? (
													<div className="secondary">Categorize to see Income/Savings/Expense split. Transfers are excluded. Card-only windows show income = 0.</div>
												) : (
												<div className="allocation-bars compact">
													{allocationStats.creditCardOnly && (
														<div className="secondary">Card-only view: income is 0 (payments aren't income).</div>
													)}
													<div className="bar-row income"><div className="name">Inc</div><div className="track"><div className="fill" style={{width:(allocationStats.pIncome*100)+'%'}}/></div><div className="pct">{(allocationStats.pIncome*100).toFixed(0)}%</div></div>
													<div className="bar-row savings"><div className="name">Sav</div><div className="track"><div className="fill" style={{width:(allocationStats.pSavings*100)+'%'}}/></div><div className="pct">{(allocationStats.pSavings*100).toFixed(1)}%</div></div>
													<div className="bar-row expense"><div className="name">Exp</div><div className="track"><div className="fill" style={{width:(allocationStats.pExpenses*100)+'%'}}/></div><div className="pct">{(allocationStats.pExpenses*100).toFixed(1)}%</div></div>
													{allocationStats.pUnallocated>0.001 && <div className="bar-row unallocated"><div className="name">Unal</div><div className="track"><div className="fill" style={{width:(allocationStats.pUnallocated*100)+'%'}}/></div><div className="pct">{(allocationStats.pUnallocated*100).toFixed(1)}%</div></div>}
													{/* Numeric flows inline to correlate with bars */}
													<div className="substats" aria-label="Flow totals">
														{!categoriesApplied && amountStatsSummary ? (
															<>
																<div className="row"><span className="lbl">Credits</span><span className="val">{fmtShort(amountStatsSummary.credits)}</span></div>
																<div className="row"><span className="lbl">Debits</span><span className="val">{fmtShort(amountStatsSummary.charges)}</span></div>
															</>
														) : allocationStats.creditCardOnly && amountStatsSummary ? (
															<>
																<div className="row"><span className="lbl">Payments</span><span className="val">{fmtShort(amountStatsSummary.credits)}</span></div>
																<div className="row"><span className="lbl">Charges</span><span className="val">{fmtShort(amountStatsSummary.charges)}</span></div>
															</>
														) : (
															<>
																<div className="row"><span className="lbl">Income</span><span className="val">{fmtShort(allocationStats.income)}</span></div>
																<div className="row"><span className="lbl">Expense</span><span className="val">{fmtShort(-allocationStats.expenses)}</span></div>
																{allocationStats.savings>0 && <div className="row"><span className="lbl">Savings</span><span className="val">{fmtShort(allocationStats.savings)}</span></div>}
															</>
														)}
													</div>
												</div>
											)}
										</>
									) : <strong>—</strong>}
								</div>
								{(() => {
									let concStatus = '' as '' | 'status-warn' | 'status-attn' | 'status-good';
									if (coverageStats && categoriesApplied) {
										const share = coverageStats.top3Share || 0;
										if (share >= 0.75) concStatus = 'status-attn';
										else if (share >= 0.6) concStatus = 'status-warn';
										else concStatus = 'status-good';
									}
									return (
										<div className={`metric composite ${concStatus}`}>
											<span>Concentration</span>
											{coverageStats ? (
												<>
													{!categoriesApplied ? (
														<>
															<strong>
																Needs categories
																	<span className="hint-inline" style={{marginLeft:6, fontWeight:400, fontSize:'0.97em'}}>
																		<span aria-hidden="true">→</span> Click <b style={{color:'var(--accent)'}}>Categorize</b> below to enable insights
																	</span>
															</strong>
															<div className="secondary">Categorize to see top 3 expense categories and their share.</div>
														</>
													) : (
														<>
															<strong>{(coverageStats.top3Share*100).toFixed(1)}% top3</strong>
															<div className="substats" aria-label="Top 3 expense categories">
																{coverageStats.top3.map(([cat,val]) => <div key={cat} className="row"><span className="lbl">{cat.slice(0,10)}</span><span className="val">{fmtShort(-val)}</span></div>)}
															</div>
														</>
													)}
												</>
											) : <strong>—</strong>}
										</div>
									);
								})()}
								{qualityHeuristic && (
									<div
										className="metric quality-metric"
										title={`Parse quality: ${qualityHeuristic.label} (${qualityHeuristic.percent}%)`}
										role="group"
										aria-label={`Parse quality ${qualityHeuristic.label} ${qualityHeuristic.percent} percent`}
										aria-describedby="parse-quality-desc"
										tabIndex={0}
									>
										<span>Parse Quality</span>
										<strong>
											<span className={`quality-badge q-${qualityHeuristic.label.toLowerCase()}`}>
												<button
													ref={qualityRef as any}
													className={`q-ring-btn q-${qualityHeuristic.label.toLowerCase()} q-badge-clickable`}
													type="button"
													aria-haspopup="dialog"
													aria-controls="parse-quality-popover"
													aria-expanded={showQualityInfo}
													aria-label={`Parse quality ${qualityHeuristic.percent} percent, ${qualityHeuristic.label}`}
													title={showQualityInfo ? 'Hide parse quality details' : 'Show parse quality details'}
													onClick={() => { setShowQualityInfo(s => !s); setRingAnimKey(k => k + 1); }}
													onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowQualityInfo(s => !s); setRingAnimKey(k => k + 1); } }}
												>
													<span className="q-ring" aria-hidden="true">
														<svg key={ringAnimKey} viewBox="0 0 48 48" className={`q-ring-svg ${ringAnimKey > 0 ? 'pulse' : ''}`} aria-hidden="true" focusable="false">
															<defs>
																<linearGradient id="qGrad" x1="0%" x2="100%">
																	<stop offset="0%" stopColor="var(--accent)" stopOpacity="1" />
																	<stop offset="100%" stopColor="var(--accent-hover)" stopOpacity="1" />
																</linearGradient>
															</defs>
															<circle className="q-ring-bg" cx="24" cy="24" r="19" />
															<circle className="q-ring-fg" cx="24" cy="24" r="19" strokeDasharray={`${qualityHeuristic.percent} 100`} />
															<g className="q-info" transform="translate(24,24) rotate(90)" aria-hidden="true">
																<circle className="q-info-indicator" r="12" />
																<text className="q-info-text" x="0" y="0" textAnchor="middle" dominantBaseline="middle">i</text>
															</g>
														</svg>
													</span>
													<span className="q-values">
														<span className="q-label">{qualityHeuristic.percent}%</span>
														<span className="q-text">{qualityHeuristic.label}</span>
													</span>
												</button>
											</span>
										</strong>
									{/* Visually-hidden description for screen readers providing more context */}
									<p id="parse-quality-desc" className="sr-only">Parse quality is a heuristic based on transaction count, parsing coverage, and account type variety; higher percentages indicate cleaner parsing results.</p>
									{/* Themed popover (PortalPopover) anchored to the quality badge for consistent styling & placement */}
									{showQualityInfo && (
										<React.Suspense>
											<PortalPopover anchorRef={qualityRef as any} isOpen={true} className="consistency-popover quality-popover">
												<div id="parse-quality-popover" className="cp-head">Parse quality</div>
												<div className="cp-body" role="dialog" aria-modal="false" aria-labelledby="parse-quality-popover">
													<div className="quality-explain">
														<strong>How it's calculated:</strong> the percentage is a rounded score (0–100%) based on transaction count, a small penalty for unparsed lines, and a small boost when multiple account types are present.
														<br />
														<strong>What it means:</strong> 100% indicates near-complete parsing and good coverage; lower values mean some lines were not parsed or coverage is incomplete.
														<br />
														<em>If no unparsed lines are present the score is shown as 100%.</em>
													</div>
													<div className="quality-actions">
														<button
															className="link-btn"
															type="button"
															onClick={() => setIsUnparsedVisible(s => !s)}
															disabled={!(parseResult && Array.isArray(parseResult.unparsed_sample) && parseResult.unparsed_sample.length > 0)}
															aria-disabled={!(parseResult && Array.isArray(parseResult.unparsed_sample) && parseResult.unparsed_sample.length > 0)}
														>
															{isUnparsedVisible ? 'Hide' : 'View'} unparsed lines ({parseResult?.unparsed_sample?.length ?? 0})
														</button>
														<span className="hint-muted">
															{(parseResult && Array.isArray(parseResult.unparsed_sample) && parseResult.unparsed_sample.length > 0)
																? ' — Unparsed lines are not included in transaction totals.'
																: ' — No unparsed lines detected.'}
														</span>
													</div>
												</div>
												<button className="cp-close" type="button" onClick={() => { setShowQualityInfo(false); try { (qualityRef as any).current?.focus?.(); } catch {} }} aria-label="Close">×</button>
											</PortalPopover>
										</React.Suspense>
									)}
									</div>
								)}
								{/* Payoff ratio metric removed per request */}
							</section>
					)}
						{parseResult && (
						<section className="filters consolidated">
							<div className="filters-head">
								<button className="filters-toggle" aria-expanded={showFilterPanel} onClick={()=> setShowFilterPanel(o=>!o)}>{showFilterPanel? 'Hide Filters':'Show Filters'}</button>
								{shouldShowReset && (
									<button className="clear-filters inline head-clear" onClick={()=>{
										setRawFilter(''); setFilter(''); setActiveAccountTypes([]); setActiveSources([]);
										// Restore to dataset bounds if available, else clear
										setDateStart(dataMinDate || '');
										setDateEnd(dataMaxDate || '');
										setLiveStatus('Filters reset to defaults.');
									}}>Reset</button>
								)}
							</div>
							{amountStatsSummary && !showFilterPanel && (
								<div className="quick-stats inline-mini" aria-label="Quick statistics (collapsed)">
									<div className="qstat" title="Average amount"><span>Avg</span><strong>{formatNumber(amountStatsSummary.avg)}</strong></div>
									<div className="qstat" title="Median amount"><span>Med</span><strong>{formatNumber(amountStatsSummary.median)}</strong></div>
									<div className="qstat" title="Largest inflow"><span>Max+</span><strong>{formatNumber(amountStatsSummary.max)}</strong></div>
									<div className="qstat" title="Largest outflow"><span>Max-</span><strong>{formatNumber(amountStatsSummary.min)}</strong></div>
									<div className="qstat" title="Filtered total"><span>Total</span><strong>{formatNumber(amountStatsSummary.total)}</strong></div>
								</div>
							)}
									{showFilterPanel && (
										<>
											<div className="filters-panel" role="region" aria-label="Filter controls">
												<div className="filter-primary-row grid2">
													<div className="primary-left">
														<div className="search-composite" role="group" aria-label="Search by description and date range">
															<input ref={filterInputRef} className="filter-text" placeholder="Search description (⌘/Ctrl+K)" value={rawFilter} onChange={e => setRawFilter(e.target.value)} />
															<div className="date-range compact inside-search" aria-label="Date range">
																<label><span className="lbl">Start Date</span><DatePicker value={dateStart} onChange={setDateStart} ariaLabel="Start date" min={dataMinDate || undefined} max={dataMaxDate || undefined} /></label>
																<label><span className="lbl">End Date</span><DatePicker value={dateEnd} onChange={setDateEnd} ariaLabel="End date" min={dataMinDate || undefined} max={dataMaxDate || undefined} /></label>
															</div>
														</div>
													</div>
													<div className="primary-right">
														<CategorizeCluster
															onUncategorize={uncategorizeAll}
															categoriesApplied={categoriesApplied}
															categorizeLoading={categorizeLoading}
															isRefiningAI={isRefiningAI}
															useAI={useAI}
															onCategorize={() => categorizeTransactions('initial')}
															onToggleAI={() => { if(useAI){ setUseAI(false); return; } requestEnableAI(); }}
															justCategorizedFlash={justCategorizedFlash}
														/>
													</div>
												</div>
											</div>
											{/* Advanced filters collapsible */}
											{(() => {
												const totalSources = (parseResult as any).sources ? (parseResult as any).sources.length : 0;
												const typesSummary = activeAccountTypes.length === 0 ? 'All types' : `${activeAccountTypes.length} type${activeAccountTypes.length>1?'s':''}`;
												const sourcesSummary = totalSources > 1 ? (activeSources.length === 0 ? 'All sources' : `${activeSources.length}/${totalSources} sources`) : '';
												const visibleColsCount = Object.values(visibleCols).filter(Boolean).length;
												const colsSummary = `${visibleColsCount} cols`;
												return (
													<div className="filters-advanced">
														<div className="filters-advanced-head">
															<button className="filters-advanced-toggle" type="button" onClick={() => setShowAdvancedFilters(!showAdvancedFilters)} aria-expanded={showAdvancedFilters}>
																{showAdvancedFilters ? 'Hide advanced' : 'More filters'}
															</button>
															<div className="filters-summary" aria-live="polite">
																<span>{typesSummary}</span>
																{sourcesSummary && <span>· {sourcesSummary}</span>}
																<span>· {colsSummary}</span>
															</div>
														</div>
														{showAdvancedFilters && (
															<div className="filters-advanced-body">
																<div className="filters-secondary-row">
																	<div className="type-chips" aria-label="Account type filters">
																		{(parseResult.metrics.account_types || []).map(t => { const active = activeAccountTypes.includes(t); return <button key={t} className={active ? 'chip active' : 'chip'} onClick={() => setActiveAccountTypes(prev => active ? prev.filter(x => x !== t) : [...prev, t])}>{t}</button>; })}
																	</div>
																	{/* Source file toggles (multi-PDF mode) */}
																	{(parseResult as any).sources && (parseResult as any).sources.length > 1 && (
																		<div className="source-chips" aria-label="Source file filters">
																			{(parseResult as any).sources.map((s: any) => {
																				const name = s.fileName;
																				const active = activeSources.includes(name) || activeSources.length===0; // if none selected treat as all active
																				return <button key={name} className={active ? 'chip active' : 'chip'} onClick={() => {
																					setActiveSources(prev => {
																						if(prev.includes(name)) { const next = prev.filter(x=> x!==name); return next; }
																						return [...prev, name];
																					});
																				}} title="Toggle inclusion of this source file in views">{name}</button>;
																			})}
																		</div>
																	)}
																	<div className="col-toggle-group compact" aria-label="Column visibility">
																		{Object.entries(visibleCols).map(([key, val]) => (
																			<button
																				key={key}
																				type="button"
																				className={"col-toggle-btn" + (val ? ' active' : '')}
																				aria-pressed={val}
																				onClick={()=> setVisibleCols(prev=> ({...prev, [key]: !prev[key as keyof typeof prev]}))}
																				title={(val? 'Hide ':'Show ') + key + ' column'}
																			>
																				<span className="indicator" aria-hidden="true" />{key}
																			</button>
																		))}
																	</div>
																</div>
															</div>
														)}
													</div>
												);
											})()}
										</>
									)}
						</section>
					)}
						{/* AI consent modal temporarily removed for structural debugging */}
						{showAIConsent && (
							<div className="themed-modal ai-consent-layer" role="dialog" aria-modal="true" aria-labelledby="aiConsentTitle" aria-describedby="aiConsentBody">
								<div className="themed-backdrop" onClick={()=> setShowAIConsent(false)} />
								<div className="themed-modal-content ai-consent-modal" role="document">
									<h2 id="aiConsentTitle">Enable AI Refinement?</h2>
									<div id="aiConsentBody" className="ai-consent-body">
										<p><strong>Private & Server-side.</strong> When enabled, AI refinement runs on the backend in-memory; no external AI APIs are called. Parsed transaction data is not persisted by default.</p>
										<ul className="ai-consent-points">
											<li><span className="kw-local">Backend only</span> refinement processed in-memory on the server.</li>
											<li><span className="kw-private">Private & secure</span>—no external categorization calls.</li>
											<li>Improves category suggestions—always review and confirm results.</li>
										</ul>
										<label className="remember-choice">
											<input
												type="checkbox"
												aria-label="Remember my choice for future sessions"
												onChange={e=> {
													const remember = e.target.checked;
													try { localStorage.setItem('aiConsentRemember', remember? '1':'0'); } catch {/* ignore */}
												}}
											/> Remember my choice
										</label>
									</div>
									<div className="themed-actions">
										<button className="btn-cancel" type="button" onClick={()=> handleAIConsent(false, (localStorage.getItem('aiConsentRemember')==='1'))}>Not Now</button>
										<button className="btn-primary" type="button" onClick={()=> handleAIConsent(true, (localStorage.getItem('aiConsentRemember')==='1'))}>Enable AI</button>
									</div>
								</div>
							</div>
						)}
						{amountStatsSummary && showFilterPanel && (
						<section className="quick-stats" aria-label="Quick statistics for current filtered rows">
								<div className="qstat" title="Average amount across filtered rows"><span>Average</span><strong>{formatNumber(amountStatsSummary.avg)}</strong></div>
								<div className="qstat" title="Median amount (50th percentile) across filtered rows"><span>Median</span><strong>{formatNumber(amountStatsSummary.median)}</strong></div>
								<div className="qstat" title="Largest positive amount (inflow / credit)"><span>Largest Inflow</span><strong>{formatNumber(amountStatsSummary.max)}</strong></div>
								<div className="qstat" title="Largest negative amount (outflow / charge)"><span>Largest Outflow</span><strong>{formatNumber(amountStatsSummary.min)}</strong></div>
								<div className="qstat" title="Sum of all filtered amounts"><span>Filtered Total</span><strong>{formatNumber(amountStatsSummary.total)}</strong></div>
						</section>
					)}
						{parseResult && (
						<section className="charts-row four-charts unified">
							<span id="charts-start" className="sr-only" />
							<React.Suspense fallback={<div className="chart" style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:180}}>Loading charts…</div>}>
									{filteredVsOverallChart && (
									<div className="chart">
										<span className="chart-info" tabIndex={0} aria-label="Filtered vs Overall: Compare net result of your current filters against the full statement to estimate focus impact.">i
											<span className="tooltip" role="tooltip">
												<strong>Filtered vs Overall</strong><br/>
												Net of only filtered rows beside full statement net.
												<ul>
													<li><span className="kw-accent">Purpose</span>: Gauge how much of total activity your current slice represents.</li>
													<li><span className="kw-risk">Large gap</span>: Narrow lens; broaden filters to confirm trend.</li>
													<li><span className="kw-positive">Nearly equal</span>: Viewing most of dataset already.</li>
													<li>Adjust date or account type to watch proportion shift.</li>
												</ul>
											</span>
										</span>
									<Plot {...filteredVsOverallChart} className="plot-inner" useResizeHandler style={{width:'100%', height:'100%'}} />
									</div>
									)}
									{dailyNetChart && (
									<div className="chart">
										<span className="chart-info" tabIndex={0} aria-label={filteredTxns.length>0 && filteredTxns.every(t => (t.account_type||'credit_card')==='credit_card') ? 'Daily Net: Bars show daily net charges (negative) and credits (positive); dotted line is cumulative payoff momentum.' : 'Daily Net: Bars show daily net inflow (positive) or outflow (negative); dotted line is cumulative running total.'}>i
											<span className="tooltip" role="tooltip">
												<strong>Daily Net</strong><br/>
												{filteredTxns.length>0 && filteredTxns.every(t => (t.account_type||'credit_card')==='credit_card') ? 'Charges (neg) & credits (pos) per day.' : 'Net inflow (pos) / outflow (neg) each day.'}
												<ul>
													<li><span className="kw-accent">Bars</span>: Single-day impact.</li>
													<li><span className="kw-accent">Dotted line</span>: Cumulative trend; slope change = momentum shift.</li>
													<li><span className="kw-risk">Clusters of large negatives</span> = spending spikes.</li>
													<li><span className="kw-positive">Flat or rising steadily</span> = stabilizing / positive flow.</li>
												</ul>
											</span>
										</span>
										<Plot
											{...dailyNetChart}
											className="plot-inner"
											useResizeHandler
											style={{width:'100%', height:'100%'}}
											onHover={(e:any)=> { const d = e?.points?.[0]?.x; if(d) setHoverDate(d); }}
											onUnhover={()=> setHoverDate(null)}
											onRelayout={(e:any)=> {
												if(e && e['xaxis.range[0]'] && e['xaxis.range[1]']) {
													const start = String(e['xaxis.range[0]']).substring(0,10);
													const end = String(e['xaxis.range[1]']).substring(0,10);
													if(start !== dateStart) setDateStart(start);
													if(end !== dateEnd) setDateEnd(end);
													setLiveStatus(`Date range set ${start} → ${end}`);
												}
											}}
											onDoubleClick={()=> { setDateStart(''); setDateEnd(''); setLiveStatus('Date range cleared.'); }}
										/>
									</div>
									)}
									{accountMixChart && (
									<div className="chart">
										{showSankeyFlow && sankeyChart ? (
											<span className="chart-info" tabIndex={0} aria-label="Flow view: Income allocated to Savings, Spending and any Unallocated remainder; Spending split into top negative outflow categories; percentages show share of source node.">i
												<span className="tooltip" role="tooltip">
													<strong>Income Allocation Flow</strong><br/>Tracks how positive <em>Income</em> splits into <em>Savings</em>, <em>Spending</em>{' '}
													{`and${' '}Unallocated (if residual exists).`} Outbound Spending then fans out to top category outflows.
													<ul>
														<li><span className="kw-accent">Income</span>: Sum of positive transactions categorized 'Income'.</li>
														<li><span className="kw-accent">Savings</span>: Positive 'Savings' contributions (optionally split by account).</li>
														<li><span className="kw-risk">Spending Categories</span>: Absolute value of negative amounts (non Income/Savings) grouped; top N + Other.</li>
														<li>Unallocated appears if Income exceeds Savings + Spending during the window.</li>
														<li>Hover % = portion of the source node (not global total).</li>
														<li>Avg / Month adds per‑month figures when span &gt; 1 month.</li>
													</ul>
												</span>
											</span>
										) : categoriesApplied ? (
											<span className="chart-info" tabIndex={0} aria-label="Bar view: Income, Savings, and aggregated Expense (all other categories) using gross positive Income/Savings and absolute negatives for Expense.">i
												<span className="tooltip" role="tooltip">
													<strong>Income · Savings · Expense</strong><br/>Gross flows (Income & Savings positive; Expense = sum absolute negatives of other categories; transfers ignored).
													<ul>
														<li><span className="kw-accent">Income</span>: Positive 'Income' rows only.</li>
														<li><span className="kw-accent">Savings</span>: Positive 'Savings' rows.</li>
														<li><span className="kw-risk">Expense</span>: Sum of abs(negative) for non Income/Savings categories.</li>
														<li>Use Flow toggle for allocation breakdown.</li>
													</ul>
												</span>
											</span>
										) : (
											<span className="chart-info" tabIndex={0} aria-label="Account Type Mix: Net inflow / outflow per account type before categorization.">i
												<span className="tooltip" role="tooltip">
													<strong>Account Type Mix</strong><br/>Net (signed) sums per account type prior to categorization.
													<ul>
														<li>Positive = net inflow / credits.</li>
														<li>Negative = net outflow / charges.</li>
														<li>Categorize to unlock Income/Savings/Expense & Flow views.</li>
													</ul>
												</span>
											</span>
										)}
										{/* Sankey toggle integration */}
										<div className="sankey-toggle-panel">
											<button type="button" className={"col-toggle-btn" + (showSankeyFlow? ' active':'')} aria-pressed={showSankeyFlow} onClick={()=> setShowSankeyFlow(s=> !s)} title="Toggle Flow (Sankey) view (switch with Income/Savings/Expense bar)">
												<span className="indicator" /> Flow
											</button>
										</div>
										{showSankeyFlow && sankeyChart ? (
											<>
												<Plot {...sankeyChart} className="plot-inner" useResizeHandler />
												<div className="chart-toggle-panel" aria-label="Sankey display options">
													<label className={!canExpandSavings? 'disabled':''} title={canExpandSavings? 'Show each savings account separately' : 'Only one savings account found'}>
														<input type="checkbox" disabled={!canExpandSavings} checked={canExpandSavings && expandSavings} onChange={e=> setExpandSavings(e.target.checked)} /> <span>Savings Split</span>
													</label>
													<label className={!canMonthlyAverage? 'disabled':''} title={canMonthlyAverage? 'Show average per month in labels' : 'Need >1 month span'}>
														<input type="checkbox" disabled={!canMonthlyAverage} checked={canMonthlyAverage && showMonthlyAverages} onChange={e=> setShowMonthlyAverages(e.target.checked)} /> <span>Avg / Month</span>
													</label>
												</div>
											</>
										) : (
											<Plot {...accountMixChart} className="plot-inner" useResizeHandler />
										)}
									</div>
									)}
									{creditChargesChart && (
									<div className="chart">
										<span className="chart-info" tabIndex={0} aria-label="Credit Card Charges vs Payments: Direct statement charges/payments or inferred payments from transfers when card statement absent.">i
											<span className="tooltip" role="tooltip">
												<strong>Credit Card Charges vs Payments</strong><br/>
												Shows net charges and payments if credit card transactions present. If not, negative Account Transfer rows mentioning a card are treated as inferred payments (Charges = 0).
												<ul>
													<li><span className="kw-risk">&lt;80%</span>: Growing balance.</li>
													<li><span className="kw-neutral">80–100%</span>: Near break-even.</li>
													<li><span className="kw-positive">&gt;100%</span>: Paying down.</li>
													<li>"(Inferred Payments)" title denotes transfer-based estimation.</li>
												</ul>
											</span>
										</span>
										<Plot {...creditChargesChart} className="plot-inner" useResizeHandler />
									</div>
									)}
							</React.Suspense>
						</section>
					)}
						{filteredTxns.length > 0 && (
						<section className="table-wrapper">
							<span id="table-start" className="sr-only" />
								<div ref={windowedRows.containerRef} onScroll={windowedRows.onScroll} className="windowed-rows-container" style={{height: windowedRows.viewportHeight}}>
									<table className="txn-table" style={{height: windowedRows.total * TXN_ROW_HEIGHT}}>
									<caption className="sr-only">Parsed transactions table. Columns: Date, Description, Amount, Balance, Account.</caption>
									<colgroup>
											{visibleCols.date && <col style={{width:'120px'}} />}
											{visibleCols.description && <col />}
											{visibleCols.category && <col style={{width:'120px'}} />}
											{visibleCols.amount && <col style={{width:'110px'}} />}
											{visibleCols.balance && <col style={{width:'110px'}} />}
											{visibleCols.type && <col style={{width:'100px'}} />}
											{visibleCols.source && <col style={{width:'160px'}} />}
									</colgroup>
									<thead>
										<tr>
												{visibleCols.date && <th className="sortable" onClick={() => toggleSort('date')} aria-sort={sort?.key==='date'? (sort.dir==='asc'?'ascending':'descending'):'none'}>Date {sort?.key==='date' && (sort.dir==='asc'?'▲':'▼')}</th>}
												{visibleCols.description && <th className="sortable" onClick={() => toggleSort('description')} aria-sort={sort?.key==='description'? (sort.dir==='asc'?'ascending':'descending'):'none'}>Description {sort?.key==='description' && (sort.dir==='asc'?'▲':'▼')}</th>}
												{visibleCols.category && <th className="col-category">Category</th>}
												{visibleCols.amount && <th className="sortable col-amount" onClick={() => toggleSort('amount')} aria-sort={sort?.key==='amount'? (sort.dir==='asc'?'ascending':'descending'):'none'}>Amount {sort?.key==='amount' && (sort.dir==='asc'?'▲':'▼')}</th>}
												{visibleCols.balance && <th className="sortable col-balance" onClick={() => toggleSort('balance')} aria-sort={sort?.key==='balance'? (sort.dir==='asc'?'ascending':'descending'):'none'}>Balance {sort?.key==='balance' && (sort.dir==='asc'?'▲':'▼')}</th>}
												{visibleCols.type && <th className="col-type">Account</th>}
												{visibleCols.source && <th className="col-source">Source</th>}
										</tr>
									</thead>
									<tbody>
										{/* Spacer row for virtualization offset; using single cell with colSpan to avoid table layout distortion */}
											{(() => { const visibleCount = Object.values(visibleCols).filter(Boolean).length || 1; return (
											<tr className="virtual-spacer" style={{height: windowedRows.offsetY }}>
												<td colSpan={visibleCount} style={{height:windowedRows.offsetY}} />
										</tr>); })()}
											{windowedRows.slice.map((t, idx) => {
												// Find the transaction's index in the underlying parseResult.transactions
												const globalIdx = parseResult ? parseResult.transactions.findIndex(p => p === t) : -1;
												return (
													<tr key={globalIdx >= 0 ? globalIdx : (windowedRows.startIndex + idx)}>
														{visibleCols.date && <td>{formatDate(t.date)}</td>}
														{visibleCols.description && <td className="desc" title={t.description}>{highlightDescription(t.description)}</td>}
														{visibleCols.category && <td className={"col-category " + (t.category_source === 'override' ? 'category-override' : '')}>
															<div style={{display:'flex', alignItems:'center', gap:8}}>
																<select
																	className={"category-select " + (t.category_source === 'override' ? 'override' : '')}
																	value={t.category || 'Uncategorized'}
																	onChange={e => handleCategoryChange(t, e.target.value)}
																	aria-label={`Category for ${t.description}`}
																>
																	{categoryOptions.map(co => <option key={co} value={co}>{co}</option>)}
																</select>
																{/* Inline mini-undo button when available for this transaction */}
																{globalIdx >= 0 && undoState[globalIdx] && (
																	<button
																		className="undo-mini has-tooltip"
																		data-tooltip="Undo change"
																		onClick={() => handleUndo(globalIdx)}
																		aria-label="Undo category change"
																	>
																		↶
																	</button>
																)}
															</div>
														</td>}
														{visibleCols.amount && <td className={"num col-amount " + (t.amount && t.amount < 0 ? 'neg' : 'pos')}>{typeof t.amount === 'number' ? formatNumber(t.amount) : ''}</td>}
														{visibleCols.balance && <td className="num col-balance">{typeof t.balance === 'number' ? formatNumber(t.balance) : ''}</td>}
														{visibleCols.type && <td className="col-type">{getAccountDisplay(t)}</td>}
														{visibleCols.source && <td className="col-source">{t.source_file || (parseResult && 'fileName' in parseResult ? parseResult.fileName : '')}</td>}
													</tr>
												);
											})}
									</tbody>
								</table>
							</div>
								{filteredTxns.length > 500 && <div className="truncate-note">Showing virtualized {filteredTxns.length} rows</div>}
						</section>
					)}
						{parseResult && filteredTxns.length === 0 && !loading && (
						<div className="table-empty-message" aria-label="No rows after filter">
							<div className="table-empty-title">No transactions match your search.</div>
							<div className="table-empty-sub">Try adjusting your description filter or clearing it to see all transactions.</div>
						</div>
					)}
						{filteredTxns.length > 0 && (
						<div className="download-actions">
							<button className="download-btn csv" onClick={downloadCSV} title="Download filtered rows as CSV">⬇️ <span className="kw">CSV</span></button>
							<button className="download-btn excel" onClick={downloadExcel} title="Download filtered rows as Excel">⬇️ <span className="kw">Excel</span></button>
							<button
								className="download-btn md"
								onClick={copyMarkdown}
								title="Copy filtered rows as Markdown to clipboard."
							>
								📋 <span className="kw">Markdown</span>
							</button>
						</div>
					)}
						{parseResult?.unparsed_sample?.length ? (
						<div className="unparsed-block">
								<button className="unparsed-toggle" onClick={()=> setIsUnparsedVisible(s=>!s)}>{isUnparsedVisible? 'Hide':'Show'} Unparsed Lines ({parseResult.unparsed_sample.length})</button>
								{isUnparsedVisible && <pre className="unparsed-lines">{parseResult.unparsed_sample.join('\n')}</pre>}
						</div>
					): null}
						<div aria-live="polite" className="sr-only" id="status-msg">{liveStatus}</div>
						<div aria-live="polite" className="sr-only" id="drag-status-msg">{dragAnnounce}</div>
					{tourOpen && (
						<div className="tour-modal" role="dialog" aria-modal="true" aria-labelledby="tour-title">
							<div className="tour-content">
								<h2 id="tour-title">Quick Tour</h2>
								<ol>
									<li><strong>Upload / Demo:</strong> Start with your PDF or the demo sample.</li>
									<li><strong>Filter & Types:</strong> Narrow rows instantly; stats & charts update live.</li>
									<li><strong>Download:</strong> Export filtered data with summary insights.</li>
									<li><strong>Columns:</strong> Toggle visibility to focus what matters.</li>
								</ol>
								<button onClick={()=> setTourOpen(false)} className="close-tour">Close</button>
							</div>
							<div className="tour-backdrop" onClick={()=> setTourOpen(false)} />
						</div>
					)}
					{whatsNewOpen && (
						<div className="tour-modal" role="dialog" aria-modal="true" aria-labelledby="whatsnew-title">
							<div className="tour-content whatsnew">
								<h2 id="whatsnew-title">What’s New</h2>
								<ul className="changelog">
										<li><strong>Date Format Preference:</strong> Switch between M/D/Y and D/M/Y (persisted).</li>
									<li><strong>Progress Steps:</strong> Clear onboarding path.</li>
									<li><strong>FAQ & Tooltips:</strong> Faster understanding of metrics.</li>
									<li><strong>Idle Arrow & PDF Badge:</strong> Visual hints on cover.</li>
								</ul>
								<button onClick={()=> setWhatsNewOpen(false)} className="close-tour">Close</button>
							</div>
							<div className="tour-backdrop" onClick={()=> setWhatsNewOpen(false)} />
						</div>
					)}
					{tipsOpen && (
						<div className="tour-modal" role="dialog" aria-modal="true" aria-labelledby="tips-title">
							<div className="tour-content tips-modal">
								<h2 id="tips-title">Parsing tips</h2>
								<ul className="tips-list">
									<li>Use native PDF statements (not scans) when possible.</li>
									<li>One statement per PDF improves balance reconstruction.</li>
									<li>Ensure totals & running balances are visible on pages.</li>
									<li>Trim very large multi-year PDFs for faster parsing.</li>
									<li>If parsing fails, retry after removing password protection.</li>
								</ul>
								<button onClick={()=> setTipsOpen(false)} className="close-tour">Close</button>
							</div>
							<div className="tour-backdrop" onClick={()=> setTipsOpen(false)} />
						</div>
					)}
				</main>
				<footer className="site-footer" role="contentinfo">
					<div className="footer-inner">
						<div className="footer-left">
							<span className="brand">mybudgetnerd.com</span>
							<span className="sep">·</span>
							<a href="mailto:deanjx2015@gmail.com">Contact</a>
						</div>
						<div className="footer-right">
							<small>Secure · Private · Ephemeral</small>
						</div>
					</div>
				</footer>
			</div>
		</React.Suspense>
	);
};
