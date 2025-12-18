import { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Activity, CheckCircle, AlertTriangle, TrendingUp } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from 'react-i18next';

interface Stats {
    total_monitors: number;
    active_monitors: number;
    checks_24h: number;
    errors_24h: number;
}

export interface StatsOverviewRef {
    refresh: () => void;
}

const StatsOverview = forwardRef<StatsOverviewRef>(function StatsOverview(_props, ref) {
    const { t } = useTranslation();
    const [stats, setStats] = useState<Stats | null>(null);
    const [loading, setLoading] = useState(true);
    const { authFetch } = useAuth();

    const API_BASE = '';

    const [error, setError] = useState<string | null>(null);

    const fetchStats = async () => {
        try {
            const res = await authFetch(`${API_BASE}/api/stats`);
            if (res.ok) {
                const data = await res.json();
                setStats(data.data);
                setError(null);
            } else {
                // Read text if possible
                const text = await res.text().catch(() => 'No response body');
                setError(`Server Error: ${res.status} ${res.statusText} - ${text}`);
            }
        } catch (e) {
            console.error("Failed to fetch stats", e);
            setError(`Network/Client Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStats();
        const interval = setInterval(fetchStats, 30000); // Update every 30 seconds
        return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Expose refresh function to parent
    useImperativeHandle(ref, () => ({
        refresh: fetchStats
    }));

    if (loading) return <div className="animate-pulse h-24 bg-[#161b22] rounded-lg mb-6 border border-gray-800"></div>;
    
    // Debug output
    if (!stats && !error) return (
        <div className="text-white bg-gray-800 p-4 mb-4 rounded">
            Debug: No stats, No Error. Loading: {loading.toString()}
            <button onClick={fetchStats} className="ml-4 bg-blue-500 px-2 py-1 rounded">Retry</button>
        </div>
    );

    if (error) return (
        <div className="bg-[#161b22] border border-red-900/50 p-4 rounded-lg mb-6 text-red-400 text-sm flex items-center justify-between">
           <span>Could not load analytics. Server restart might be required. Debug: {error}</span>
           <button onClick={fetchStats} className="text-xs bg-red-900/30 px-2 py-1 rounded hover:bg-red-900/50">Retry</button>
        </div>
    );

    if (!stats) return null;

    // Calculate rates
    const successRate = stats.checks_24h > 0 
        ? Math.round(((stats.checks_24h - stats.errors_24h) / stats.checks_24h) * 100) 
        : 100;

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {/* Total Monitors */}
            <div className="bg-[#161b22] p-4 rounded-lg border border-gray-800 flex flex-col justify-between h-24 relative overflow-hidden group">
                <div className="flex justify-between items-start z-10 relative">
                    <div className="text-gray-400 text-xs uppercase font-bold tracking-wider">{t('stats.deltas')}</div>
                    <Activity size={16} className="text-blue-500 opacity-75" />
                </div>
                <div className="flex items-end gap-2 z-10 relative">
                    <div className="text-2xl font-bold text-white">{stats.active_monitors}</div>
                    <div className="text-xs text-gray-500 mb-1">/ {stats.total_monitors} {t('stats.active')}</div>
                </div>
                <div className="absolute -right-4 -bottom-4 bg-blue-500/10 w-24 h-24 rounded-full blur-xl group-hover:bg-blue-500/20 transition-colors"></div>
            </div>

            {/* 24h Checks */}
            <div className="bg-[#161b22] p-4 rounded-lg border border-gray-800 flex flex-col justify-between h-24 relative overflow-hidden group">
                <div className="flex justify-between items-start z-10 relative">
                    <div className="text-gray-400 text-xs uppercase font-bold tracking-wider">{t('stats.checks_24h')}</div>
                    <TrendingUp size={16} className="text-purple-500 opacity-75" />
                </div>
                <div className="flex items-end gap-2 z-10 relative">
                    <div className="text-2xl font-bold text-white">{stats.checks_24h.toLocaleString()}</div>
                </div>
                <div className="absolute -right-4 -bottom-4 bg-purple-500/10 w-24 h-24 rounded-full blur-xl group-hover:bg-purple-500/20 transition-colors"></div>
            </div>

            {/* Success Rate */}
            <div className="bg-[#161b22] p-4 rounded-lg border border-gray-800 flex flex-col justify-between h-24 relative overflow-hidden group">
                <div className="flex justify-between items-start z-10 relative">
                    <div className="text-gray-400 text-xs uppercase font-bold tracking-wider">{t('stats.health')}</div>
                    <CheckCircle size={16} className={successRate >= 98 ? "text-green-500 opacity-75" : "text-yellow-500 opacity-75"} />
                </div>
                <div className="flex items-end gap-2 z-10 relative">
                    <div className={`text-2xl font-bold ${successRate >= 98 ? "text-green-400" : "text-yellow-400"}`}>{successRate}%</div>
                    <div className="text-xs text-gray-500 mb-1">{t('stats.success_ratio')}</div>
                </div>
                <div className={`absolute -right-4 -bottom-4 w-24 h-24 rounded-full blur-xl transition-colors ${successRate >= 98 ? "bg-green-500/10 group-hover:bg-green-500/20" : "bg-yellow-500/10 group-hover:bg-yellow-500/20"}`}></div>
            </div>

            {/* Errors */}
            <div className={`p-4 rounded-lg border flex flex-col justify-between h-24 relative overflow-hidden group transition-all duration-300 ${
                stats.errors_24h > 0 
                ? "bg-[#161b22] border-red-500/50 shadow-[0_0_20px_rgba(239,68,68,0.2)]" 
                : "bg-[#161b22] border-gray-800"
            }`}>
                <div className="flex justify-between items-start z-10 relative">
                    <div className="text-gray-400 text-xs uppercase font-bold tracking-wider">{t('stats.errors_24h')}</div>
                    <AlertTriangle size={16} className={stats.errors_24h === 0 ? "text-gray-600" : "text-red-500 opacity-75"} />
                </div>
                <div className="flex items-end gap-2 z-10 relative">
                    <div className={`text-2xl font-bold ${stats.errors_24h === 0 ? "text-gray-400" : "text-red-400"}`}>{stats.errors_24h}</div>
                </div>
                 <div className={`absolute -right-4 -bottom-4 w-24 h-24 rounded-full blur-xl transition-colors ${stats.errors_24h === 0 ? "bg-gray-500/5" : "bg-red-500/10 group-hover:bg-red-500/20"}`}></div>
            </div>
        </div>
    );
});

export default StatsOverview;
