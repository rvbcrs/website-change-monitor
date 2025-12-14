import React, { useEffect, useState } from 'react';
import { Activity, CheckCircle, XCircle, AlertTriangle, Clock, Server, RefreshCw } from 'lucide-react';

function StatusPage() {
    const [monitors, setMonitors] = useState([]);
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState(new Date());

    const fetchStatus = () => {
        setLoading(true);
        fetch('/status')
            .then(res => res.json())
            .then(data => {
                setMonitors(data.data || []);
                setLastUpdated(new Date());
                setLoading(false);
            })
            .catch(err => {
                console.error("Failed to fetch status:", err);
                setLoading(false);
            });
    };

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 60000); // Auto-refresh every minute
        return () => clearInterval(interval);
    }, []);

    const getStatusColor = (monitor) => {
        if (monitor.http_status && monitor.http_status >= 400) return 'text-red-500';
        if (monitor.status === 'error') return 'text-red-500';
        if (monitor.status === 'changed') return 'text-blue-400';
        return 'text-green-500';
    };

    const getStatusIcon = (monitor) => {
        if (monitor.http_status && monitor.http_status >= 400) return <XCircle className="w-5 h-5 text-red-500" />;
        if (monitor.status === 'error') return <AlertTriangle className="w-5 h-5 text-red-500" />;
        if (monitor.status === 'changed') return <Activity className="w-5 h-5 text-blue-400" />;
        return <CheckCircle className="w-5 h-5 text-green-500" />;
    };

    const getStatusText = (monitor) => {
        if (monitor.http_status && monitor.http_status >= 400) return `Down (HTTP ${monitor.http_status})`;
        if (monitor.status === 'error') return 'Error';
        if (monitor.status === 'changed') return 'Change Detected';
        return 'Operational';
    };

    const overallStatus = monitors.every(m => !m.http_status || m.http_status < 400) 
        ? 'All Systems Operational' 
        : 'Partial System Outage';
    
    const overallColor = monitors.every(m => !m.http_status || m.http_status < 400)
        ? 'bg-green-500'
        : 'bg-orange-500';

    return (
        <div className="min-h-screen bg-[#0d1117] text-gray-300 font-sans selection:bg-green-500/30">
            {/* Header */}
            <header className="bg-[#161b22] border-b border-gray-800 py-6 px-4 shadow-sm">
                <div className="max-w-4xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Server className="w-8 h-8 text-green-500" />
                        <h1 className="text-2xl font-bold text-white tracking-tight">System Status</h1>
                    </div>
                    <div className="text-sm text-gray-400 flex items-center gap-2">
                        <span>Last updated: {lastUpdated.toLocaleTimeString()}</span>
                        <button onClick={fetchStatus} className="p-1 hover:text-white transition-colors">
                            <RefreshCw size={14} />
                        </button>
                    </div>
                </div>
            </header>

            <main className="max-w-4xl mx-auto px-4 py-8">
                {/* Overall Status Banner */}
                <div className={`${overallColor} text-white p-4 rounded-lg shadow-lg mb-8 flex items-center justify-center font-medium`}>
                    {overallStatus}
                </div>

                {/* Monitor List */}
                <div className="space-y-4">
                    {loading && monitors.length === 0 ? (
                        <div className="text-center py-10 text-gray-500">Loading status...</div>
                    ) : (
                        monitors.map(monitor => (
                            <div key={monitor.id} className="bg-[#161b22] border border-gray-800 rounded-lg p-4 flex items-center justify-between hover:border-gray-700 transition-all">
                                <div>
                                    <h3 className="text-white font-medium text-lg">{monitor.name}</h3>
                                    <div className="text-xs text-gray-500 mt-1 flex items-center gap-2">
                                        <Clock size={12} />
                                        <span>Last checked: {monitor.last_check ? new Date(monitor.last_check).toLocaleString() : 'Never'}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className={`text-sm font-medium ${getStatusColor(monitor)}`}>
                                        {getStatusText(monitor)}
                                    </span>
                                    {getStatusIcon(monitor)}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </main>

            <footer className="max-w-4xl mx-auto px-4 py-8 text-center text-sm text-gray-600 border-t border-gray-800 mt-8">
                Powered by <span className="text-gray-500 font-semibold">DeltaWatch</span>
            </footer>
        </div>
    );
}

export default StatusPage;
