import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Loader2, CheckCircle2, AlertTriangle, Mail, MessagesSquare } from 'lucide-react';
import type { CommunicationItem, CommsAuthStatus, CommsFilterPreset } from '../../types/ipc';
import { FilterPanel, type FilterState } from './FilterPanel';
import { GroupedMessageList } from './GroupedMessageList';
import { CommsTabs, type CommsTabId } from './CommsTabs';
import { GenerateDigestBar } from './GenerateDigestBar';
import { GraphAccountCard } from './GraphAccountCard';
import { DigestDetailView } from './DigestDetailView';
import { MiniCalendar } from '../Layout/MiniCalendar';
import { applyFilters } from './filterLogic';

type BackfillStageStatus = 'pending' | 'running' | 'ok' | 'error';
interface BackfillProgress {
  outlook: { status: BackfillStageStatus; count: number; error?: string };
  teams: { status: BackfillStageStatus; count: number; error?: string };
}
const BACKFILL_INITIAL: BackfillProgress = {
  outlook: { status: 'pending', count: 0 },
  teams: { status: 'pending', count: 0 },
};

// ── Digest queue ──
// Items flow queued -> generating -> done | error.
type QueueStatus = 'queued' | 'generating' | 'done' | 'error';
export interface QueueItem {
  id: string;
  date: string;
  itemIds: string[];
  status: QueueStatus;
  error?: string;
  progressMsg?: string;
}

class DigestQueueStore {
  queue: QueueItem[] = [];
  subs: Set<() => void> = new Set();
  digestToken = 0;

  subscribe(fn: () => void) {
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  }
  emit() { this.subs.forEach(fn => fn()); }

  setQueue(updater: (q: QueueItem[]) => QueueItem[]) {
    this.queue = updater(this.queue);
    this.emit();
  }

  enqueue(date: string, itemIds: string[]) {
    if (this.queue.some(x => x.date === date && (x.status === 'queued' || x.status === 'generating'))) return;
    this.setQueue(q => [...q, { id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, date, itemIds, status: 'queued' }]);
    this.processQueue();
  }

  removeFromQueue(id: string) {
    this.setQueue(q => q.filter(x => x.id !== id));
  }

  clearFinished() {
    this.setQueue(q => q.filter(x => x.status !== 'done' && x.status !== 'error'));
  }

  processQueue() {
    if (this.queue.some(x => x.status === 'generating')) return;
    const next = this.queue.find(x => x.status === 'queued');
    if (!next) return;
    
    this.setQueue(q => q.map(x => x.id === next.id ? { ...x, status: 'generating', progressMsg: 'iniciando...' } : x));
    
    window.redbusAPI.commsGenerateDigest({ date: next.date, itemIds: next.itemIds }).then(r => {
      if (r.status !== 'OK') {
        this.setQueue(q => q.map(x => x.id === next.id ? { ...x, status: 'error', error: r.error || 'falha' } : x));
        this.processQueue();
      }
    });
  }

  onProgress(msg: string) {
    this.setQueue(q => q.map(x => x.status === 'generating' ? { ...x, progressMsg: msg } : x));
  }

  onComplete(date: string) {
    this.setQueue(q => q.map(x => (x.status === 'generating' && x.date === date) ? { ...x, status: 'done', progressMsg: '' } : x));
    this.digestToken++;
    this.emit();
    this.processQueue();
  }

  onError(date: string, error: string) {
    this.setQueue(q => q.map(x => (x.status === 'generating' && x.date === date) ? { ...x, status: 'error', error: error || 'erro', progressMsg: '' } : x));
    this.emit();
    this.processQueue();
  }
}

export const digestStore = new DigestQueueStore();

let listenersBound = false;
function bindDigestListeners() {
  if (listenersBound) return;
  listenersBound = true;
  window.redbusAPI.onDigestProgress((msg: string) => digestStore.onProgress(msg));
  window.redbusAPI.onDigestComplete((p: any) => {
    digestStore.onComplete(p?.date);
    window.dispatchEvent(new CustomEvent('digest-completed', { detail: p }));
  });
  window.redbusAPI.onDigestError((p: any) => digestStore.onError(p?.date, p?.error));
}

