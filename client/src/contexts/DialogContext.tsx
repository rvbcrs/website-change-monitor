import { createContext, useContext, useState, useCallback, useRef, type ReactNode, type KeyboardEvent } from 'react';
import ConfirmDialog from '../components/ConfirmDialog';

interface ConfirmOptions {
    title: string;
    message?: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
}

interface PromptOptions {
    title?: string;
    message?: string;
    placeholder?: string;
    defaultValue?: string;
    confirmText?: string;
    suggestions?: string[];
    exclude?: string[];
}

interface DialogContextType {
    confirm: (options: ConfirmOptions) => Promise<boolean>;
    prompt: (options: PromptOptions) => Promise<string | null>;
}

const DialogContext = createContext<DialogContextType | null>(null);

export const useDialog = (): DialogContextType => {
    const context = useContext(DialogContext);
    if (!context) {
        throw new Error('useDialog must be used within a DialogProvider');
    }
    return context;
};

interface DialogProviderProps {
    children: ReactNode;
}

export const DialogProvider = ({ children }: DialogProviderProps) => {
    const [dialog, setDialog] = useState<ConfirmOptions | null>(null);
    const [promptDialog, setPromptDialog] = useState<PromptOptions | null>(null);
    const [promptValue, setPromptValue] = useState('');
    const resolver = useRef<((value: boolean) => void) | null>(null);
    const promptResolver = useRef<((value: string | null) => void) | null>(null);

    const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
        setDialog(options);
        return new Promise((resolve) => {
            resolver.current = resolve;
        });
    }, []);

    const prompt = useCallback((options: PromptOptions): Promise<string | null> => {
        setPromptDialog(options);
        setPromptValue(options.defaultValue || '');
        return new Promise((resolve) => {
            promptResolver.current = resolve;
        });
    }, []);

    const handleConfirm = () => {
        resolver.current?.(true);
        setDialog(null);
    };

    const handleCancel = () => {
        resolver.current?.(false);
        setDialog(null);
    };

    const handlePromptSubmit = () => {
        promptResolver.current?.(promptValue.trim() || null);
        setPromptDialog(null);
        setPromptValue('');
    };

    const handlePromptCancel = () => {
        promptResolver.current?.(null);
        setPromptDialog(null);
        setPromptValue('');
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') handlePromptSubmit();
    };

    return (
        <DialogContext.Provider value={{ confirm, prompt }}>
            {children}
            {dialog && (
                <ConfirmDialog 
                    {...dialog} 
                    onConfirm={handleConfirm} 
                    onCancel={handleCancel} 
                />
            )}
            {promptDialog && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-[#161b22] border border-gray-700 rounded-xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-200">
                        <h3 className="text-lg font-bold text-white mb-2">{promptDialog.title || 'Enter value'}</h3>
                        {promptDialog.message && (
                            <p className="text-gray-400 text-sm mb-4">{promptDialog.message}</p>
                        )}
                        <input
                            type="text"
                            value={promptValue}
                            onChange={(e) => setPromptValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={promptDialog.placeholder || ''}
                            className="w-full bg-[#0d1117] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 mb-3"
                            autoFocus
                        />
                        {/* Existing tags suggestions */}
                        {promptDialog.suggestions && promptDialog.suggestions.length > 0 && (
                            <div className="mb-4">
                                <p className="text-gray-500 text-xs uppercase mb-2">Or select existing:</p>
                                <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
                                    {promptDialog.suggestions
                                        .filter(s => !promptDialog.exclude?.includes(s))
                                        .map(suggestion => (
                                            <button
                                                key={suggestion}
                                                type="button"
                                                onClick={() => {
                                                    promptResolver.current?.(suggestion);
                                                    setPromptDialog(null);
                                                    setPromptValue('');
                                                }}
                                                className="px-3 py-1 rounded-full text-xs bg-purple-900/30 text-purple-300 border border-purple-800 hover:bg-purple-900/50 transition-colors"
                                            >
                                                {suggestion}
                                            </button>
                                        ))
                                    }
                                </div>
                            </div>
                        )}
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={handlePromptCancel}
                                className="px-4 py-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handlePromptSubmit}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors font-medium"
                            >
                                {promptDialog.confirmText || 'Add'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </DialogContext.Provider>
    );
};
