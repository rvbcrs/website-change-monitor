// Editor doesn't use Layout! Removing the import which is causing issues.
import { useState, useEffect, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useToast } from './contexts/ToastContext';
import { ArrowLeft, Image, FileText, MousePointerClick, Bell, Brain } from 'lucide-react';
import { useAuth } from './contexts/AuthContext';

interface SelectedElement {
    selector: string;
    text: string;
}

interface NotifyConfig {
    method: string;
    threshold: string;
}

interface MessageEvent extends Event {
    data: {
        type: string;
        payload: unknown;
    };
}

function Editor() {
  console.log("Editor Component Loaded - Cache Bust");
  const API_BASE = '';
  const [url, setUrl] = useState('')
  const [proxyUrl, setProxyUrl] = useState('')
  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null)
  const [interval, setIntervalValue] = useState('1h')
  const navigate = useNavigate()
  const { id } = useParams()
  const [monitorType, setMonitorType] = useState<'text' | 'visual'>('text');
  const { showToast } = useToast();
  const { authFetch } = useAuth();
  const { t } = useTranslation();
  
  const [isSelecting, setIsSelecting] = useState(true);

  const [name, setName] = useState('')
  const [notifyConfig, setNotifyConfig] = useState<NotifyConfig>({ method: 'all', threshold: '' });
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiOnlyVisual, setAiOnlyVisual] = useState(false);
  const [retryCount, setRetryCount] = useState(3);
  const [retryDelay, setRetryDelay] = useState(2000);

  const [searchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (id) {
        const fetchMonitor = async () => {
            try {
                const response = await authFetch(`${API_BASE}/monitors`);
                const data = await response.json();
                if (data.message === 'success') {
                    const monitor = data.data.find((m: { id: number }) => m.id == Number(id));
                    if (monitor) {
                        setUrl(monitor.url);
                        setName(monitor.name || '');
                        setIntervalValue(monitor.interval);
                        setMonitorType(monitor.type);
                        setAiPrompt(monitor.ai_prompt || '');
                        setAiOnlyVisual(!!monitor.ai_only_visual);
                        setRetryCount(monitor.retry_count ?? 3);
                        setRetryDelay(monitor.retry_delay ?? 2000);
                        
                        try {
                            if (monitor.notify_config) setNotifyConfig(JSON.parse(monitor.notify_config));
                        } catch {}
                        
                        if (monitor.selector) {
                            setSelectedElement({
                                selector: monitor.selector,
                                text: monitor.selector_text || 'Loaded Selector'
                            });
                        }
                        
                        setProxyUrl(`${API_BASE}/proxy?url=${encodeURIComponent(monitor.url)}`);
                    } else {
                        showToast(t('editor.toasts.monitor_not_found'), 'error');
                        navigate('/');
                    }
                }
            } catch (e) {
                console.error(e);
                showToast(t('editor.toasts.load_error'), 'error');
            }
        };
        fetchMonitor();
    } else {
        const paramUrl = searchParams.get('url');
        const paramName = searchParams.get('name');
        const paramSelector = searchParams.get('selector');
        const paramType = searchParams.get('type');
        
        if (paramUrl) {
            setUrl(paramUrl);
            setProxyUrl(`${API_BASE}/proxy?url=${encodeURIComponent(paramUrl)}`);
        }
        if (paramName) setName(paramName);
        if (paramType) setMonitorType(paramType as 'text' | 'visual');
        if (paramSelector) {
            setSelectedElement({ selector: paramSelector, text: t('editor.toasts.auto_detected') });
        }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, searchParams])

  useEffect(() => {
    const handleMessage = (event: Event) => {
      const msgEvent = event as unknown as MessageEvent;
      const { type, payload } = msgEvent.data;
      if (type === 'selected') {
        console.log('Selected:', payload)
        setSelectedElement(payload as SelectedElement)
      } else if (type === 'deselected') {
          if (selectedElement && selectedElement.selector === payload) {
              setSelectedElement(null)
          }
      } else if (type === 'navigate') {
          console.log("Navigating to:", payload);
          setProxyUrl(`${API_BASE}/proxy?url=${encodeURIComponent(payload as string)}`);
          showToast(t('editor.toasts.navigating'), 'info');
      } else if (type === 'TEST_SELECTOR_RESULT') {
          const result = payload as { found?: boolean; count?: number; text?: string; error?: string };
          if (result.found) {
              showToast(t('editor.toasts.found_elements', { count: result.count }), 'success');
              if (selectedElement) {
                  setSelectedElement(prev => prev ? { ...prev, text: result.text || '' } : null);
              }
          } else if (result.error) {
              showToast(t('editor.toasts.invalid_selector', { error: result.error }), 'error');
          } else {
              showToast(t('editor.toasts.no_elements'), 'error');
          }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedElement]);

  useEffect(() => {
    const iframe = document.querySelector('iframe') as HTMLIFrameElement | null;
    if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ 
            type: 'set_mode', 
            payload: { active: isSelecting } 
        }, '*');
    }
  }, [isSelecting, proxyUrl]);

  const handleGo = async () => {
    if (!url) return;
    setIsLoading(true);
    const target = `${API_BASE}/proxy?url=${encodeURIComponent(url)}`;
    setProxyUrl(target);
  }

  const handleSave = async () => {
    if (!url) return;
    if (monitorType === 'text' && !selectedElement) {
        showToast(t('editor.toasts.select_element'), 'error');
        return;
    }
    
    try {
        const urlParams = id ? `/${id}` : '';
        const method = id ? 'PUT' : 'POST';
        
        const response = await authFetch(`${API_BASE}/monitors${urlParams}`, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                url,
                selector: monitorType === 'text' && selectedElement ? selectedElement.selector : '',
                selector_text: monitorType === 'text' && selectedElement ? selectedElement.text : '',
                interval,
                type: monitorType,
                notify_config: notifyConfig,
                ai_prompt: aiPrompt,
                ai_only_visual: aiOnlyVisual ? 1 : 0,
                retry_count: retryCount,
                retry_delay: retryDelay
            })
        });
        const data = await response.json();
        if (data.message === 'success' || data.message === 'Monitor added' || data.message === 'Monitor updated') {
            showToast(t('editor.toasts.monitor_saved'), 'success');
            navigate('/'); 
        } else {
            showToast(t('editor.toasts.save_error', { error: data.error || 'Unknown error' }), 'error');
        }
    } catch (e) {
        console.error(e);
        showToast(t('editor.toasts.save_error', { error: e instanceof Error ? e.message : 'Unknown error' }), 'error');
    }
  }

  useEffect(() => {
     if (proxyUrl && selectedElement && id && monitorType === 'text') {
         const timer = setTimeout(() => {
             const iframe = document.querySelector('iframe') as HTMLIFrameElement | null;
             if (iframe && iframe.contentWindow) {
                 iframe.contentWindow.postMessage({
                     type: 'highlight',
                     payload: selectedElement.selector
                 }, '*');
             }
         }, 2000); 
         return () => clearTimeout(timer);
     }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proxyUrl, id]);

  const getUiMode = (): 'visual' | 'text_page' | 'text_element' => {
    if (monitorType === 'visual') return 'visual';
    if (monitorType === 'text') {
        if (selectedElement && selectedElement.selector === 'body') return 'text_page';
        return 'text_element';
    }
    return 'text_element';
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleGo();
  };

  const handleAiAnalyze = async () => {
    if (!url) return;
    setIsLoading(true);
    setProxyUrl(`${API_BASE}/proxy?url=${encodeURIComponent(url)}`);
    
    showToast(t('editor.toasts.ai_analyzing'), "info");
    
    try {
        const res = await authFetch(`${API_BASE}/api/ai/analyze-page`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, prompt: aiPrompt })
        });
        const data = await res.json();
        if (data.data) {
            const { name: aiName, selector, type } = data.data;
            setName(aiName);
            if (selector) {
                setSelectedElement({ selector, text: t('editor.toasts.auto_detected') });
                setMonitorType(type || 'text');
            }
            showToast(t('editor.toasts.config_applied'), "success");
        } else {
            showToast(t('editor.toasts.ai_no_config'), "error");
        }
    } catch (e) {
        showToast(t('editor.toasts.ai_error', { error: e instanceof Error ? e.message : 'Unknown error' }), "error");
    } finally {
        setIsLoading(false);
    }
  };

  const handleTestSelector = () => {
    const iframe = document.querySelector('iframe') as HTMLIFrameElement | null;
    if (iframe && selectedElement) {
        iframe.contentWindow?.postMessage({
            type: 'TEST_SELECTOR',
            payload: selectedElement.selector
        }, '*');
    }
  };

  const handleClearSelection = () => {
    setSelectedElement(null);
    const iframe = document.querySelector('iframe') as HTMLIFrameElement | null;
    if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'clear' }, '*');
    }
  };

  const handleIframeLoad = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    const iframe = e.currentTarget;
    iframe.contentWindow?.postMessage({ 
        type: 'set_mode', 
        payload: { active: isSelecting } 
    }, '*');
    
    if (selectedElement && monitorType === 'text') {
        iframe.contentWindow?.postMessage({
             type: 'highlight',
             payload: selectedElement.selector
        }, '*');
    }
    setIsLoading(false);
  };

  return (
    <div className="flex h-screen w-full bg-[#0d1117] flex-col text-white">
      <header className="bg-[#161b22] p-4 shadow-md flex flex-col space-y-4 z-30 relative border-b border-gray-800">
        <div className="flex flex-col md:flex-row items-center justify-between w-full max-w-6xl mx-auto gap-4">
             <div className="flex items-center w-full md:w-auto gap-4">
               <button onClick={() => navigate('/')} className="text-gray-400 hover:text-white transition-colors">
                  <ArrowLeft />
               </button>
               <h1 className="text-xl font-bold text-white shadow-sm whitespace-nowrap">
                  {id ? t('editor.title_edit') : t('editor.title_new')}
               </h1>
             </div>
             
             <div className="flex flex-col md:flex-row items-center w-full gap-4 md:flex-1 md:justify-end flex-wrap">
               <div className="flex bg-[#0d1117] rounded-lg p-1 border border-gray-700 w-full md:w-auto justify-center">
                   <button 
                       onClick={() => { setMonitorType('visual'); setSelectedElement(null); }}
                       className={`px-3 py-1 text-sm rounded-md transition-all flex-1 md:flex-none text-center ${getUiMode() === 'visual' ? 'bg-[#1f6feb] text-white' : 'text-gray-400 hover:text-white'}`}
                   >
                       <Image size={16} className="inline-block mr-1" /> {t('editor.visual')}
                   </button>
                   <button 
                       onClick={() => { setMonitorType('text'); setSelectedElement(null); }}
                       className={`px-3 py-1 text-sm rounded-md transition-all flex-1 md:flex-none text-center ${getUiMode() === 'text_element' ? 'bg-[#1f6feb] text-white' : 'text-gray-400 hover:text-white'}`}
                   >
                       <MousePointerClick size={16} className="inline-block mr-1" /> {t('editor.element')}
                   </button>
                   <button 
                       onClick={() => { setMonitorType('text'); setSelectedElement({ selector: 'body', text: 'Full Page Text' }); }}
                       className={`px-3 py-1 text-sm rounded-md transition-all flex-1 md:flex-none text-center ${getUiMode() === 'text_page' ? 'bg-[#1f6feb] text-white' : 'text-gray-400 hover:text-white'}`}
                   >
                       <FileText size={16} className="inline-block mr-1" /> {t('editor.page')}
                   </button>
               </div>

               <input 
                 type="text" 
                 placeholder={t('editor.name_placeholder')} 
                 className="p-2 bg-[#0d1117] border border-gray-700 text-white rounded focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-600 w-full md:w-48"
                 value={name}
                 onChange={(e) => setName(e.target.value)}
               />

               <div className="flex w-full md:w-auto md:flex-1 gap-2 min-w-0">
                   <input 
                     type="text" 
                     placeholder={t('editor.url_placeholder')} 
                     className="flex-1 p-2 bg-[#0d1117] border border-gray-700 text-white rounded focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-600 min-w-0"
                     value={url}
                     onChange={(e) => setUrl(e.target.value)}
                     onKeyDown={handleKeyDown}
                   />
                   <button 
                     onClick={handleGo}
                     disabled={isLoading}
                     className={`px-6 py-2 rounded font-medium transition flex items-center justify-center gap-2 ${isLoading ? 'bg-gray-600 cursor-not-allowed' : 'bg-[#1f6feb] hover:bg-blue-600 text-white'}`}
                   >
                     {isLoading ? (
                         <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                     ) : t('editor.go')}
                   </button>
                   
                   <button
                        onClick={handleAiAnalyze}
                        disabled={!url || isLoading}
                        title={t('editor.magical_create')}
                        className={`px-3 py-2 rounded font-medium transition flex items-center justify-center gap-2 ${!url || isLoading ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-500 text-white'}`}
                   >
                       ✨
                   </button>
               </div>
             </div>
        </div>
        
        <div className="w-full max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between text-sm text-gray-400 gap-4 opacity-50 hover:opacity-100 transition-opacity duration-300">
            <div className="w-full md:w-auto">
                {monitorType === 'text' ? (
                    <div className="flex flex-col md:flex-row items-center justify-between gap-4 w-full">
                        <p className="text-gray-400 text-sm flex items-center gap-2">
                            <span className="bg-blue-900/30 text-blue-400 px-2 py-0.5 rounded text-xs uppercase font-bold tracking-wider">Tip</span>
                            {isSelecting ? t('editor.tip_select') : t('editor.tip_interact')}
                        </p>
                        
                     <div className="flex bg-[#21262d] rounded-lg p-1 overflow-x-auto max-w-full">
                            <button 
                                onClick={handleClearSelection}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-900/30 transition-all mr-2 border-r border-gray-700 pr-3"
                                title={t('editor.clear')}
                            >
                                <span className="font-bold">×</span> {t('editor.clear')}
                            </button>

                            <button 
                                onClick={() => setIsSelecting(true)}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${isSelecting ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
                            >
                                <MousePointerClick size={14} />
                                {t('editor.select')}
                            </button>
                            <button 
                                onClick={() => setIsSelecting(false)}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${!isSelecting ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
                            >
                                <MousePointerClick className="rotate-90" size={14} />
                                {t('editor.interact')}
                            </button>
                        </div>
                    </div>
                ) : (
                    <span className="text-blue-400">{t('editor.visual_mode_desc')}</span>
                )}
            </div>
             <div className="flex items-center justify-between w-full md:w-auto gap-4">
                 
                 <div className="flex items-center gap-2">
                     <Bell size={16} className="text-gray-400" />
                     <select 
                         value={notifyConfig.method} 
                         onChange={(e) => setNotifyConfig({ ...notifyConfig, method: e.target.value })}
                         className="bg-[#0d1117] border border-gray-700 text-white rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 max-w-[160px]"
                         title="Notification Rule"
                     >
                         <option value="all">{t('editor.always_notify')}</option>
                         <option value="ai_focus">{t('editor.ai_focus')}</option>
                         <option value="value_lt">{t('editor.val')} &lt;</option>
                         <option value="value_gt">{t('editor.val')} &gt;</option>
                         <option value="contains">{t('editor.contains')}</option>
                         <option value="not_contains">{t('editor.not_contains')}</option>
                     </select>
                     {notifyConfig.method !== 'all' && notifyConfig.method !== 'ai_focus' && (
                         <input 
                             type="text" 
                             placeholder={t('editor.val')} 
                             value={notifyConfig.threshold}
                             onChange={(e) => setNotifyConfig({ ...notifyConfig, threshold: e.target.value })}
                             className="bg-[#0d1117] border border-gray-700 text-white rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 w-20"
                         />
                     )}
                 </div>

                 <div className="flex items-center gap-2 border-l border-gray-700 pl-4">
                     <Brain size={16} className="text-purple-400" />
                     <input 
                         type="text" 
                         placeholder={t('editor.ai_prompt_placeholder')} 
                         value={aiPrompt}
                         onChange={(e) => setAiPrompt(e.target.value)}
                         className="bg-[#0d1117] border border-gray-700 text-white rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500 w-48 placeholder-gray-600"
                         title="Custom instructions for AI Analysis"
                     />
                 </div>

                 <div className="flex items-center gap-2 border-l border-gray-700 pl-4">
                     <label className="text-gray-400 text-sm whitespace-nowrap">{t('editor.check_every')}</label>
                     <select 
                         value={interval} 
                         onChange={(e) => setIntervalValue(e.target.value)}
                         className="bg-[#0d1117] border border-gray-700 text-white rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                     >
                         <option value="1m">1m</option>
                         <option value="5m">5m</option>
                         <option value="30m">30m</option>
                         <option value="1h">1h</option>
                         <option value="8h">8h</option>
                         <option value="24h">24h</option>
                         <option value="1w">1w</option>
                     </select>
                 </div>
                  <button 
                      onClick={handleSave}
                      disabled={!url || !proxyUrl || isLoading || (monitorType === 'text' && !selectedElement)}
                      className={`px-6 py-1 rounded transition font-medium w-32 justify-center flex ${(!url || !proxyUrl || isLoading || (monitorType === 'text' && !selectedElement)) ? 'bg-gray-700 text-gray-400 cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-500'}`}
                  >
                      {t('editor.save')}
                  </button>
             </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {selectedElement && monitorType === 'text' && (
            <div className="w-80 bg-[#161b22] border-r border-gray-800 p-4 shadow-lg flex flex-col overflow-y-auto z-20">
                <h2 className="text-lg font-semibold mb-2 text-white">{t('editor.selected_element')}</h2>
                <div className="flex gap-2 mb-2">
                    <input 
                        type="text"
                        value={selectedElement.selector}
                        onChange={(e) => setSelectedElement({ ...selectedElement, selector: e.target.value })}
                        className="flex-1 bg-[#0d1117] p-2 rounded text-xs font-mono break-all border border-gray-700 text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder={t('editor.selector_placeholder')}
                    />
                    <button
                        onClick={handleTestSelector}
                        className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-500 transition whitespace-nowrap"
                        title="Test selector and highlight matching element"
                    >
                        🔍 {t('editor.test')}
                    </button>
                </div>
                <div className="mb-4">
                    <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">{t('editor.current_text')}</h3>
                    <p className="p-2 bg-[#0d1117] rounded border border-gray-700 mt-1 text-sm text-gray-200">{selectedElement.text || <span className="text-gray-500 italic">{t('editor.no_text')}</span>}</p>
                </div>
                
                <div className="mb-4 p-3 bg-[#0d1117] rounded border border-gray-700">
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input 
                            type="checkbox" 
                            checked={aiOnlyVisual}
                            onChange={(e) => setAiOnlyVisual(e.target.checked)}
                            className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-purple-600 focus:ring-purple-500"
                        />
                        <span className="text-sm text-gray-300">{t('editor.ai_only')}</span>
                    </label>
                    <p className="text-xs text-gray-500 mt-1">{t('editor.ai_only_desc')}</p>
                </div>

                {/* Retry Configuration */}
                <div className="mb-4 p-3 bg-[#0d1117] rounded border border-gray-700">
                    <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
                        🔄 {t('editor.retry_config', 'Retry Configuration')}
                    </h3>
                    <div className="space-y-3">
                        <div>
                            <label className="text-xs text-gray-400 block mb-1">
                                {t('editor.retry_count', 'Retry Count')}
                            </label>
                            <select
                                value={retryCount}
                                onChange={(e) => setRetryCount(Number(e.target.value))}
                                className="w-full bg-[#161b22] border border-gray-700 text-white rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                            >
                                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                                    <option key={n} value={n}>{n}x</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-gray-400 block mb-1">
                                {t('editor.retry_delay', 'Delay Between Retries')}
                            </label>
                            <select
                                value={retryDelay}
                                onChange={(e) => setRetryDelay(Number(e.target.value))}
                                className="w-full bg-[#161b22] border border-gray-700 text-white rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                            >
                                <option value={500}>0.5s</option>
                                <option value={1000}>1s</option>
                                <option value={2000}>2s</option>
                                <option value={3000}>3s</option>
                                <option value={5000}>5s</option>
                                <option value={10000}>10s</option>
                            </select>
                        </div>
                        <p className="text-xs text-gray-500">
                            {t('editor.retry_desc', 'If the element is not found, retry this many times with the specified delay.')}
                        </p>
                    </div>
                </div>
            </div>
        )}

        <div className="flex-1 bg-[#0d1117] relative flex flex-col">
          {proxyUrl ? (
            <div className="flex-1 relative bg-gray-900">
                {/* Iframe container - base layer */}
                <div className="absolute inset-0 bg-white">
                    <iframe 
                        src={proxyUrl} 
                        className="w-full h-full border-0"
                        title="Website Preview"
                        sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                        onLoad={handleIframeLoad}
                    />
                    {!proxyUrl && (
                        <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                            {t('editor.enter_url_verify')}
                        </div>
                    )}
                </div>
                
                {/* Loading overlay - shown while loading, blocks interaction */}
                {isLoading && (
                   <div className="absolute inset-0 flex items-center justify-center bg-gray-900 z-10">
                       <div className="flex flex-col items-center">
                           <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                           <p className="text-gray-400">{t('editor.loading')}</p>
                       </div>
                   </div>
                )}
                
                {/* Visual/body mode overlay - shown when visual monitoring is active */}
                {(monitorType === 'visual' || (monitorType === 'text' && selectedElement && selectedElement.selector === 'body')) && !isLoading && proxyUrl && (
                    <div className="absolute inset-0 z-20 bg-blue-900/10 pointer-events-auto flex items-center justify-center backdrop-blur-[1px] border-4 border-blue-500/50">
                        <div className="bg-[#161b22] p-6 rounded-lg shadow-2xl border border-blue-500/50 text-center max-w-md">
                            <div className="bg-blue-500/20 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                                {monitorType === 'visual' ? (
                                    <Image size={32} className="text-blue-400" />
                                ) : (
                                    <FileText size={32} className="text-blue-400" />
                                )}
                            </div>
                            <h3 className="text-xl font-bold text-white mb-2">
                                {monitorType === 'visual' ? t('editor.visual_active') : t('editor.text_active')}
                            </h3>
                            <p className="text-gray-300">
                                {monitorType === 'visual' 
                                    ? t('editor.visual_active_desc') 
                                    : t('editor.text_active_desc')}
                            </p>
                            <p className="text-gray-400 text-sm mt-4">{t('editor.selection_disabled')}</p>
                        </div>
                    </div>
                )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-600">
                {t('editor.enter_url_start')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Editor
