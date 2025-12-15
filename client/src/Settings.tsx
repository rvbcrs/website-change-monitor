import { useState, useEffect, type ChangeEvent } from 'react';
import { Save, Bell, Mail, Smartphone, Globe, ArrowLeft, Download, Upload, Eye, EyeOff, Brain, Shield, Search } from 'lucide-react';
import { useToast } from './contexts/ToastContext';
import { useNavigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext';

interface SettingsData {
    email_enabled: boolean;
    email_host: string;
    email_port: number;
    email_secure: boolean;
    email_user: string;
    email_pass: string;
    email_to: string;
    email_from: string;
    push_enabled: boolean;
    push_type: 'pushover' | 'telegram';
    push_key1: string;
    push_key2: string;
    ai_enabled: boolean;
    ai_provider: 'openai' | 'ollama';
    ai_api_key: string;
    ai_model: string;
    ai_base_url: string;
    proxy_enabled: boolean;
    proxy_server: string;
    proxy_auth: string;
    webhook_enabled: boolean;
    webhook_url: string;
}

function Settings() {
    const API_BASE = '';
    const navigate = useNavigate();
    const { showToast } = useToast();
    const { authFetch } = useAuth();

    const [settings, setSettings] = useState<SettingsData>({
        email_enabled: false,
        email_host: '',
        email_port: 587,
        email_secure: false,
        email_user: '',
        email_pass: '',
        email_to: '',
        email_from: '',
        push_enabled: false,
        push_type: 'pushover',
        push_key1: '',
        push_key2: '',
        ai_enabled: false,
        ai_provider: 'openai',
        ai_api_key: '',
        ai_model: 'gpt-4o-mini',
        ai_base_url: '',
        proxy_enabled: false,
        proxy_server: '',
        proxy_auth: '',
        webhook_enabled: false,
        webhook_url: ''
    });

    const [showPassword, setShowPassword] = useState(false);
    const [fetchedModels, setFetchedModels] = useState<string[]>([]);
    const [fetchingModels, setFetchingModels] = useState(false);

    useEffect(() => {
        authFetch(`${API_BASE}/settings`)
            .then(res => res.json())
            .then(data => {
                if (data.message === 'success' && data.data) {
                    setSettings({
                        ...data.data,
                        email_enabled: !!data.data.email_enabled,
                        email_secure: !!data.data.email_secure,
                        push_enabled: !!data.data.push_enabled,
                        ai_enabled: !!data.data.ai_enabled,
                        ai_provider: data.data.ai_provider || 'openai',
                        proxy_enabled: !!data.data.proxy_enabled,
                        webhook_enabled: !!data.data.webhook_enabled,
                    });
                }
            })
            .catch(err => console.error(err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const target = e.target as HTMLInputElement;
        const { name, value, type } = target;
        const checked = 'checked' in target ? target.checked : false;
        setSettings(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleSave = async () => {
        try {
            const res = await authFetch(`${API_BASE}/settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });
            if (res.ok) {
                showToast('Settings saved successfully', 'success');
            } else {
                showToast('Failed to save settings', 'error');
            }
        } catch (e) {
            console.error(e);
            showToast('Error saving settings', 'error');
        }
    };
    
    const handleTest = async (type: string) => {
        try {
             await authFetch(`${API_BASE}/settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });
            
            const res = await authFetch(`${API_BASE}/test-notification`, { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type })
            });
            const data = await res.json();
            if (data.message === 'success') {
                showToast(`Test ${type ? type : 'notification'} sent! Check your device.`, 'success');
            } else {
                showToast('Test functionality failed: ' + (data.error || 'Unknown error'), 'error');
            }
        } catch (e) {
            console.error(e);
            showToast('Error: ' + (e instanceof Error ? e.message : 'Unknown error'), 'error');
        }
    };

    const handleFetchModels = async () => {
        setFetchingModels(true);
        try {
            const res = await authFetch(`${API_BASE}/api/models`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: settings.ai_provider,
                    apiKey: settings.ai_api_key,
                    baseUrl: settings.ai_base_url
                })
            });
            const data = await res.json();
            if (res.ok) {
                setFetchedModels(data.data);
                showToast(`Found ${data.data.length} models`, 'success');
            } else {
                showToast('Error fetching models: ' + data.error, 'error');
            }
        } catch (e) {
            console.error(e);
            showToast('Network error fetching models', 'error');
        } finally {
            setFetchingModels(false);
        }
    };

    const handleExport = async () => {
        try {
            const res = await authFetch(`${API_BASE}/data/export`);
            if (res.ok) {
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `monitors-export-${new Date().toISOString().split('T')[0]}.json`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
            } else {
                showToast('Export failed', 'error');
            }
        } catch (e) {
            console.error(e);
            showToast('Export error', 'error');
        }
    }

    const handleImport = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const json = JSON.parse(event.target?.result as string);
                const res = await authFetch(`${API_BASE}/data/import`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(json)
                });
                const data = await res.json();
                if (data.message === 'success') {
                    showToast(`Imported ${data.imported} monitors. Skipped/Failed: ${data.errors}`, 'success');
                } else {
                    showToast(data.error || 'Import failed', 'error');
                }
            } catch (err) {
                console.error(err);
                showToast('Invalid JSON file or upload error', 'error');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    return (
        <div className="flex h-full w-full bg-[#0d1117] flex-col text-white">
            <header className="bg-[#161b22] p-4 shadow-md flex items-center justify-between z-10 sticky top-0 border-b border-gray-800">
                <div className="flex items-center space-x-4 w-full max-w-6xl mx-auto">
                    <button onClick={() => navigate('/')} className="text-gray-400 hover:text-white transition-colors">
                        <ArrowLeft />
                    </button>
                    <h1 className="text-xl font-bold text-white shadow-sm flex items-center gap-2">
                        <Bell size={20} /> Notification Settings
                    </h1>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-8">
                <div className="max-w-3xl mx-auto space-y-8">
                    
                    {/* Email Settings */}
                    <div className="bg-[#161b22] p-6 rounded-lg border border-gray-800 shadow-lg">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-white">Email Notifications</h2>
                            <label className="relative inline-flex items-center cursor-pointer">
                              <input type="checkbox" name="email_enabled" checked={settings.email_enabled} onChange={handleChange} className="sr-only peer" />
                              <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                            </label>
                        </div>
                        
                        {settings.email_enabled && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">SMTP Host</label>
                                    <input type="text" name="email_host" value={settings.email_host} onChange={handleChange} className="w-full bg-[#0d1117] border border-gray-700 rounded p-2 text-white focus:border-blue-500 focus:outline-none" placeholder="smtp.gmail.com" />
                                </div>
                                <div className="flex gap-4">
                                    <div className="flex-1">
                                        <label className="block text-sm font-medium text-gray-400 mb-1">Port</label>
                                        <input type="number" name="email_port" value={settings.email_port} onChange={handleChange} className="w-full bg-[#0d1117] border border-gray-700 rounded p-2 text-white focus:border-blue-500 focus:outline-none" placeholder="587" />
                                    </div>
                                    <div className="flex items-center pt-6">
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input type="checkbox" name="email_secure" checked={settings.email_secure} onChange={handleChange} className="form-checkbox h-4 w-4 text-blue-500 bg-[#0d1117] border-gray-700 rounded" />
                                            <span className="text-sm text-gray-400">Secure (SSL/TLS)</span>
                                        </label>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">Username</label>
                                    <input type="text" name="email_user" value={settings.email_user} onChange={handleChange} className="w-full bg-[#0d1117] border border-gray-700 rounded p-2 text-white focus:border-blue-500 focus:outline-none" placeholder="user@example.com" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">Password</label>
                                    <div className="relative">
                                        <input 
                                            type={showPassword ? 'text' : 'password'} 
                                            name="email_pass" 
                                            value={settings.email_pass} 
                                            onChange={handleChange} 
                                            className="w-full bg-[#0d1117] border border-gray-700 rounded p-2 text-white focus:border-blue-500 focus:outline-none pr-10" 
                                            placeholder="App Password" 
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-white"
                                        >
                                            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-gray-400 mb-1">Send to Email</label>
                                    <input type="email" name="email_to" value={settings.email_to} onChange={handleChange} className="w-full bg-[#0d1117] border border-gray-700 rounded p-2 text-white focus:border-blue-500 focus:outline-none" placeholder="recipient@example.com" />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-gray-400 mb-1">From Address (Optional)</label>
                                    <input type="email" name="email_from" value={settings.email_from} onChange={handleChange} className="w-full bg-[#0d1117] border border-gray-700 rounded p-2 text-white focus:border-blue-500 focus:outline-none" placeholder="no-reply@deltawatch.com" />
                                    <p className="text-xs text-gray-500 mt-1">Leave empty to use the SMTP username as sender.</p>
                                </div>
                                <div className="md:col-span-2">
                                   <button 
                                        onClick={() => handleTest('email')}
                                        className="bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 px-4 py-2 rounded text-sm font-medium transition-colors border border-blue-600/30 hover:border-blue-600/50 flex items-center gap-2 w-full justify-center"
                                    >
                                        <Mail size={16} /> Test Email
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Push Settings */}
                    <div className="bg-[#161b22] p-6 rounded-lg border border-gray-800 shadow-lg">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-white">Smartphone Notifications</h2>
                            <label className="relative inline-flex items-center cursor-pointer">
                              <input type="checkbox" name="push_enabled" checked={settings.push_enabled} onChange={handleChange} className="sr-only peer" />
                              <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                            </label>
                        </div>
                        
                        {settings.push_enabled && (
                            <div className="grid grid-cols-1 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">Service Provider</label>
                                    <div className="flex gap-4">
                                        <label className="flex items-center gap-2 cursor-pointer bg-[#0d1117] px-4 py-2 rounded border border-gray-700 flex-1 hover:border-gray-600">
                                            <input type="radio" name="push_type" value="pushover" checked={settings.push_type === 'pushover'} onChange={handleChange} className="text-blue-500 bg-[#0d1117] border-gray-700" />
                                            <span className="text-white">Pushover</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer bg-[#0d1117] px-4 py-2 rounded border border-gray-700 flex-1 hover:border-gray-600">
                                            <input type="radio" name="push_type" value="telegram" checked={settings.push_type === 'telegram'} onChange={handleChange} className="text-blue-500 bg-[#0d1117] border-gray-700" />
                                            <span className="text-white">Telegram</span>
                                        </label>
                                    </div>
                                </div>
                                
                                {settings.push_type === 'pushover' ? (
                                    <>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-400 mb-1">Application Token</label>
                                            <input type="text" name="push_key1" value={settings.push_key1} onChange={handleChange} className="w-full bg-[#0d1117] border border-gray-700 rounded p-2 text-white focus:border-blue-500 focus:outline-none" placeholder="Pushover App Token" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-400 mb-1">User Key</label>
                                            <input type="text" name="push_key2" value={settings.push_key2} onChange={handleChange} className="w-full bg-[#0d1117] border border-gray-700 rounded p-2 text-white focus:border-blue-500 focus:outline-none" placeholder="Pushover User Key" />
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-400 mb-1">Bot Token</label>
                                            <input type="text" name="push_key1" value={settings.push_key1} onChange={handleChange} className="w-full bg-[#0d1117] border border-gray-700 rounded p-2 text-white focus:border-blue-500 focus:outline-none" placeholder="Telegram Bot Token" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-400 mb-1">Chat ID</label>
                                            <input type="text" name="push_key2" value={settings.push_key2} onChange={handleChange} className="w-full bg-[#0d1117] border border-gray-700 rounded p-2 text-white focus:border-blue-500 focus:outline-none" placeholder="Telegram Chat ID" />
                                        </div>
                                    </>
                                )}
                                <div>
                                    <button 
                                        onClick={() => handleTest('push')}
                                        className="bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 px-4 py-2 rounded text-sm font-medium transition-colors border border-blue-600/30 hover:border-blue-600/50 flex items-center gap-2 w-full justify-center"
                                    >
                                        <Smartphone size={16} /> Test {settings.push_type === 'pushover' ? 'Pushover' : 'Telegram'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Webhook Settings */}
                    <div className="bg-[#161b22] p-6 rounded-lg border border-gray-800 shadow-lg">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-white flex items-center gap-2"><Globe size={20} className="text-green-400" /> Home Assistant / Webhook</h2>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" name="webhook_enabled" checked={settings.webhook_enabled} onChange={handleChange} className="sr-only peer" />
                                <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-green-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                            </label>
                        </div>
                        {settings.webhook_enabled && (
                            <div className="grid grid-cols-1 gap-4">
                                <div className="p-3 bg-green-900/20 border border-green-900/50 rounded text-green-200 text-sm">
                                    <p>We will send a POST request with JSON payload to this URL when a change is detected. Compatible with Home Assistant Webhook Triggers.</p>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">Webhook URL</label>
                                    <input type="text" name="webhook_url" value={settings.webhook_url} onChange={handleChange} className="w-full bg-[#0d1117] border border-gray-700 rounded p-2 text-white focus:border-green-500 focus:outline-none" placeholder="https://..." />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* AI Settings */}
                    <div className="bg-[#161b22] p-6 rounded-lg border border-gray-800 shadow-lg">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-white flex items-center gap-2"><Brain size={20} className="text-purple-400" /> AI Analysis</h2>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" name="ai_enabled" checked={settings.ai_enabled} onChange={handleChange} className="sr-only peer" />
                                <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-purple-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                            </label>
                        </div>
                        {settings.ai_enabled && (
                            <div className="grid grid-cols-1 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">Provider</label>
                                    <select name="ai_provider" value={settings.ai_provider} onChange={handleChange} className="w-full bg-[#0d1117] border border-gray-700 rounded p-2 text-white focus:border-purple-500 focus:outline-none">
                                        <option value="openai">OpenAI (ChatGPT)</option>
                                        <option value="ollama">Ollama (Local)</option>
                                    </select>
                                </div>
                                {settings.ai_provider === 'openai' && (
                                    <div>
                                        <label className="block text-sm font-medium text-gray-400 mb-1">API Key</label>
                                        <input type="text" name="ai_api_key" value={settings.ai_api_key} onChange={handleChange} className="w-full bg-[#0d1117] border border-gray-700 rounded p-2 text-white focus:border-purple-500 focus:outline-none" placeholder="sk-..." />
                                        <p className="text-xs text-gray-500 mt-1">Found in your <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="text-purple-400 hover:underline">OpenAI Dashboard</a>.</p>
                                    </div>
                                )}
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">Model</label>
                                    <div className="flex gap-2">
                                        <div className="flex-1 relative">
                                            <input 
                                                type="text" 
                                                name="ai_model" 
                                                value={settings.ai_model} 
                                                onChange={handleChange} 
                                                list="model-options"
                                                className="w-full bg-[#0d1117] border border-gray-700 rounded p-2 text-white focus:border-purple-500 focus:outline-none" 
                                                placeholder={settings.ai_provider === 'openai' ? 'gpt-4o-mini' : 'llama3'} 
                                            />
                                            <datalist id="model-options">
                                                {fetchedModels.map(m => <option key={m} value={m} />)}
                                            </datalist>
                                        </div>
                                        <button 
                                            onClick={handleFetchModels}
                                            disabled={fetchingModels}
                                            className="bg-purple-900/30 text-purple-400 px-3 rounded border border-purple-900 hover:bg-purple-900/50 transition-colors disabled:opacity-50"
                                            title="Fetch available models"
                                        >
                                            <Search size={18} className={fetchingModels ? 'animate-spin' : ''} />
                                        </button>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">
                                        {settings.ai_provider === 'openai' 
                                            ? "Examples: gpt-4o-mini, gpt-4o, gpt-3.5-turbo" 
                                            : "Example: llama3, mistral, llama2:13b"}
                                    </p>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">Base URL (Optional)</label>
                                    <input type="text" name="ai_base_url" value={settings.ai_base_url} onChange={handleChange} className="w-full bg-[#0d1117] border border-gray-700 rounded p-2 text-white focus:border-purple-500 focus:outline-none" placeholder={settings.ai_provider === 'ollama' ? 'http://localhost:11434/v1' : 'https://api.openai.com/v1'} />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Proxy Settings */}
                    <div className="bg-[#161b22] p-6 rounded-lg border border-gray-800 shadow-lg">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-white flex items-center gap-2"><Shield size={20} className="text-orange-400" /> Proxy & Stealth</h2>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" name="proxy_enabled" checked={settings.proxy_enabled} onChange={handleChange} className="sr-only peer" />
                                <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-orange-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-600"></div>
                            </label>
                        </div>
                        {settings.proxy_enabled && (
                            <div className="grid grid-cols-1 gap-4">
                                <div className="p-3 bg-orange-900/20 border border-orange-900/50 rounded text-orange-200 text-sm">
                                    <p>Stealth mode is automatically enabled when using a proxy to reduce detection.</p>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">Proxy Server</label>
                                    <input type="text" name="proxy_server" value={settings.proxy_server} onChange={handleChange} className="w-full bg-[#0d1117] border border-gray-700 rounded p-2 text-white focus:border-orange-500 focus:outline-none" placeholder="http://proxy.example.com:8080" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">Auth (user:pass) (Optional)</label>
                                    <input type="text" name="proxy_auth" value={settings.proxy_auth} onChange={handleChange} className="w-full bg-[#0d1117] border border-gray-700 rounded p-2 text-white focus:border-orange-500 focus:outline-none" placeholder="username:password" />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Data Management */}
                    <div className="bg-[#161b22] p-6 rounded-lg border border-gray-800 shadow-lg">
                        <h2 className="text-lg font-semibold text-white mb-4">Data Management</h2>
                        <div className="flex gap-4">
                            <button 
                                onClick={handleExport}
                                className="flex-1 bg-[#21262d] text-gray-300 py-3 rounded-lg hover:bg-[#30363d] border border-gray-700 font-bold transition-colors flex items-center justify-center gap-2"
                            >
                                <Download size={20} /> Export Monitors
                            </button>
                            <label className="flex-1 bg-[#21262d] text-gray-300 py-3 rounded-lg hover:bg-[#30363d] border border-gray-700 font-bold transition-colors flex items-center justify-center gap-2 cursor-pointer">
                                <Upload size={20} /> Import Monitors
                                <input 
                                    type="file" 
                                    accept=".json" 
                                    onChange={handleImport} 
                                    className="hidden" 
                                />
                            </label>
                        </div>
                    </div>

                    <div className="flex gap-4 pt-4">
                        <button 
                            onClick={handleSave}
                            className="flex-1 bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 font-bold transition-colors shadow-lg shadow-green-900/20 flex items-center justify-center gap-2"
                        >
                            <Save size={20} /> Save Settings
                        </button>
                    </div>

                </div>
            </div>
        </div>
    )
}

export default Settings
