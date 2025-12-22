import { useTranslation } from 'react-i18next';
import StatsOverview, { type StatsOverviewRef } from './components/StatsOverview'
import { useState, useEffect, useRef, type MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Trash2, Edit, Plus, ExternalLink, Pause, Play, RefreshCw, Layout, Copy, Download, Search, X } from 'lucide-react'
import { useToast } from './contexts/ToastContext'
import { useDialog } from './contexts/DialogContext'
import { useAuth } from './contexts/AuthContext'
import { timeAgo, formatDate, type HistoryRecord } from '@deltawatch/shared'

interface Monitor {
    id: number;
    name?: string;
    url: string;
    selector: string;
    selector_text?: string;
    type: 'text' | 'visual';
    interval: string;
    active: boolean;
    last_check?: string;
    last_screenshot?: string;
    tags?: string;
    history?: Array<HistoryRecord & { http_status: number | null }>;
    unread_count?: number;
}

const TimeAgo = ({ date }: { date: string | null | undefined }) => {
    const timeString = timeAgo(date);
    return <span>{timeString}</span>;
};

const Dashboard = () => {
  const { t } = useTranslation();
  const [monitors, setMonitors] = useState<Monitor[]>([])
  const [loading, setLoading] = useState(true)
  const [checkingMonitors, setCheckingMonitors] = useState<Set<number>>(new Set())
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [showStats, setShowStats] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [groupBy, setGroupBy] = useState<'none' | 'type'>('none')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'error'>('all')
  const navigate = useNavigate()
  const { showToast } = useToast()
  const { confirm } = useDialog()
  const { authFetch } = useAuth()
  const API_BASE = '';
  const statsRef = useRef<StatsOverviewRef>(null);

  useEffect(() => {
    fetchMonitors()
    const interval = setInterval(() => fetchMonitors(true), 30000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchMonitors = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
        const res = await authFetch(`${API_BASE}/monitors`)
        const data = await res.json()
        if (data.message === 'success') {
            setMonitors(data.data)
        }
    } catch (e) {
        console.error(e)
    } finally {
        if (!silent) setLoading(false)
    }
  }

  const handleDelete = async (id: number, e?: MouseEvent) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const confirmed = await confirm({
          title: 'Delete Monitor',
          message: 'Are you sure you want to delete this monitor? This action cannot be undone.',
          confirmText: 'Delete',
      });
      if (!confirmed) return;

      try {
          await authFetch(`${API_BASE}/monitors/${id}`, { method: 'DELETE' })
          fetchMonitors()
          showToast(t('dashboard.toasts.monitor_deleted'), 'success')
          // Refresh stats immediately
          statsRef.current?.refresh();
      } catch {
          showToast(t('dashboard.toasts.delete_failed'), 'error')
      }
  }

  const handleCheck = async (monitor: Monitor, e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (checkingMonitors.has(monitor.id)) return;

      setCheckingMonitors(prev => {
          const newSet = new Set(prev);
          newSet.add(monitor.id);
          return newSet;
      });

      try {
          const res = await authFetch(`${API_BASE}/monitors/${monitor.id}/check`, { method: 'POST' });
          if(res.ok) {
              await fetchMonitors();
              showToast(t('monitor_details.toasts.check_success'), 'success');
              // Refresh stats immediately
              statsRef.current?.refresh();
          }
          else {
              const text = await res.text();
              showToast(t('dashboard.toasts.check_failed', { error: text }), 'error');
          }
      } catch(err) { 
          showToast(t('monitor_details.toasts.check_generic_error', { error: err instanceof Error ? err.message : 'Unknown error' }), 'error'); 
      } finally {
          setCheckingMonitors(prev => {
              const newSet = new Set(prev);
              newSet.delete(monitor.id);
              return newSet;
          });
      }
  }

  const handleEdit = (monitor: Monitor, e?: MouseEvent) => {
      if (e) {
          e.preventDefault();
          e.stopPropagation();
      }
      navigate(`/edit/${monitor.id}`)
  }
  
  const handleToggleStatus = async (monitor: Monitor, e?: MouseEvent) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      try {
          setMonitors(monitors.map(m => m.id === monitor.id ? { ...m, active: !m.active } : m));
           await authFetch(`${API_BASE}/monitors/${monitor.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ active: !monitor.active })
          });
          // Refresh stats immediately
          statsRef.current?.refresh();
      } catch (e) {
          console.error(e);
          fetchMonitors(); 
      }
  }

  const handleDuplicate = async (monitor: Monitor, e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      try {
          // Parse tags if it's a JSON string to prevent double-encoding
          let parsedTags = [];
          try {
              parsedTags = typeof monitor.tags === 'string' ? JSON.parse(monitor.tags || '[]') : (monitor.tags || []);
          } catch { parsedTags = []; }
          
          const newMonitor = {
              url: monitor.url,
              selector: monitor.selector,
              selector_text: monitor.selector_text,
              type: monitor.type,
              interval: monitor.interval,
              name: `${monitor.name || 'Monitor'} (Copy)`,
              tags: Array.isArray(parsedTags) ? parsedTags : [],
          };
          
          const res = await authFetch(`${API_BASE}/monitors`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(newMonitor)
          });
          
          if (res.ok) {
              await fetchMonitors();
              showToast(t('dashboard.toasts.duplicate_success'), 'success');
              statsRef.current?.refresh();
          } else {
              throw new Error('Failed to duplicate');
          }
      } catch {
          showToast(t('dashboard.toasts.duplicate_failed'), 'error');
      }
  }

  const handleExport = (monitor: Monitor, e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      const exportData = {
          url: monitor.url,
          selector: monitor.selector,
          selector_text: monitor.selector_text,
          type: monitor.type,
          interval: monitor.interval,
          name: monitor.name,
          tags: monitor.tags,
      };
      
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${monitor.name || 'monitor'}-export.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(t('dashboard.toasts.export_success'), 'success');
  }




  const allTags = [...new Set(monitors.flatMap(m => {
    try { return JSON.parse(m.tags || '[]') as string[]; } catch { return []; }
  }))].sort();

  const filteredMonitors = monitors.filter(m => {
      // Filter by status (from stats tiles)
      if (statusFilter === 'active') {
          if (!m.active) return false;
      } else if (statusFilter === 'inactive') {
          if (m.active) return false;
      } else if (statusFilter === 'error') {
          const hasError = m.history?.some(h => h.status === 'error' || (h.http_status !== null && h.http_status >= 400));
          if (!hasError) return false;
      }

      // Filter by tag and search...
      if (selectedTag) {
          try { 
              const tags = JSON.parse(m.tags || '[]') as string[];
              if (!tags.includes(selectedTag)) return false;
          } catch { return false; }
      }
      if (searchQuery) {
          const query = searchQuery.toLowerCase();
          const nameMatch = (m.name || '').toLowerCase().includes(query);
          const urlMatch = m.url.toLowerCase().includes(query);
          if (!nameMatch && !urlMatch) return false;
      }
      return true;
  });

  console.log(`[Dashboard] Render. Filter: ${statusFilter}, Monitors: ${monitors.length}, Filtered: ${filteredMonitors.length}`);

    const renderMonitorCard = (monitor: Monitor) => (
        <Link 
            to={`/monitor/${monitor.id}`}
            key={monitor.id} 
            className="bg-[#161b22] border border-gray-800 hover:border-gray-600 rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between transition-colors group block mb-2"
        >
            <div className="flex items-start gap-4 flex-1 min-w-0 w-full">
                {monitor.type === 'visual' && (
                     <div 
                        className="w-24 h-16 bg-gray-800 rounded border border-gray-700 overflow-hidden flex-shrink-0 relative group/img cursor-pointer transition-opacity hover:opacity-80" 
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (monitor.last_screenshot) {
                                window.open(`${API_BASE}/static/screenshots/${monitor.last_screenshot.split('/').pop()}`, '_blank');
                            }
                        }}
                     >
                         {monitor.last_screenshot ? (
                             <img 
                                src={`${API_BASE}/static/screenshots/${monitor.last_screenshot.split('/').pop()}`} 
                                alt="Monitor" 
                                className="w-full h-full object-cover"
                             />
                         ) : (
                             <div className="flex items-center justify-center w-full h-full text-gray-600">
                                 <div className="bg-gray-700 w-8 h-8 rounded-full flex items-center justify-center">
                                     <span className="text-xs">No Img</span>
                                 </div>
                             </div>
                         )}
                     </div>
                 )}

                 <div className="min-w-0 flex flex-col gap-1 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider border ${
                            monitor.type === 'visual' ? 'bg-blue-900/30 text-blue-400 border-blue-900' : 
                            (monitor.selector === 'body' ? 'bg-purple-900/30 text-purple-400 border-purple-900' : 'bg-green-900/30 text-green-400 border-green-900')
                        }`}>
                            {monitor.type === 'visual' ? 'VISUAL' : (monitor.selector === 'body' ? 'FULL PAGE' : 'TEXT')}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider border bg-red-500/20 text-red-300 border-red-500/30">
                            {monitor.interval}
                        </span>
                        {monitor.history && monitor.history.length > 0 && (() => {
                            const historyWithStatus = monitor.history.filter(h => h.http_status !== null);
                            if (historyWithStatus.length === 0) return null;
                            const upCount = historyWithStatus.filter(h => (h.http_status ?? 0) < 400).length;
                            const uptime = Math.round((upCount / historyWithStatus.length) * 100);
                            const colorClass = uptime >= 99 ? 'bg-green-900/30 text-green-400 border-green-900' :
                                              uptime >= 95 ? 'bg-yellow-900/30 text-yellow-400 border-yellow-900' :
                                              'bg-red-900/30 text-red-400 border-red-900';
                            return (
                                <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider border ${colorClass}`}>
                                    {uptime}% {t('dashboard.uptime')}
                                </span>
                            );
                        })()}
                        <h3 className="text-white font-bold text-lg truncate max-w-[200px] md:max-w-xs flex items-center gap-2" title={monitor.name || monitor.url}>
                            {monitor.name || (monitor.url ? new URL(monitor.url).hostname : 'Untitled')}
                            {(monitor.unread_count ?? 0) > 0 && (
                                <span className="w-5 h-5 text-[10px] font-bold rounded-full bg-blue-500 text-white flex items-center justify-center flex-shrink-0">
                                    {(monitor.unread_count ?? 0) > 9 ? '9+' : monitor.unread_count}
                                </span>
                            )}
                        </h3>
                    </div>
                    
                    {monitor.type === 'text' && (
                        <p className="text-gray-400 text-sm truncate" title={monitor.selector_text}>
                            {monitor.selector_text || 'No selector text'}
                        </p>
                    )}
                    <p className="text-gray-500 text-xs truncate font-mono">
                        {monitor.url}
                    </p>
                 </div>
            </div>

            <div className="flex items-center justify-between md:justify-end gap-4 md:gap-6 mt-4 md:mt-0 w-full md:w-auto border-t md:border-t-0 border-gray-800 pt-3 md:pt-0">
                    <div className="text-left md:text-right">
                    <div className="flex items-center gap-1 justify-start md:justify-end mb-1">
                        <div className="flex gap-[2px]">
                            {[...Array(20)].map((_, i) => {
                                // History is sorted newest-first, we want newest on the LEFT
                                // So bar index 0 (leftmost) should show history[0] (newest)
                                const historyLength = Math.min(monitor.history ? monitor.history.length : 0, 20);
                                const record = i < historyLength && monitor.history ? monitor.history[i] : null;

                                let colorClass = 'bg-gray-800';
                                if (record) {
                                    if (record.status === 'unchanged') colorClass = 'bg-green-500';
                                    else if (record.status === 'changed') colorClass = 'bg-yellow-500';
                                    else if (record.status === 'error') colorClass = 'bg-red-500';
                                }

                                return (
                                    <div 
                                        key={i} 
                                        className={`w-1 h-4 rounded-sm ${colorClass} ${record ? 'cursor-pointer hover:opacity-75 transition-opacity' : ''}`}
                                        title={record ? `${new Date(formatDate(record.created_at)).toLocaleString()} - ${record.status}` : 'No Data'}
                                        onClick={record ? (e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            navigate(`/monitor/${monitor.id}#history-${record.id}`);
                                        } : undefined}
                                    />
                                );
                            })}
                        </div>
                    </div>

                    <div className="text-xs text-gray-400 mt-2 flex items-center gap-4 justify-start md:justify-end">
                        <span className="flex items-center gap-1" title={formatDate(monitor.last_check) ? new Date(formatDate(monitor.last_check)).toLocaleString() : 'Never'}>
                            <div className={`w-2 h-2 rounded-full ${monitor.active ? 'bg-green-500' : 'bg-gray-500'}`}></div>
                            <TimeAgo date={monitor.last_check} />
                        </span>
                    </div>
                </div>

                 <div className="flex gap-2">
                    <button 
                        onClick={(e) => handleCheck(monitor, e)} 
                        disabled={checkingMonitors.has(monitor.id)}
                        className={`p-2 text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded transition-colors ${checkingMonitors.has(monitor.id) ? 'cursor-not-allowed opacity-50' : ''}`} 
                        title="Check Now"
                    >
                        <RefreshCw size={16} className={checkingMonitors.has(monitor.id) ? 'animate-spin' : ''} />
                    </button>
                    <button onClick={(e) => handleEdit(monitor, e)} className="p-2 text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded transition-colors" title="Edit">
                        <Edit size={16} />
                    </button>
                    <button onClick={(e) => handleDelete(monitor.id, e)} className="p-2 text-gray-400 hover:text-red-400 bg-gray-800 hover:bg-gray-700 rounded transition-colors" title="Delete">
                        <Trash2 size={16} />
                    </button>
                    <button 
                        onClick={(e) => handleToggleStatus(monitor, e)} 
                        className={`p-2 rounded transition-colors ${!monitor.active ? 'text-green-400 bg-green-900/30 hover:bg-green-900/50 border border-green-700/50' : 'text-orange-400 bg-orange-900/20 hover:bg-orange-900/30 hover:text-orange-300'}`}
                        title={!monitor.active ? "Resume" : "Pause"}
                    >
                        {!monitor.active ? <Play size={16} fill="currentColor" /> : <Pause size={16} />}
                    </button>
                    <button onClick={(e) => handleDuplicate(monitor, e)} className="p-2 text-gray-400 hover:text-blue-400 bg-gray-800 hover:bg-gray-700 rounded transition-colors" title="Duplicate">
                        <Copy size={16} />
                    </button>
                    <button onClick={(e) => handleExport(monitor, e)} className="p-2 text-gray-400 hover:text-green-400 bg-gray-800 hover:bg-gray-700 rounded transition-colors" title="Export">
                        <Download size={16} />
                    </button>
                 </div>
            </div>
        </Link>
    );

    // Calculate current error count for StatsOverview
    const currentErrors = monitors.filter(m => 
        m.active && m.history?.some(h => h.status === 'error' || (h.http_status !== null && h.http_status >= 400))
    ).length;

    return (
    <div className="h-full flex flex-col">
       <div className="flex flex-col gap-3 mb-6">
            <div className="flex justify-between items-center">
                <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight">{t('dashboard.title')}</h1>
                <Link 
                    to="/new" 
                    className="group relative inline-flex items-center gap-1.5 px-3 py-2 md:px-5 md:py-2.5 bg-[#238636] hover:bg-[#2ea043] text-white rounded-lg font-semibold text-xs md:text-sm transition-all shadow-lg hover:shadow-green-900/30 border border-transparent hover:border-green-400/30 overflow-hidden flex-shrink-0"
                >
                     <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></div>
                    <Plus size={16} className="relative z-10" /> 
                    <span className="relative z-10 hidden sm:inline">{t('dashboard.new_delta')}</span>
                    <span className="relative z-10 sm:hidden">{t('dashboard.new_delta')}</span>
                </Link>
            </div>
            
            <div className="flex items-center gap-2 flex-wrap">
                <button 
                    onClick={() => setShowStats(!showStats)}
                    className={`p-1.5 rounded-md transition-all ${showStats ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}
                    title={showStats ? "Hide Statistics" : "Show Statistics"}
                >
                    <Layout size={18} />
                </button>
                <Link 
                    to="/kiosk"
                    className="p-1.5 rounded-md transition-all bg-gray-800 text-gray-500 hover:text-white"
                    title="Kiosk Mode"
                >
                    <ExternalLink size={18} />
                </Link>
                <div className="h-6 w-px bg-gray-700 mx-1"></div>
                <div className="flex bg-gray-800 rounded-lg p-0.5">
                    <button
                        onClick={() => setGroupBy('none')}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${groupBy === 'none' ? 'bg-[#161b22] text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
                    >
                        {t('dashboard.list')}
                    </button>
                    <button
                        onClick={() => setGroupBy('type')}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${groupBy === 'type' ? 'bg-[#161b22] text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
                    >
                        {t('dashboard.group')}
                    </button>
                </div>
                <div className="h-6 w-px bg-gray-700 mx-1"></div>
                <div className="relative flex-1 max-w-xs">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                        type="text"
                        placeholder={t('dashboard.search_placeholder')}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-8 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                    {searchQuery && (
                        <button 
                            onClick={() => setSearchQuery('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>
            </div>
        </div>

       
        <div className={`transition-all duration-300 ease-in-out overflow-hidden ${showStats ? 'max-h-[500px] opacity-100 mb-6' : 'max-h-0 opacity-0 mb-0'}`}>
            <StatsOverview 
                ref={statsRef} 
                onFilterClick={(filter) => {
                    console.log(`[Dashboard] onFilterClick received: ${filter}, current: ${statusFilter}`);
                    setStatusFilter(filter === statusFilter ? 'all' : filter);
                }}
                activeFilter={statusFilter}
                currentErrorCount={currentErrors}
            />
        </div>

        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => setSelectedTag(null)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                selectedTag === null 
                  ? 'bg-blue-500 text-white' 
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {t('dashboard.all')} ({monitors.length})
            </button>
            {allTags.map(tag => (
              <button
                key={tag}
                onClick={() => setSelectedTag(tag === selectedTag ? null : tag)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  selectedTag === tag 
                    ? 'bg-purple-500 text-white' 
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {tag} ({monitors.filter(m => { try { return (JSON.parse(m.tags || '[]') as string[]).includes(tag); } catch { return false; }}).length})
              </button>
            ))}
          </div>
        )}

        {loading ? (
             <div className="text-center py-10 text-gray-500">{t('dashboard.loading')}</div>
        ) : (
            <div className={`transition-all duration-300 ease-in-out space-y-2`}>
                {filteredMonitors.length === 0 && (
                    <div className="text-center py-20 bg-[#161b22] rounded-lg border border-dashed border-gray-700">
                        <h3 className="text-lg font-medium text-gray-300">
                            {statusFilter !== 'all' ? t('dashboard.no_monitors_filter', { filter: statusFilter }) :
                             selectedTag ? t('dashboard.no_deltas_tag') : t('dashboard.no_deltas')}
                        </h3>
                        <p className="text-gray-500 mb-4">
                            {statusFilter !== 'all' ? t('dashboard.try_clearing_filter') :
                             selectedTag ? t('dashboard.try_another_tag') : t('dashboard.start_creating')}
                        </p>
                        {statusFilter !== 'all' && (
                            <button onClick={() => setStatusFilter('all')} className="text-blue-400 hover:text-blue-300 hover:underline mb-4 block mx-auto">
                                Clear Filter
                            </button>
                        )}
                        {!selectedTag && statusFilter === 'all' && <Link to="/new" className="text-blue-400 hover:text-blue-300 hover:underline">{t('dashboard.new_delta')}</Link>}
                    </div>
                )}

                {(() => {
                    if (groupBy === 'type') {
                        const visual = filteredMonitors.filter(m => m.type === 'visual');
                        const text = filteredMonitors.filter(m => m.type === 'text' && m.selector !== 'body');
                        const fullPage = filteredMonitors.filter(m => m.selector === 'body');

                        return (
                            <>
                                {visual.length > 0 && (
                                    <div className="mb-6">
                                        <h3 className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full bg-blue-500"></span> {t('dashboard.visual_monitors')}
                                        </h3>
                                        {visual.map(renderMonitorCard)}
                                    </div>
                                )}
                                {text.length > 0 && (
                                    <div className="mb-6">
                                        <h3 className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full bg-green-500"></span> {t('dashboard.text_monitors')}
                                        </h3>
                                        {text.map(renderMonitorCard)}
                                    </div>
                                )}
                                {fullPage.length > 0 && (
                                    <div className="mb-6">
                                        <h3 className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full bg-purple-500"></span> {t('dashboard.full_page_monitors')}
                                        </h3>
                                        {fullPage.map(renderMonitorCard)}
                                    </div>
                                )}
                            </>
                        );
                    } else {
                        return filteredMonitors.map(renderMonitorCard);
                    }
                })()}
            </div>
        )}
    </div>
  )
}

export default Dashboard
