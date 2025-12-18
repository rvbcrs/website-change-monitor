import { useState, useEffect, useMemo } from 'react';
import { cleanValue } from '@deltawatch/shared';
import LanguageSwitcher from './components/LanguageSwitcher';
import { useAuth } from './contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { X, Clock, AlertTriangle, CheckCircle, Wifi, Monitor } from 'lucide-react';
import { LineChart, Line, YAxis, ResponsiveContainer, LabelList } from 'recharts';
import { useTranslation } from 'react-i18next';

interface HistoryItem {
    id: number;
    http_status?: number;
    status?: string;
    value?: string;
    created_at: string;
}

interface KioskMonitor {
    id: number;
    name: string;
    url: string;
    type: 'text' | 'visual';
    active: boolean;
    last_check?: string;
    last_value?: string;
    last_screenshot?: string;
    selector_text?: string;
    history?: HistoryItem[];
}

const CustomLabel = (props: any) => {
    const { x, y, value, index, dataLength } = props;
    if (index === 0 || index === dataLength - 1) {
        return (
            <text x={x} y={y} dy={-10} fill="#ffffff" fontSize={10} textAnchor="middle" fontWeight="bold">
                {value}
            </text>
        );
    }
    return null;
};

const KioskChart = ({ history }: { history?: HistoryItem[], isUp: boolean }) => {
    const graphData = useMemo(() => {
        if (!history) return [];
        return history.map(h => {
            if (h.status === 'error') return null;
            let valStr = h.value || "";
            if (valStr.length > 50) return null;
            
            // Minimal heuristic to detect numeric content
            const numericChars = (valStr.match(/[0-9.,€$£¥%]/g) || []).length;
            if (numericChars < valStr.replace(/\s/g, '').length * 0.5) return null;
            
            if (valStr.includes(',') && (!valStr.includes('.') || valStr.indexOf(',') > valStr.lastIndexOf('.'))) {
                valStr = valStr.replace(/\./g, '').replace(',', '.');
            } else {
                valStr = valStr.replace(/,/g, '');
            }
            const val = parseFloat(valStr.replace(/[^0-9.-]+/g,""));
            return {
                timestamp: new Date(h.created_at).getTime(),
                value: isNaN(val) ? null : val
            };
        }).filter((item): item is {timestamp: number, value: number} => item !== null && item.value !== null).reverse();
    }, [history]);

    const showChart = graphData.length >= 2;

    if (!showChart) return null;

    return (
        <div className="absolute inset-0 opacity-30 pointer-events-none">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={graphData} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                    <YAxis domain={['auto', 'auto']} hide />
                    <Line 
                        type="monotone" 
                        dataKey="value" 
                        stroke="#a855f7" 
                        strokeWidth={4}
                        dot={false}
                    >
                        <LabelList content={<CustomLabel dataLength={graphData.length} />} />
                    </Line>
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
};

export default function KioskMode() {
    const { t } = useTranslation();
    const [monitors, setMonitors] = useState<KioskMonitor[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [time, setTime] = useState(new Date());
    const [progress, setProgress] = useState(0);
    const { authFetch } = useAuth();
    const navigate = useNavigate();
    const API_BASE = '';
    
    // Configuration
    const ROTATION_INTERVAL = 15000; // 15 seconds per slide
    const REFRESH_INTERVAL = 100; // Update progress bar every 100ms

    useEffect(() => {
        fetchMonitors();
        // Clock
        const clockInterval = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(clockInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (monitors.length === 0) return;

        // Reset progress when index changes
        setProgress(0);
        
        const startTime = Date.now();
        const timer = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const newProgress = Math.min((elapsed / ROTATION_INTERVAL) * 100, 100);
            setProgress(newProgress);

            if (elapsed >= ROTATION_INTERVAL) {
                nextSlide();
            }
        }, REFRESH_INTERVAL);

        return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentIndex, monitors]);

    const fetchMonitors = async () => {
        try {
            const res = await authFetch(`${API_BASE}/monitors`);
            const data = await res.json();
            if (data.message === 'success') {
                // Only show active monitors
                const active = data.data.filter((m: KioskMonitor) => m.active);
                setMonitors(active);
            }
        } catch (e) {
            console.error("Failed to fetch monitors", e);
        } finally {
            setLoading(false);
        }
    };

    const nextSlide = () => {
        setCurrentIndex(prev => (prev + 1) % monitors.length);
    };

    if (loading) return <div className="min-h-screen bg-black text-white flex items-center justify-center">Loading Kiosk...</div>;
    if (monitors.length === 0) return (
        <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-4">
            <h1 className="text-2xl font-bold">No Active Deltas</h1>
            <button onClick={() => navigate('/')} className="px-4 py-2 bg-blue-600 rounded">Go Back</button>
        </div>
    );

    const currentMonitor = monitors[currentIndex];
    const isUp = currentMonitor.history && currentMonitor.history.length > 0 
        ? (currentMonitor.history[0].http_status ?? 0) < 400 
        : true; // Default to true if no history
    
    // Calculate global stats
    const errorCount = monitors.filter(m => {
        if (!m.history || m.history.length === 0) return false;
        return (m.history[0].http_status ?? 0) >= 400 || m.history[0].status === 'error';
    }).length;

    return (
        <div className="fixed inset-0 bg-[#0d1117] text-white flex flex-col overflow-hidden z-50">
            {/* Header */}
            <header className="h-16 bg-[#161b22] border-b border-gray-800 flex items-center justify-between px-6 shadow-lg z-20">
                <div className="flex items-center gap-4">
                    <img src="/logo_128.png" alt="Logo" className="w-8 h-8" />
                    <h1 className="text-xl font-bold tracking-tight">DeltaWatch Kiosk</h1>
                    
                    <div className="h-6 w-px bg-gray-700 mx-2"></div>
                    
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                        {errorCount === 0 ? (
                            <span className="flex items-center gap-2 text-green-400 font-medium">
                                <CheckCircle size={16} /> All Systems Operational
                            </span>
                        ) : (
                            <span className="flex items-center gap-2 text-red-400 font-bold animate-pulse">
                                <AlertTriangle size={16} /> {errorCount} System Issue{errorCount > 1 ? 's' : ''}
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-6">
                    <LanguageSwitcher />
                    <div className="flex items-center gap-2 text-gray-400 font-mono text-lg">
                        <Clock size={16} />
                        {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <button 
                        onClick={() => navigate('/')}
                        className="p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-white transition-colors"
                        title="Exit Kiosk"
                    >
                        <X size={24} />
                    </button>
                </div>
            </header>

            {/* Main Content */}
            <main className="flex-1 relative flex">
                {/* Current Slide */}
                <div className="flex-1 p-8 flex flex-col items-center justify-center relative bg-gradient-to-br from-[#0d1117] to-[#161b22]">
                    
                    {currentMonitor.type === 'visual' ? (
                         currentMonitor.last_screenshot ? (
                            <div className="relative w-full h-full max-h-[80vh] flex items-center justify-center rounded-xl overflow-hidden shadow-2xl border border-gray-800 bg-black group">
                                <img 
                                    src={`${API_BASE}/static/screenshots/${currentMonitor.last_screenshot.split('/').pop()}`} 
                                    alt={currentMonitor.name} 
                                    className="object-contain w-full h-full z-10 relative"
                                />
                                <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-md px-4 py-2 rounded-lg border border-white/10 text-white font-mono text-sm z-20">
                                    {currentMonitor.last_check ? t('kiosk.last_check', { time: new Date(currentMonitor.last_check).toLocaleTimeString() }) : t('kiosk.never')}
                                </div>
                                <div className={`absolute -right-20 -bottom-20 w-[600px] h-[600px] rounded-full blur-3xl transition-colors opacity-30 ${isUp ? "bg-green-500" : "bg-red-500"}`}></div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center text-gray-500 gap-4">
                                <Monitor size={64} className="opacity-20" />
                                <p className="text-xl">{t('kiosk.waiting_visual')}</p>
                            </div>
                        )
                    ) : (
                        <div className="w-full max-w-4xl bg-[#161b22] rounded-2xl border border-gray-700 p-12 shadow-2xl flex flex-col items-center text-center gap-8 relative overflow-hidden">
                            <div className={`p-6 rounded-full ${isUp ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'} z-10 relative`}>
                                <Wifi size={64} />
                            </div>
                            <div className="z-10 relative">
                                <h1 className="text-4xl font-bold text-white mb-2">{currentMonitor.name}</h1>
                                <p className="text-gray-400 text-xl font-mono max-w-2xl truncate mx-auto" title={currentMonitor.url}>{currentMonitor.url}</p>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-8 w-full mt-8 z-10 relative">
                                <div className="bg-[#0d1117] p-6 rounded-xl border border-gray-800 flex flex-col justify-center">
                                    <div className="text-gray-500 text-sm uppercase tracking-wider mb-2">{t('kiosk.status')}</div>
                                    <div className={`text-3xl font-bold ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                                        {isUp ? t('status.online') : t('status.down')}
                                    </div>
                                </div>
                                <div className="bg-[#0d1117] p-6 rounded-xl border border-gray-800 flex flex-col justify-center relative overlow-hidden">
                                     <div className="text-gray-500 text-sm uppercase tracking-wider mb-2 z-10 relative">{t('kiosk.last_value')}</div>
                                     <div className="text-xl text-white font-mono break-all line-clamp-2 z-10 relative">
                                         {cleanValue(currentMonitor.last_value || "—")}
                                     </div>
                                     <KioskChart history={currentMonitor.history} isUp={isUp} />
                                </div>
                            </div>
                            
                            {currentMonitor.selector_text && (
                                <div className="text-gray-500 text-sm mt-4 z-10 relative">
                                    {t('kiosk.tracking')}: <span className="font-mono text-gray-300">{cleanValue(currentMonitor.selector_text)}</span>
                                </div>
                            )}
                            <div className={`absolute -right-20 -bottom-20 w-[600px] h-[600px] rounded-full blur-3xl transition-colors opacity-20 pointer-events-none ${isUp ? "bg-green-500" : "bg-red-500"}`}></div>
                        </div>
                    )}
                </div>
            </main>

            {/* Footer / Progress */}
            <footer className="h-20 bg-[#161b22] border-t border-gray-800 flex items-center px-8 relative overflow-hidden">
                <div className="absolute top-0 left-0 h-1 bg-blue-600 transition-all duration-100 ease-linear shadow-[0_0_10px_rgba(37,99,235,0.5)]" style={{ width: `${progress}%` }}></div>
                
                <div className="flex-1 flex items-center gap-4">
                   <div className={`w-3 h-3 rounded-full ${isUp ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500 animate-pulse'}`}></div>
                   <div>
                        <h2 className="text-xl font-bold text-white">{currentMonitor.name || 'Untitled Delta'}</h2>
                        <div className="text-sm text-gray-400 flex items-center gap-2">
                           {currentMonitor.type === 'visual' ? 'Visual Monitor' : 'Text Monitor'} • {currentMonitor.active ? 'Active' : 'Paused'}
                        </div>
                   </div>
                </div>

                <div className="flex items-center gap-2">
                    <div className="text-right mr-4">
                        <div className="text-2xl font-bold text-gray-200">{currentIndex + 1} <span className="text-gray-600">/</span> {monitors.length}</div>
                    </div>
                </div>
            </footer>
        </div>
    );
}