const DEFAULT_FILTER: FilterState = {
  blacklist: [],
  whitelist: [],
  sources: { outlook: true, teams: true },
  unreadOnly: false,
  sameDomainOnly: false,
  searchQuery: '',
};

function todayYMD(): string {
  const d = new Date(); const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
/** Returns [sinceISO, untilISO) spanning the full local day for `ymd`. */
function dayRangeISO(ymd: string): { since: string; until: string } {
  const start = new Date(`${ymd}T00:00:00`);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return { since: start.toISOString(), until: end.toISOString() };
}

export const CommunicationHub: React.FC = () => {
  const [items, setItems] = useState<CommunicationItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER);
  const [authStatus, setAuthStatus] = useState<CommsAuthStatus | null>(null);
  const [deviceCode, setDeviceCode] = useState<{ userCode: string; verificationUri: string } | null>(null);
  const [presets, setPresets] = useState<CommsFilterPreset[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingDate, setLoadingDate] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<BackfillProgress>(BACKFILL_INITIAL);
  const [activeTab, setActiveTab] = useState<CommsTabId>('outlook');
  const [selectedDate, setSelectedDate] = useState<string>(todayYMD());
  const [digestDates, setDigestDates] = useState<Set<string>>(new Set());
  const [digestIdForDate, setDigestIdForDate] = useState<string | null>(null);
  const [defaultApplied, setDefaultApplied] = useState(false);
  
  // Track digest store to react to changes
  const [, setTick] = useState(0);
  useEffect(() => digestStore.subscribe(() => setTick(t => t + 1)), []);

  const digestQueue = digestStore.queue;
  const digestToken = digestStore.digestToken;
  const generatingItem = digestQueue.find(x => x.status === 'generating' && x.date === selectedDate);
  const busy = !!generatingItem;
  const progressMsg = generatingItem?.progressMsg || '';
  const itemInQueueState = digestQueue.find(x => x.date === selectedDate);
  const digestError = itemInQueueState?.status === 'error' ? itemInQueueState.error : null;

  // Ref mirrors selectedDate so event listeners registered once can filter
  // backfill-progress payloads against the currently-viewed date (parallel
  // queue backfills emit progress for other dates and must be ignored here).
  const selectedDateRef = useRef(todayYMD());

  useEffect(() => { bindDigestListeners(); }, []);

  const loadAuthAndPresets = useCallback(async () => {
    const [st, pr] = await Promise.all([
      window.redbusAPI.commsAuthStatus(),
      window.redbusAPI.commsListFilterPresets(),
    ]);
    if (st.status === 'OK' && st.data) setAuthStatus(st.data);
    if (pr.status === 'OK' && pr.data) {
      setPresets(pr.data);
      // Auto-apply default preset once per mount so the Hub opens with the
      // user's preferred filter view rather than the naked DEFAULT_FILTER.
      if (!defaultApplied) {
        const def = pr.data.find(p => p.isDefault);
        if (def) {
          setFilter({
            blacklist: def.blacklist, whitelist: def.whitelist,
            sources: def.sources, unreadOnly: def.unreadOnly,
            sameDomainOnly: !!def.sameDomainOnly, searchQuery: '',
          });
        }
        setDefaultApplied(true);
      }
    }
  }, [defaultApplied]);

  const loadDayItems = useCallback(async (date: string, opts: { backfill?: boolean } = {}) => {
    const { since, until } = dayRangeISO(date);
    setLoadingDate(true);
    setItems([]); // Clear UI exactly when changing date so no ghost messages appear
    
    if (opts.backfill !== false) setBackfillProgress(BACKFILL_INITIAL);
    try {
      // List local first to provide instant UI updates
      let localData: CommunicationItem[] = [];
      const ls = await window.redbusAPI.commsList({ since, until, limit: 5000 });
      if (ls.status === 'OK' && Array.isArray(ls.data)) {
        localData = ls.data;
        setItems(localData);
      }
      
      const isPast = date < todayYMD();
      const hasItems = localData.length > 0;
      let shouldBackfill = opts.backfill === true || (!isPast) || (isPast && !hasItems);
      if (opts.backfill === false) shouldBackfill = false;

      if (shouldBackfill) {
        try { 
          await window.redbusAPI.commsBackfillDate(date); 
          // Re-fetch after backfill
          const ls2 = await window.redbusAPI.commsList({ since, until, limit: 5000 });
          if (ls2.status === 'OK' && Array.isArray(ls2.data)) setItems(ls2.data);
        } catch { /* ignore — fall back to local */ }
      }
    } finally {
      setLoadingDate(false);
    }
  }, []);

  const loadDigestsIndex = useCallback(async () => {
    const r = await window.redbusAPI.listDigests(180);
    if (r.status === 'OK' && Array.isArray(r.data)) {
      setDigestDates(new Set((r.data as any[]).map(d => String(d.digest_date).slice(0, 10))));
    }
  }, []);

  const loadDigestForSelectedDate = useCallback(async (date: string) => {
    const r = await window.redbusAPI.getDigestByDate(date);
    if (r.status === 'OK' && r.data && (r.data as any).id) setDigestIdForDate((r.data as any).id);
    else setDigestIdForDate(null);
  }, []);

  useEffect(() => { loadAuthAndPresets(); loadDigestsIndex(); }, [loadAuthAndPresets, loadDigestsIndex]);
  useEffect(() => { selectedDateRef.current = selectedDate; loadDayItems(selectedDate); }, [selectedDate, loadDayItems]);
  useEffect(() => { loadDigestForSelectedDate(selectedDate); }, [selectedDate, loadDigestForSelectedDate, digestToken]);

  useEffect(() => {
    // New items from the background scheduler are always recent — only refresh
    // the visible list when the user is looking at today.
    window.redbusAPI.onCommsNewItems(() => { if (selectedDate === todayYMD()) loadDayItems(selectedDate, { backfill: false }); });
    window.redbusAPI.onCommsAuthStatus((s) => {
      setAuthStatus(s);
      if (s.connected) setDeviceCode(null);
    });
    
    const handleDigestCompleted = (e: any) => {
      const p = e.detail;
      if (p?.date === selectedDateRef.current && p?.id) {
        setDigestIdForDate(p.id);
      }
      loadDigestsIndex();
    };
    window.addEventListener('digest-completed', handleDigestCompleted);
    
    // Stage-by-stage backfill progress so the loading card can render a
    // per-source status (Outlook / Teams) with counts instead of a generic label.
    // Queue backfills run in parallel and emit progress for other dates —
    // those are silently dropped here and surfaced inside the queue panel.
    window.redbusAPI.onCommsBackfillProgress((p) => {
      if (p.date && p.date !== selectedDateRef.current) return;
      setBackfillProgress(prev => {
        if (p.stage === 'start') return BACKFILL_INITIAL;
        if (p.stage === 'done') return prev;
        const slot = prev[p.stage];
        const status: BackfillStageStatus = p.status === 'running' ? 'running' : p.status === 'ok' ? 'ok' : 'error';
        return { ...prev, [p.stage]: { status, count: p.count ?? slot.count, error: p.error } };
      });
    });

    return () => {
      window.removeEventListener('digest-completed', handleDigestCompleted);
    };
  }, [loadDayItems, loadDigestsIndex, selectedDate]);

  // User's email domain — derived from Graph `upn`. Feeds the "mesmo domínio" filter.
  const userDomain = useMemo(() => {
    const upn = authStatus?.upn || '';
    const at = upn.indexOf('@');
    return at >= 0 ? upn.slice(at + 1).toLowerCase() : '';
  }, [authStatus?.upn]);

  // Items are already day-scoped by the backend — only free text/blacklist/whitelist/unread/sameDomain remain.
  const dateFiltered = useMemo(() => applyFilters(items, filter, undefined, userDomain), [items, filter, userDomain]);
  const outlookItems = useMemo(() => dateFiltered.filter(i => i.source === 'outlook'), [dateFiltered]);
  const teamsItems = useMemo(() => dateFiltered.filter(i => i.source === 'teams'), [dateFiltered]);
  const visible = activeTab === 'outlook' ? outlookItems : activeTab === 'teams' ? teamsItems : [];
  const visibleIds = useMemo(() => new Set(visible.map(i => i.id)), [visible]);
  const visibleSelectedCount = useMemo(() => { let n = 0; selectedIds.forEach(id => { if (visibleIds.has(id)) n++; }); return n; }, [selectedIds, visibleIds]);

  // Calendar markers are driven by existing digests (items are now day-scoped,
  // so we can't precompute other days without extra round-trips).
  const activeDates = digestDates;

  const onToggle = useCallback((id: string) => {
    setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);
  const onToggleAll = useCallback((checked: boolean) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (checked) visible.forEach(i => n.add(i.id)); else visible.forEach(i => n.delete(i.id));
      return n;
    });
  }, [visible]);
  const onToggleGroup = useCallback((g: { items: CommunicationItem[] }, checked: boolean) => {
    setSelectedIds(prev => { const n = new Set(prev); if (checked) g.items.forEach(i => n.add(i.id)); else g.items.forEach(i => n.delete(i.id)); return n; });
  }, []);
  const onBlacklistGroup = useCallback((token: string) => {
    const t = token.trim().toLowerCase(); if (!t) return;
    setFilter(prev => prev.blacklist.includes(t) ? prev : { ...prev, blacklist: [...prev.blacklist, t] });
  }, []);
  const onOpen = useCallback((it: CommunicationItem) => { if (it.webLink) window.open(it.webLink, '_blank', 'noopener'); }, []);

  // Seed selection when the visible list changes (tab + date): default = all visible selected.
  useEffect(() => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      visible.forEach(i => { if (!n.has(i.id)) n.add(i.id); });
      return n;
    });
  }, [activeTab, selectedDate, dateFiltered.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConnect = async () => {
    const r = await window.redbusAPI.commsAuthStart();
    if (r.status === 'OK' && r.data) setDeviceCode({ userCode: r.data.userCode, verificationUri: r.data.verificationUri });
  };
  const handleDisconnect = async () => {
    await window.redbusAPI.commsAuthDisconnect();
    setAuthStatus({ connected: false }); setItems([]); setSelectedIds(new Set());
  };
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await window.redbusAPI.commsRefresh();
      await loadDayItems(selectedDate);
    } finally { setRefreshing(false); }
  };

  const handleGenerate = async () => {
    // Collect selection from both source tabs so a single click can digest email+teams of the day.
    const pool = new Set(dateFiltered.map(i => i.id));
    const ids = Array.from(selectedIds).filter(id => pool.has(id));
    if (ids.length === 0) return;
    if (ids.length > 400) return;
    digestStore.enqueue(selectedDate, ids);
  };

  const handleQueue = handleGenerate;

  const removeFromQueue = useCallback((id: string) => {
    digestStore.removeFromQueue(id);
  }, []);
  const clearFinishedQueue = useCallback(() => {
    digestStore.clearFinished();
  }, []);



  const handleDeleteDigest = async (id: string) => {
    await window.redbusAPI.deleteDigest(id);
    setDigestIdForDate(null); 
    digestStore.digestToken++;
    digestStore.emit();
    loadDigestsIndex();
  };

  const blockReason = !authStatus?.connected ? 'conecte o Microsoft 365' : undefined;
  const totalSelectedAcrossTabs = useMemo(() => { const pool = new Set(dateFiltered.map(i => i.id)); let n = 0; selectedIds.forEach(id => { if (pool.has(id)) n++; }); return n; }, [selectedIds, dateFiltered]);

  return (
    <div className="view-layout comms-hub">
      <aside className="view-sidebar">
        <div className="view-sidebar-header"><h2>comunicações</h2></div>
        <div className="comms-sidebar-scroll">
          <GraphAccountCard status={authStatus} deviceCode={deviceCode} onConnect={handleConnect} onDisconnect={handleDisconnect} onRefresh={handleRefresh} refreshing={refreshing} />
          <MiniCalendar selectedDate={selectedDate} activeDates={activeDates} onSelect={setSelectedDate} />
          <FilterPanel
            value={filter}
            onChange={setFilter}
            presets={presets}
            userDomain={userDomain}
            onSavePreset={async (p) => { const r = await window.redbusAPI.commsSaveFilterPreset(p); if (r.status === 'OK' && r.data) setPresets(r.data); }}
            onDeletePreset={async (id) => { const r = await window.redbusAPI.commsDeleteFilterPreset(id); if (r.status === 'OK' && r.data) setPresets(r.data); }}
            onApplyPreset={(p) => setFilter({ blacklist: p.blacklist, whitelist: p.whitelist, sources: p.sources, unreadOnly: p.unreadOnly, sameDomainOnly: !!p.sameDomainOnly, searchQuery: '' })}
          />
        </div>
      </aside>
      <main className="view-detail comms-detail">
        <CommsTabs active={activeTab} onChange={setActiveTab} counts={{ outlook: outlookItems.length, teams: teamsItems.length }} hasDigest={!!digestIdForDate} />
        {activeTab === 'digest' ? (
          <DigestDetailView
            date={selectedDate}
            digestId={digestIdForDate || undefined}
            onDelete={handleDeleteDigest}
            onGenerate={handleGenerate}
            generating={busy}
            progressMessage={progressMsg}
            canGenerate={!blockReason && totalSelectedAcrossTabs > 0}
            blockReason={digestError || blockReason || (totalSelectedAcrossTabs === 0 ? 'selecione itens nas abas Email/Teams' : undefined)}
          />
        ) : (
          <>
            {loadingDate && (
              <div className="comms-loading-card" role="status" aria-live="polite">
                <div className="comms-loading-header">
                  <Loader2 size={18} className="spin" />
                  <div className="comms-loading-headtxt">
                    <strong>carregando mensagens de {selectedDate}</strong>
                    <span>buscando no Microsoft Graph (Outlook + Teams)…</span>
                  </div>
                </div>
                <div className="comms-loading-bar"><div className="comms-loading-bar-fill" /></div>
                <ul className="comms-loading-stages">
                  {(['outlook', 'teams'] as const).map(stage => {
                    const s = backfillProgress[stage];
                    const Icon = stage === 'outlook' ? Mail : MessagesSquare;
                    const label = stage === 'outlook' ? 'Outlook' : 'Teams';
                    return (
                      <li key={stage} className={`comms-loading-stage status-${s.status}`}>
                        <Icon size={13} className="comms-loading-stage-src" />
                        <span className="comms-loading-stage-label">{label}</span>
                        <span className="comms-loading-stage-state">
                          {s.status === 'pending' && <span className="comms-loading-dim">aguardando…</span>}
                          {s.status === 'running' && <><Loader2 size={11} className="spin" /> buscando…</>}
                          {s.status === 'ok' && <><CheckCircle2 size={12} /> {s.count} {s.count === 1 ? 'novo' : 'novos'}</>}
                          {s.status === 'error' && <><AlertTriangle size={12} /> falhou{s.error ? ` — ${s.error}` : ''}</>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            <GroupedMessageList
              items={visible}
              selectedIds={selectedIds}
              onToggle={onToggle}
              onToggleAll={onToggleAll}
              onToggleGroup={onToggleGroup}
              onBlacklistGroup={onBlacklistGroup}
              onOpen={onOpen}
              source={activeTab}
            />
            <GenerateDigestBar
              total={dateFiltered.length}
              selected={totalSelectedAcrossTabs}
              busy={busy}
              progressMessage={progressMsg}
              blockReason={digestError || blockReason}
              onGenerate={handleGenerate}
              queueItems={digestQueue}
              onClearFinished={clearFinishedQueue}
            />
          </>
        )}
      </main>
    </div>
  );
};

