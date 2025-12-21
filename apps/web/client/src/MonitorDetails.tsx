import { useState, useEffect, type MouseEvent } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { ArrowLeft, ExternalLink, RefreshCw, AlertTriangle, Trash2, Download } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import * as Diff from 'diff';
import { useToast } from './contexts/ToastContext';
import { useDialog } from './contexts/DialogContext';
import { useAuth } from './contexts/AuthContext';
import { type HistoryRecord as SharedHistoryRecord, type Monitor as SharedMonitor, cleanValue } from '@deltawatch/shared';

interface Keyword {
    text: string;
    mode: 'appears' | 'disappears' | 'any';
}

// Extend shared types with web-specific fields
interface HistoryRecord extends SharedHistoryRecord {
    prev_screenshot_path?: string;
    diff_screenshot_path?: string;
    ai_summary?: string;
}

interface Monitor extends SharedMonitor {
    keywords?: string;
    history: HistoryRecord[];
}

interface GraphDataPoint {
    id: number;
    date: string;
    timestamp: number;
    value: number | null;
    raw: string | undefined;
}

import { useTranslation } from 'react-i18next';

function MonitorDetails() {
    const { t } = useTranslation();
    const { id } = useParams();
    const location = useLocation();
    const API_BASE = '';
    const [monitor, setMonitor] = useState<Monitor | null>(null);
    const [loading, setLoading] = useState(true);
    const [isChecking, setIsChecking] = useState(false);
    const [history, setHistory] = useState<GraphDataPoint[]>([]);
    const { showToast } = useToast();
    const { prompt } = useDialog();
    const [allTags, setAllTags] = useState<string[]>([]);
    const [historyFilter, setHistoryFilter] = useState<'all' | 'changed' | 'unchanged' | 'error'>('all');
    const { authFetch } = useAuth();

    const fetchMonitor = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const res = await authFetch(`${API_BASE}/monitors?t=${Date.now()}`);
            if (res.ok) {
                 const data = await res.json();
                 if (data.message === 'success') {
                    const tags = [...new Set(data.data.flatMap((m: Monitor) => {
                        try { return JSON.parse(m.tags || '[]') as string[]; } catch { return []; }
                    }))].sort() as string[];
                    setAllTags(tags);
                    
                    const found = data.data.find((m: Monitor) => m.id === parseInt(id || '0'));
                    if (found) {
                        setMonitor(found);
                        const historyArray = Array.isArray(found.history) ? found.history : [];
                        const graphData: (GraphDataPoint | null)[] = historyArray.map((h: HistoryRecord) => {
                             if (h.status === 'error') return null;

                             let valStr = h.value || "";
                             if (valStr.length > 50) return null;
                             
                             const numericChars = (valStr.match(/[0-9.,€$£¥%]/g) || []).length;
                             if (numericChars < valStr.replace(/\s/g, '').length * 0.5) return null;
                             
                             if (valStr.includes(',') && (!valStr.includes('.') || valStr.indexOf(',') > valStr.lastIndexOf('.'))) {
                                  valStr = valStr.replace(/\./g, '').replace(',', '.');
                             } else {
                                  valStr = valStr.replace(/,/g, '');
                             }
                             const val = parseFloat(valStr.replace(/[^0-9.-]+/g,""));
                             
                             return {
                                 id: h.id,
                                 date: new Date(h.created_at).toLocaleString(),
                                 timestamp: new Date(h.created_at).getTime(),
                                 value: isNaN(val) ? null : val,
                                 raw: h.value
                             };
                        });
                        setHistory(graphData.filter((item): item is GraphDataPoint => item !== null).reverse());
                    }
                 }
            }
        } catch (e) {
            console.error(e);
        } finally {
            if (!silent) setLoading(false);
        }
    };

    useEffect(() => {
        fetchMonitor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    useEffect(() => {
        if (monitor && (monitor.unread_count ?? 0) > 0) {
            authFetch(`${API_BASE}/monitors/${id}/read`, { method: 'POST' })
                .catch(err => console.error('Failed to mark as read:', err));
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [monitor?.id]);

    useEffect(() => {
        if (monitor && location.hash) {
            const el = document.querySelector(location.hash);
            if (el) {
                setTimeout(() => {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.classList.add('ring-2', 'ring-blue-500');
                    setTimeout(() => el.classList.remove('ring-2', 'ring-blue-500'), 2000);
                }, 100);
            }
        }
    }, [monitor, location.hash]);

    const handleRunCheck = async () => {
        if (isChecking) return;
        setIsChecking(true);
        
        try {
            const res = await authFetch(`${API_BASE}/monitors/${id}/check`, { method: 'POST' });
            if (res.ok) {
                 showToast(t('monitor_details.toasts.check_success'), 'success');
                 await fetchMonitor(true); 
            } else {
                const err = await res.text();
                showToast(t('monitor_details.toasts.check_error', { error: err }), 'error');
            }
        } catch(e) { 
            console.error(e); 
            showToast(t('monitor_details.toasts.check_generic_error', { error: (e instanceof Error ? e.message : 'Unknown') }), 'error'); 
        } finally { setIsChecking(false); }
    };

    const handleDeleteHistory = async (historyId: number, e?: MouseEvent) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        if (!historyId) {
            showToast(t('monitor_details.toasts.delete_error_no_id'), 'error');
            return;
        }
        
        try {
            const res = await authFetch(`${API_BASE}/monitors/${id}/history/${historyId}`, {
                method: 'DELETE',
            });
            if (res.ok) {
                 const newHistory = monitor?.history.filter(h => h.id !== historyId) || [];
                 setMonitor(prev => prev ? { ...prev, history: newHistory } : null);
                 setHistory(prev => prev.filter(h => h.id !== historyId));
                 showToast(t('monitor_details.toasts.history_deleted'), 'success');
            } else {
                const errText = await res.text();
                showToast(t('monitor_details.toasts.delete_failed', { error: errText }), 'error');
            }
        } catch (e) {
            showToast(t('monitor_details.toasts.network_error', { error: (e instanceof Error ? e.message : 'Unknown') }), 'error');
        }
    };
    
    const handleDownload = async (format: 'csv' | 'json') => {
        try {
            const res = await authFetch(`${API_BASE}/monitors/${id}/export/${format}`);
            if (res.ok) {
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `monitor-${id}.${format}`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
            } else {
                showToast(t('monitor_details.toasts.export_failed'), 'error');
            }
        } catch (e) {
            console.error(e);
            showToast(t('monitor_details.toasts.export_error'), 'error');
        }
    }

    const handleRemoveTag = async (tag: string) => {
        try {
            const currentTags: string[] = JSON.parse(monitor?.tags || '[]');
            const newTags = currentTags.filter(t => t !== tag);
            await authFetch(`${API_BASE}/monitors/${id}/tags`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tags: newTags })
            });
            fetchMonitor(true);
        } catch (e) {
            console.error('Failed to remove tag:', e);
        }
    };

    const handleAddTag = async () => {
        const currentTags: string[] = (() => { try { return JSON.parse(monitor?.tags || '[]'); } catch { return []; } })();
        const newTag = await prompt({
            title: t('monitor_details.add_tag_title'),
            message: t('monitor_details.add_tag_msg'),
            placeholder: 'Type new tag name...',
            confirmText: t('monitor_details.add_tag'),
            suggestions: allTags,
            exclude: currentTags
        });
        if (newTag) {
            try {
                if (!currentTags.includes(newTag)) {
                    await authFetch(`${API_BASE}/monitors/${id}/tags`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tags: [...currentTags, newTag] })
                    });
                    fetchMonitor(true);
                    showToast(t('monitor_details.toasts.tag_added', { tag: newTag }), 'success');
                } else {
                    showToast(t('monitor_details.toasts.tag_exists'), 'error');
                }
            } catch (e) {
                console.error('Failed to add tag:', e);
            }
        }
    };

    const handleRemoveKeyword = async (idx: number) => {
        try {
            const keywords: Keyword[] = JSON.parse(monitor?.keywords || '[]');
            const newKeywords = keywords.filter((_, i) => i !== idx);
            await authFetch(`${API_BASE}/monitors/${id}/keywords`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keywords: newKeywords })
            });
            fetchMonitor(true);
        } catch (e) {
            console.error('Failed to remove keyword:', e);
        }
    };

    const handleAddKeyword = async () => {
        const text = await prompt({
            title: t('monitor_details.add_keyword_title'),
            message: t('monitor_details.add_keyword_msg'),
            placeholder: 'e.g. "in stock", "sold out", "error"...',
            confirmText: 'Add'
        });
        if (text) {
            const mode = await prompt({
                title: t('monitor_details.alert_mode'),
                message: t('monitor_details.alert_mode_msg'),
                placeholder: 'appears, disappears, or any',
                defaultValue: 'appears',
                confirmText: 'Save',
                suggestions: ['appears', 'disappears', 'any']
            });
            if (mode) {
                try {
                    const currentKeywords: Keyword[] = JSON.parse(monitor?.keywords || '[]');
                    await authFetch(`${API_BASE}/monitors/${id}/keywords`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ keywords: [...currentKeywords, { text, mode }] })
                    });
                    fetchMonitor(true);
                    showToast(t('monitor_details.toasts.keyword_added', { keyword: text }), 'success');
                } catch (e) {
                    console.error('Failed to add keyword:', e);
                }
            }
        }
    };

    if (loading) return <div className="p-8 text-center text-gray-500">Loading details...</div>;
    if (!monitor) return <div className="p-8 text-center text-red-500">Monitor not found</div>;

    const numericValues = history.filter(h => h.value !== null && !isNaN(h.value));
    const showGraph = monitor.type !== 'visual' && monitor.selector !== 'body' && numericValues.length >= 2;

    const monitorTags: string[] = (() => {
        try { 
            const parsed = JSON.parse(monitor.tags || '[]'); 
            return Array.isArray(parsed) ? parsed : [];
        } catch { return []; }
    })();

    const monitorKeywords: Keyword[] = (() => {
        try { 
            const parsed = JSON.parse(monitor.keywords || '[]'); 
            return Array.isArray(parsed) ? parsed : [];
        } catch { return []; }
    })();

    return (
        <div className="flex h-full flex-col bg-[#0d1117] text-white p-6 overflow-y-auto">
            <div className="flex items-center gap-4 mb-6">
                <Link to="/" className="text-gray-400 hover:text-white transition-colors">
                    <ArrowLeft size={24} />
                </Link>
                <div className="flex-1">
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        {monitor.name || "Monitor Details"}
                        <span className={`px-2 py-0.5 rounded text-xs uppercase font-bold tracking-wider border ${monitor.type === 'visual' ? 'bg-blue-900/30 text-blue-400 border-blue-900' : 'bg-green-900/30 text-green-400 border-green-900'}`}>
                            {monitor.type}
                        </span>
                    </h1>
                    <a href={monitor.url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline text-sm flex items-center gap-1">
                        {monitor.url} <ExternalLink size={12} />
                    </a>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                        {monitorTags.map(tag => (
                            <span 
                                key={tag} 
                                className="px-2 py-0.5 rounded-full text-xs bg-purple-900/30 text-purple-300 border border-purple-800 flex items-center gap-1 cursor-pointer hover:bg-purple-900/50"
                                onClick={() => handleRemoveTag(tag)}
                                title={t('monitor_details.remove_tag')}
                            >
                                {tag} <span className="text-purple-500">×</span>
                            </span>
                        ))}
                        <button
                            className="px-2 py-0.5 rounded-full text-xs bg-gray-800 text-gray-400 border border-gray-700 hover:bg-gray-700 hover:text-white"
                            onClick={handleAddTag}
                        >
                            + {t('monitor_details.add_tag')}
                        </button>
                    </div>
                </div>
                <Link to={`/edit/${monitor.id}`} className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded border border-gray-700 transition-colors">
                    {t('monitor_details.edit')}
                </Link>
                <button 
                    onClick={handleRunCheck} 
                    disabled={isChecking}
                    className={`bg-[#1f6feb] hover:bg-blue-600 text-white px-4 py-2 rounded border border-blue-600 transition-colors flex items-center gap-2 ${isChecking ? 'opacity-75 cursor-not-allowed' : ''}`}
                >
                    <RefreshCw size={16} className={isChecking ? 'animate-spin' : ''} /> 
                    {isChecking ? t('monitor_details.checking') : t('monitor_details.check_now')}
                </button>
                
                <div className="relative group">
                    <button className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded border border-gray-700 transition-colors flex items-center gap-2">
                        <Download size={16} /> {t('monitor_details.export')}
                    </button>
                    <div className="absolute right-0 mt-1 w-40 bg-[#161b22] border border-gray-700 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
                        <button 
                            onClick={() => handleDownload('csv')}
                            className="block w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white rounded-t-lg"
                        >
                            📊 {t('monitor_details.export_csv')}
                        </button>
                        <button 
                            onClick={() => handleDownload('json')}
                            className="block w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white rounded-b-lg"
                        >
                            📋 {t('monitor_details.export_json')}
                        </button>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className={`${showGraph ? 'lg:col-span-1' : 'lg:col-span-3'} space-y-6`}>
                    <div className="bg-[#161b22] p-6 rounded-lg border border-gray-800">
                        <h3 className="text-gray-400 text-sm font-medium mb-4 uppercase tracking-wider">{t('monitor_details.current_status')}</h3>
                        
                        <div className="space-y-4">
                            <div>
                                <label className="text-gray-500 text-xs uppercase">{t('monitor_details.latest_value')}</label>
                                {monitor.selector === 'body' && monitor.last_value ? (
                                    <div className="text-base text-white">
                                        Full Page Content ({monitor.last_value.length} chars)
                                    </div>
                                ) : monitor.last_value && monitor.last_value.length > 50 ? (
                                    <div className="text-sm font-mono text-white bg-gray-900/50 p-3 rounded border border-gray-800 max-h-24 overflow-y-auto break-all">
                                        {monitor.last_value}
                                    </div>
                                ) : (
                                    <div className="text-2xl font-mono text-white break-all">
                                        {cleanValue(monitor.last_value || "No Data")}
                                    </div>
                                )}
                            </div>
                             <div>
                                <label className="text-gray-500 text-xs uppercase">{t('monitor_details.last_check')}</label>
                                <div className="text-white">
                                    {monitor.last_check ? new Date(monitor.last_check).toLocaleString() : 'Never'}
                                </div>
                            </div>
                             <div>
                                <label className="text-gray-500 text-xs uppercase">{t('monitor_details.interval')}</label>
                                <div className="text-white">
                                    {monitor.interval}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-[#161b22] p-6 rounded-lg border border-gray-800 mt-4">
                        <h3 className="text-gray-400 text-sm font-medium mb-4 uppercase tracking-wider flex items-center gap-2">
                            🔑 {t('monitor_details.keyword_alerts')}
                        </h3>
                        <p className="text-gray-500 text-xs mb-3">{t('monitor_details.keyword_desc')}</p>
                        
                        <div className="space-y-2 mb-3">
                            {monitorKeywords.map((kw, idx) => (
                                <div key={idx} className="flex items-center gap-2 bg-[#0d1117] rounded-lg p-2 border border-gray-800">
                                    <span className="flex-1 text-white text-sm">{kw.text}</span>
                                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase ${
                                        kw.mode === 'disappears' ? 'bg-red-900/30 text-red-400' : 
                                        kw.mode === 'any' ? 'bg-yellow-900/30 text-yellow-400' : 
                                        'bg-green-900/30 text-green-400'
                                    }`}>
                                        {t(`monitor_details.${kw.mode}` as any) || kw.mode}
                                    </span>
                                    <button
                                        onClick={() => handleRemoveKeyword(idx)}
                                        className="text-gray-500 hover:text-red-400 transition-colors"
                                        title="Remove"
                                    >
                                        ×
                                    </button>
                                </div>
                            ))}
                        </div>

                        <button
                            className="w-full py-2 border border-dashed border-gray-700 rounded-lg text-gray-500 hover:text-white hover:border-gray-600 transition-colors text-sm"
                            onClick={handleAddKeyword}
                        >
                            + {t('monitor_details.add_keyword')}
                        </button>
                    </div>
                </div>

                {showGraph && (
                <div className="lg:col-span-2 bg-[#161b22] p-6 rounded-lg border border-gray-800 flex flex-col">
                     <h3 className="text-gray-400 text-sm font-medium mb-4 uppercase tracking-wider">{t('monitor_details.value_history')}</h3>
                     <div className="flex-1 min-h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={history}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
                                <XAxis 
                                    dataKey="date" 
                                    stroke="#8b949e" 
                                    fontSize={12}
                                    tickFormatter={(val) => new Date(val).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} 
                                />
                                <YAxis 
                                    stroke="#8b949e" 
                                    fontSize={12} 
                                    domain={['auto', 'auto']} 
                                    tickFormatter={(val) => val.toLocaleString()}
                                />
                                <Tooltip 
                                    contentStyle={{ backgroundColor: '#161b22', borderColor: '#30363d', color: '#c9d1d9', whiteSpace: 'nowrap' }}
                                    itemStyle={{ color: '#58a6ff' }}
                                    labelStyle={{ color: '#8b949e' }}
                                    formatter={(value?: number) => [(value ?? 0).toLocaleString(), 'Value']}
                                />
                                <Line 
                                    type="monotone" 
                                    dataKey="value" 
                                    stroke="#58a6ff" 
                                    strokeWidth={2}
                                    dot={{ fill: '#58a6ff', r: 4 }}
                                    activeDot={{ r: 6 }}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                     </div>
                </div>
                )}

                <div className="lg:col-span-3 bg-[#161b22] px-6 py-6 rounded-lg border border-gray-800">
                    <div className="flex justify-between items-center mb-6 border-b border-gray-800 pb-4">
                        <h3 className="text-white font-bold text-lg">{t('monitor_details.history_timeline')}</h3>
                        <div className="flex items-center gap-2">
                            <button 
                                onClick={() => setHistoryFilter('all')}
                                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${historyFilter === 'all' ? 'bg-blue-600 text-white border-blue-500' : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700'}`}
                            >
                                {t('monitor_details.all')}
                            </button>
                            <button 
                                onClick={() => setHistoryFilter('changed')}
                                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${historyFilter === 'changed' ? 'bg-yellow-900/50 text-yellow-400 border-yellow-700' : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700'}`}
                            >
                                {t('monitor_details.changed')}
                            </button>
                             <button 
                                onClick={() => setHistoryFilter('unchanged')}
                                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${historyFilter === 'unchanged' ? 'bg-green-900/50 text-green-400 border-green-700' : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700'}`}
                            >
                                {t('monitor_details.unchanged')}
                            </button>
                             <button 
                                onClick={() => setHistoryFilter('error')}
                                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${historyFilter === 'error' ? 'bg-red-900/50 text-red-400 border-red-700' : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700'}`}
                            >
                                {t('monitor_details.error')}
                            </button>
                        </div>
                    </div>

                    <div className="relative">
                        <div className="absolute left-[11px] top-4 bottom-4 w-0.5 bg-gray-700"></div>

                        <div className="space-y-0">
                            {(Array.isArray(monitor.history) ? monitor.history : []).filter(item => {
                                if (historyFilter === 'all') return true;
                                if (historyFilter === 'changed') return item.status === 'changed';
                                if (historyFilter === 'error') return item.status === 'error';
                                if (historyFilter === 'unchanged') return item.status !== 'changed' && item.status !== 'error';
                                return true;
                            }).map((record, i, filteredArr) => {
                                 const date = new Date(record.created_at);
                                 const isError = record.status === 'error';
                                 const isChanged = record.status === 'changed';
                                 
                                 const dotColor = isError ? 'bg-red-500' : isChanged ? 'bg-yellow-500' : 'bg-green-500';
                                 const borderColor = isError ? 'border-l-red-500' : isChanged ? 'border-l-yellow-500' : 'border-l-green-500/50';
                                 const bgHover = isError ? 'hover:bg-red-900/10' : isChanged ? 'hover:bg-yellow-900/10' : 'hover:bg-gray-800/50';
                                 
                                 return (
                                    <div key={record.id || i} id={`history-${record.id}`} className={`relative flex gap-4 py-4 group ${bgHover} rounded-r-md transition-colors`}>
                                        <div className="relative z-10 flex-shrink-0">
                                            <div className={`w-6 h-6 rounded-full ${dotColor} border-4 border-[#161b22] flex items-center justify-center`}>
                                                {isError && <span className="text-[8px] text-white font-bold">!</span>}
                                            </div>
                                        </div>

                                        <div className={`flex-1 min-w-0 bg-[#0d1117] border border-gray-800 border-l-2 ${borderColor} rounded-md p-4`}>
                                            <div className="flex items-center justify-between mb-3">
                                                <div className="flex items-center gap-3">
                                                    <span className={`text-sm font-medium ${isError ? 'text-red-400' : isChanged ? 'text-yellow-400' : 'text-green-400'}`}>
                                                        {isError ? 'Error' : isChanged ? 'Changed' : 'Unchanged'}
                                                    </span>
                                                    <span className="text-xs text-gray-500">
                                                        {date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })} 
                                                        {' '}at{' '}
                                                        {date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </div>
                                                <button 
                                                    onClick={(e) => handleDeleteHistory(record.id, e)}
                                                    className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                                    title="Delete check"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>

                                            {isError ? (
                                                <div className="flex items-start gap-2 text-red-400 text-sm">
                                                    <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                                                    <p>{record.value || "The check encountered an error"}</p>
                                                </div>
                                            ) : (
                                                <div className="text-gray-300">
                                                    {record.ai_summary && (
                                                        <div className="mb-3 p-3 bg-purple-900/20 border border-purple-900/50 rounded-md">
                                                            <div className="flex items-center gap-2 text-purple-400 text-xs font-bold uppercase tracking-wider mb-1">
                                                                <span className="text-lg">🤖</span> AI Summary
                                                            </div>
                                                            <p className="text-sm text-purple-100 italic">
                                                                {record.ai_summary}
                                                            </p>
                                                        </div>
                                                    )}

                                                    {monitor.type === 'visual' ? (
                                                        <div className="space-y-2">
                                                            {record.screenshot_path ? (
                                                                <div className="flex gap-3 overflow-x-auto pb-2">
                                                                    {record.prev_screenshot_path && (
                                                                        <div className="flex-shrink-0">
                                                                            <span className="text-xs text-gray-500 mb-1 block uppercase tracking-wider">Before</span>
                                                                            <div 
                                                                                className="w-40 h-28 bg-gray-900 rounded border border-gray-700 overflow-hidden cursor-pointer hover:border-blue-500 transition-colors"
                                                                                onClick={() => window.open(`${API_BASE}/static/screenshots/${record.prev_screenshot_path!.split('/').pop()}`, '_blank')}
                                                                            >
                                                                                <img src={`${API_BASE}/static/screenshots/${record.prev_screenshot_path.split('/').pop()}`} className="w-full h-full object-cover" />
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                    <div className="flex-shrink-0">
                                                                        <span className="text-xs text-gray-500 mb-1 block uppercase tracking-wider">After</span>
                                                                        <div 
                                                                            className="w-40 h-28 bg-gray-900 rounded border border-gray-700 overflow-hidden cursor-pointer hover:border-blue-500 transition-colors"
                                                                            onClick={() => window.open(`${API_BASE}/static/screenshots/${record.screenshot_path!.split('/').pop()}`, '_blank')}
                                                                        >
                                                                            <img src={`${API_BASE}/static/screenshots/${record.screenshot_path.split('/').pop()}`} className="w-full h-full object-cover" />
                                                                        </div>
                                                                    </div>
                                                                     {record.diff_screenshot_path && (
                                                                        <div className="flex-shrink-0">
                                                                            <span className="text-xs text-gray-500 mb-1 block uppercase tracking-wider">Diff</span>
                                                                            <div 
                                                                                className="w-40 h-28 bg-gray-900 rounded border border-gray-700 overflow-hidden cursor-pointer hover:border-blue-500 transition-colors"
                                                                                onClick={() => window.open(`${API_BASE}/static/screenshots/${record.diff_screenshot_path!.split('/').pop()}`, '_blank')}
                                                                            >
                                                                                <img src={`${API_BASE}/static/screenshots/${record.diff_screenshot_path.split('/').pop()}`} className="w-full h-full object-cover" />
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ) : (
                                                                <span className="text-gray-500 italic text-sm">Visual check OK</span>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <div className="space-y-2">
                                                            <div className="flex items-center justify-between">
                                                                <span className="text-xs text-gray-500 uppercase tracking-wider">Recorded Value</span>
                                                                {isChanged && i < filteredArr.length - 1 && (
                                                                    <button 
                                                                        onClick={() => {
                                                                            const el = document.getElementById(`diff-${record.id}`);
                                                                            if(el) el.classList.toggle('hidden');
                                                                        }}
                                                                        className="text-xs bg-blue-900/30 text-blue-400 px-2 py-1 rounded hover:bg-blue-900/50 transition-colors"
                                                                    >
                                                                        Toggle Diff
                                                                    </button>
                                                                )}
                                                            </div>
                                                            <div className="p-3 bg-gray-900/50 rounded border border-gray-800 font-mono text-xs overflow-x-auto whitespace-pre-wrap max-h-32 overflow-y-auto">
                                                                {cleanValue(record.value || '') || <span className="text-gray-500 italic">No text content</span>}
                                                            </div>
                                                            
                                                            {isChanged && i < filteredArr.length - 1 && (() => {
                                                                // Get older value (next item in array since we're sorted DESC)
                                                                const olderValue = filteredArr[i + 1]?.value || '';
                                                                return (
                                                                <div id={`diff-${record.id}`} className="hidden mt-3">
                                                                    <span className="text-xs text-gray-500 uppercase tracking-wider block mb-2">Change Diff</span>
                                                                    <div className="bg-black rounded border border-gray-700 p-2 text-xs font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
                                                                        {Diff.diffLines(olderValue || '', record.value || '').map((part, idx) => {
                                                                            if (!part.added && !part.removed) return null;
                                                                            return (
                                                                                <span key={idx} className={part.added ? 'bg-green-900/40 text-green-200 block px-1' : 'bg-red-900/40 text-red-200 block px-1'}>
                                                                                    {part.value}
                                                                                </span>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </div>
                                                                );
                                                            })()}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                 );
                            })}
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}

export default MonitorDetails;
