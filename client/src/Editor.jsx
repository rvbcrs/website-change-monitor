// Editor doesn't use Layout! Removing the import which is causing issues.
import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useToast } from './contexts/ToastContext';
import { ArrowLeft, Save, Play, Image, FileText, Check, AlertCircle, MousePointerClick, Bell, Brain } from 'lucide-react';
// import Layout from './Layout'; // REMOVED

function Editor() {
  console.log("Editor Component Loaded - Cache Bust");
  const API_BASE = import.meta.env.DEV ? 'http://localhost:3000' : '';
  const [url, setUrl] = useState('')
  const [proxyUrl, setProxyUrl] = useState('')
  const [selectedElement, setSelectedElement] = useState(null)
  const [interval, setInterval] = useState('1h')
  const navigate = useNavigate()
  const { id } = useParams()
  const [monitorType, setMonitorType] = useState('text'); // 'text' or 'visual'
  const { showToast } = useToast();
  
  const [isSelecting, setIsSelecting] = useState(true); // Default to selection mode

  const [name, setName] = useState('')
  const [notifyConfig, setNotifyConfig] = useState({ method: 'all', threshold: '' });
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiOnlyVisual, setAiOnlyVisual] = useState(false);

  const [searchParams] = useSearchParams(); // Need to import useSearchParams

  useEffect(() => {
    if (id) {
        // ... (existing fetch logic)
    } else {
        // Check for URL query params (from Extension Auto-Config)
        const paramUrl = searchParams.get('url');
        const paramName = searchParams.get('name');
        const paramSelector = searchParams.get('selector');
        const paramType = searchParams.get('type');
        
        if (paramUrl) {
            setUrl(paramUrl);
            setProxyUrl(`${API_BASE}/proxy?url=${encodeURIComponent(paramUrl)}`);
        }
        if (paramName) setName(paramName);
        if (paramType) setMonitorType(paramType);
        if (paramSelector) {
            setSelectedElement({ selector: paramSelector, text: 'Auto-detected' });
        }
    }
  }, [id, searchParams])



  useEffect(() => {
    const handleMessage = (event) => {
      const { type, payload } = event.data;
      if (type === 'selected') {
        console.log('Selected:', payload)
        setSelectedElement(payload)
      } else if (type === 'deselected') {
          if (selectedElement && selectedElement.selector === payload) {
              setSelectedElement(null)
          }
      } else if (type === 'navigate') {
          console.log("Navigating to:", payload);
          setProxyUrl(`${API_BASE}/proxy?url=${encodeURIComponent(payload)}`);
          showToast('Navigating...', 'info');
      } else if (type === 'TEST_SELECTOR_RESULT') {
          // Handle test selector result
          if (payload.found) {
              showToast(`✅ Found ${payload.count} element${payload.count > 1 ? 's' : ''}`, 'success');
              if (selectedElement) {
                  setSelectedElement(prev => ({ ...prev, text: payload.text }));
              }
          } else if (payload.error) {
              showToast(`❌ Invalid selector: ${payload.error}`, 'error');
          } else {
              showToast(`❌ No elements found`, 'error');
          }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [selectedElement]);

  useEffect(() => {
    // Sync selection mode with iframe
    const iframe = document.querySelector('iframe');
    if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ 
            type: 'set_mode', 
            payload: { active: isSelecting } 
        }, '*');
    }
  }, [isSelecting, proxyUrl]); // Send when mode changes or url loads;

  const [isLoading, setIsLoading] = useState(false)

  const handleGo = async () => {
    if (!url) return;
    setIsLoading(true);
    // Force iframe reload by updating timestamp or similar if needed, 
    // but just setting proxyUrl triggers reload.
    // We can't easily know when iframe is done loading here since it's an iframe,
    // but we can at least show loading while the user waits for the initial "Go" action?
    // Actually, setting state is instant. The iframe load is what takes time.
    // We can add an onLoad handler to the iframe to clear loading state.
    const target = `${API_BASE}/proxy?url=${encodeURIComponent(url)}`;
    setProxyUrl(target);
  }

  const handleSave = async () => {
    if (!url) return;
    if (monitorType === 'text' && !selectedElement) {
        alert('Please select an element to monitor.');
        return;
    }
    
    try {
        const urlParams = id ? `/${id}` : '';
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(`${API_BASE}/monitors${urlParams}`, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                url,
                selector: monitorType === 'text' ? selectedElement.selector : '',
                selector_text: monitorType === 'text' ? selectedElement.text : '',
                interval,
                type: monitorType,
                notify_config: notifyConfig,
                ai_prompt: aiPrompt,
                ai_only_visual: aiOnlyVisual ? 1 : 0
            })
        });
        const data = await response.json();
        if (data.message === 'success') {
            showToast('Monitor saved successfully', 'success');
            navigate('/'); 
        } else {
            showToast('Error saving monitor: ' + data.error, 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('Error saving monitor: ' + e.message, 'error');
    }
  }

  // Effect to highlight element when iframe loads
  useEffect(() => {
     if (proxyUrl && selectedElement && id && monitorType === 'text') {
         // Only highlight on initial load/url change, not on every selection change
         const timer = setTimeout(() => {
             const iframe = document.querySelector('iframe');
             if (iframe && iframe.contentWindow) {
                 iframe.contentWindow.postMessage({
                     type: 'highlight',
                     payload: selectedElement.selector
                 }, '*');
             }
         }, 2000); 
         return () => clearTimeout(timer);
     }
  }, [proxyUrl, id]); // Removed selectedElement to prevent echo loop

  const getUiMode = () => {
    if (monitorType === 'visual') return 'visual';
    if (monitorType === 'text') {
        if (selectedElement && selectedElement.selector === 'body') return 'text_page';
        return 'text_element';
    }
    return 'text_element';
  };

  return (
    <div className="flex h-screen w-full bg-[#0d1117] flex-col text-white">
      <header className="bg-[#161b22] p-4 shadow-md flex flex-col space-y-4 z-30 relative border-b border-gray-800">
        <div className="flex flex-col md:flex-row items-center justify-between w-full max-w-6xl mx-auto gap-4">
             {/* Left: Back + Title */}
             <div className="flex items-center w-full md:w-auto gap-4">
               <button onClick={() => navigate('/')} className="text-gray-400 hover:text-white transition-colors">
                  <ArrowLeft />
               </button>
               <h1 className="text-xl font-bold text-white shadow-sm whitespace-nowrap">
                  {id ? 'Edit Monitor' : 'New Monitor'}
               </h1>
             </div>
             
             {/* Right: Controls */}
             <div className="flex flex-col md:flex-row items-center w-full gap-4 md:flex-1 md:justify-end flex-wrap">
               {/* Mode Switcher */}
               <div className="flex bg-[#0d1117] rounded-lg p-1 border border-gray-700 w-full md:w-auto justify-center">
                   <button 
                       onClick={() => { setMonitorType('visual'); setSelectedElement(null); }}
                       className={`px-3 py-1 text-sm rounded-md transition-all flex-1 md:flex-none text-center ${getUiMode() === 'visual' ? 'bg-[#1f6feb] text-white' : 'text-gray-400 hover:text-white'}`}
                   >
                       <Image size={16} className="inline-block mr-1" /> Visual
                   </button>
                   <button 
                       onClick={() => { setMonitorType('text'); setSelectedElement(null); }}
                       className={`px-3 py-1 text-sm rounded-md transition-all flex-1 md:flex-none text-center ${getUiMode() === 'text_element' ? 'bg-[#1f6feb] text-white' : 'text-gray-400 hover:text-white'}`}
                   >
                       <MousePointerClick size={16} className="inline-block mr-1" /> Element
                   </button>
                   <button 
                       onClick={() => { setMonitorType('text'); setSelectedElement({ selector: 'body', text: 'Full Page Text' }); }}
                       className={`px-3 py-1 text-sm rounded-md transition-all flex-1 md:flex-none text-center ${getUiMode() === 'text_page' ? 'bg-[#1f6feb] text-white' : 'text-gray-400 hover:text-white'}`}
                   >
                       <FileText size={16} className="inline-block mr-1" /> Page
                   </button>
               </div>

               <input 
                 type="text" 
                 placeholder="Name (optional)" 
                 className="p-2 bg-[#0d1117] border border-gray-700 text-white rounded focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-600 w-full md:w-48"
                 value={name}
                 onChange={(e) => setName(e.target.value)}
               />

               <div className="flex w-full md:w-auto md:flex-1 gap-2 min-w-0">
                   <input 
                     type="text" 
                     placeholder="Enter URL to monitor..." 
                     className="flex-1 p-2 bg-[#0d1117] border border-gray-700 text-white rounded focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-600 min-w-0"
                     value={url}
                     onChange={(e) => setUrl(e.target.value)}
                     onKeyDown={(e) => e.key === 'Enter' && handleGo()}
                   />
                   <button 
                     onClick={handleGo}
                     disabled={isLoading}
                     className={`px-6 py-2 rounded font-medium transition flex items-center justify-center gap-2 ${isLoading ? 'bg-gray-600 cursor-not-allowed' : 'bg-[#1f6feb] hover:bg-blue-600 text-white'}`}
                   >
                     {isLoading ? (
                         <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                     ) : 'Go'}
                   </button>
                   
                   {/* AI Magic Button */}
                   <button
                        onClick={async () => {
                            if (!url) return;
                            setIsLoading(true);
                            // Initial load first to ensure backend can reach it
                            setProxyUrl(`${API_BASE}/proxy?url=${encodeURIComponent(url)}`);
                            
                            showToast("✨ AI is analyzing page...", "info");
                            
                            try {
                                const res = await fetch(`${API_BASE}/api/ai/analyze-page`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ url, prompt: aiPrompt })
                                });
                                const data = await res.json();
                                if (data.data) {
                                    const { name, selector, type } = data.data;
                                    setName(name);
                                    if (selector) {
                                        setSelectedElement({ selector, text: 'Auto-detected by AI' });
                                        setMonitorType(type || 'text');
                                    }
                                    showToast("✨ Configuration applied!", "success");
                                } else {
                                    showToast("AI couldn't find a good config.", "error");
                                }
                            } catch (e) {
                                showToast("AI Analysis failed: " + e.message, "error");
                            } finally {
                                setIsLoading(false);
                            }
                        }}
                        disabled={!url || isLoading}
                        title="Magic Create: Auto-fill Name & Selector"
                        className={`px-3 py-2 rounded font-medium transition flex items-center justify-center gap-2 ${!url || isLoading ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-500 text-white'}`}
                   >
                       ✨
                   </button>
               </div>
             </div>
        </div>
        
        {/* Helper Text */}
        <div className="w-full max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between text-sm text-gray-400 gap-4 opacity-50 hover:opacity-100 transition-opacity duration-300">
            <div className="w-full md:w-auto">
                {monitorType === 'text' ? (
                    <div className="flex flex-col md:flex-row items-center justify-between gap-4 w-full">
                        <p className="text-gray-400 text-sm flex items-center gap-2">
                            <span className="bg-blue-900/30 text-blue-400 px-2 py-0.5 rounded text-xs uppercase font-bold tracking-wider">Tip</span>
                            {isSelecting ? "Click any element." : "Interact with page."}
                        </p>
                        
                     <div className="flex bg-[#21262d] rounded-lg p-1 overflow-x-auto max-w-full">
                            {/* Clear Button */}
                            <button 
                                onClick={() => {
                                    setSelectedElement(null);
                                    const iframe = document.querySelector('iframe');
                                    if (iframe && iframe.contentWindow) {
                                        iframe.contentWindow.postMessage({ type: 'clear' }, '*');
                                    }
                                }}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-900/30 transition-all mr-2 border-r border-gray-700 pr-3"
                                title="Clear Selection"
                            >
                                <span className="font-bold">×</span> Clear
                            </button>

                            <button 
                                onClick={() => setIsSelecting(true)}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${isSelecting ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
                            >
                                <MousePointerClick size={14} />
                                Select
                            </button>
                            <button 
                                onClick={() => setIsSelecting(false)}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${!isSelecting ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
                            >
                                <MousePointerClick className="rotate-90" size={14} />
                                Interact
                            </button>
                        </div>
                    </div>
                ) : (
                    <span className="text-blue-400">Visual mode active. Screenshots will be compared.</span>
                )}
            </div>
             <div className="flex items-center justify-between w-full md:w-auto gap-4">
                 
                 {/* Notification Rules */}
                 <div className="flex items-center gap-2">
                     <Bell size={16} className="text-gray-400" />
                     <select 
                         value={notifyConfig.method} 
                         onChange={(e) => setNotifyConfig({ ...notifyConfig, method: e.target.value })}
                         className="bg-[#0d1117] border border-gray-700 text-white rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 max-w-[160px]"
                         title="Notification Rule"
                     >
                         <option value="all">Always Notify</option>
                         <option value="ai_focus">🤖 AI Focus Match</option>
                         <option value="value_lt">Value &lt;</option>
                         <option value="value_gt">Value &gt;</option>
                         <option value="contains">Contains</option>
                         <option value="not_contains">Not Contains</option>
                     </select>
                     {notifyConfig.method !== 'all' && notifyConfig.method !== 'ai_focus' && (
                         <input 
                             type="text" 
                             placeholder="Val" 
                             value={notifyConfig.threshold}
                             onChange={(e) => setNotifyConfig({ ...notifyConfig, threshold: e.target.value })}
                             className="bg-[#0d1117] border border-gray-700 text-white rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 w-20"
                         />
                     )}
                 </div>

                 {/* AI Prompt Input */}
                 <div className="flex items-center gap-2 border-l border-gray-700 pl-4">
                     <Brain size={16} className="text-purple-400" />
                     <input 
                         type="text" 
                         placeholder="AI Focus: e.g. Watch for price..." 
                         value={aiPrompt}
                         onChange={(e) => setAiPrompt(e.target.value)}
                         className="bg-[#0d1117] border border-gray-700 text-white rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500 w-48 placeholder-gray-600"
                         title="Custom instructions for AI Analysis"
                     />
                 </div>



                 <div className="flex items-center gap-2 border-l border-gray-700 pl-4">
                     <label className="text-gray-400 text-sm whitespace-nowrap">Check Every:</label>
                     <select 
                         value={interval} 
                         onChange={(e) => setInterval(e.target.value)}
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
                      Save
                  </button>
             </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {selectedElement && monitorType === 'text' && (
            <div className="w-80 bg-[#161b22] border-r border-gray-800 p-4 shadow-lg flex flex-col overflow-y-auto z-20">
                <h2 className="text-lg font-semibold mb-2 text-white">Selected Element</h2>
                <div className="flex gap-2 mb-2">
                    <input 
                        type="text"
                        value={selectedElement.selector}
                        onChange={(e) => setSelectedElement({ ...selectedElement, selector: e.target.value })}
                        className="flex-1 bg-[#0d1117] p-2 rounded text-xs font-mono break-all border border-gray-700 text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="CSS Selector"
                    />
                    <button
                        onClick={() => {
                            const iframe = document.querySelector('iframe');
                            if (iframe) {
                                iframe.contentWindow.postMessage({
                                    type: 'TEST_SELECTOR',
                                    payload: selectedElement.selector
                                }, '*');
                            }
                        }}
                        className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-500 transition whitespace-nowrap"
                        title="Test selector and highlight matching element"
                    >
                        🔍 Test
                    </button>
                </div>
                <div className="mb-4">
                    <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">Current Text</h3>
                    <p className="p-2 bg-[#0d1117] rounded border border-gray-700 mt-1 text-sm text-gray-200">{selectedElement.text || <span className="text-gray-500 italic">No text content</span>}</p>
                </div>
                
                {/* AI-Only Detection Toggle */}
                <div className="mb-4 p-3 bg-[#0d1117] rounded border border-gray-700">
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input 
                            type="checkbox" 
                            checked={aiOnlyVisual}
                            onChange={(e) => setAiOnlyVisual(e.target.checked)}
                            className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-purple-600 focus:ring-purple-500"
                        />
                        <span className="text-sm text-gray-300">🤖 AI-Only Detection</span>
                    </label>
                    <p className="text-xs text-gray-500 mt-1">Only notify when AI determines the change is meaningful</p>
                </div>
                {/* Removed duplicate Interval and Save controls */}
            </div>
        )}

        <div className="flex-1 bg-[#0d1117] relative flex flex-col">
          {proxyUrl ? (
            <div className="flex-1 relative bg-gray-900">
                {isLoading && (
                   <div className="absolute inset-0 flex items-center justify-center bg-gray-900 z-10">
                       <div className="flex flex-col items-center">
                           <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                           <p className="text-gray-400">Loading site...</p>
                       </div>
                   </div>
                )}
                
                {/* Visual/Page Mode Overlay */}
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
                                {monitorType === 'visual' ? 'Visual Monitoring Active' : 'Full Page Text Monitoring'}
                            </h3>
                            <p className="text-gray-300">
                                {monitorType === 'visual' 
                                    ? 'We will monitor the entire page for visual changes.' 
                                    : 'We will monitor the full text content of the page.'}
                            </p>
                            <p className="text-gray-400 text-sm mt-4">Element selection is disabled in this mode.</p>
                        </div>
                    </div>
                )}
                <div className="absolute inset-0 bg-white">
             <iframe 
                src={proxyUrl} 
                className="w-full h-full border-0"
                title="Website Preview"
                sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                onLoad={(e) => {
                    // Sync mode whenever page loads/navigates
                    e.target.contentWindow.postMessage({ 
                        type: 'set_mode', 
                        payload: { active: isSelecting } 
                    }, '*');
                    
                    // Also re-send highlight if needed
                    if (selectedElement && monitorType === 'text') {
                        e.target.contentWindow.postMessage({
                             type: 'highlight',
                             payload: selectedElement.selector
                        }, '*');
                    }
                    setIsLoading(false); // Keep this from original iframe
                }}
             />
             {!proxyUrl && (
                 <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                     Enter a URL to verify selector
                 </div>
             )}
          </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-600">
                Enter a URL to start
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Editor

