import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
    title?: string;
    message?: string;
    confirmText?: string;
    cancelText?: string;
    type?: 'danger' | 'warning' | 'info';
    danger?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

const ConfirmDialog = ({ 
    title = 'Confirm Action', 
    message = 'Are you sure you want to proceed?', 
    confirmText = 'Confirm', 
    cancelText = 'Cancel',
    type = 'danger', // danger, warning, info
    onConfirm, 
    onCancel 
}: ConfirmDialogProps) => {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        requestAnimationFrame(() => setIsVisible(true));
    }, []);

    const handleClose = (callback: () => void) => {
        setIsVisible(false);
        setTimeout(callback, 200);
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            {/* Backdrop */}
            <div 
                className={`absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
                onClick={() => handleClose(onCancel)}
            />
            
            {/* Dialog */}
            <div 
                className={`
                    relative w-full max-w-md bg-[#161b22] border border-gray-700 
                    rounded-lg shadow-2xl overflow-hidden
                    transform transition-all duration-200
                    ${isVisible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'}
                `}
            >
                <div className="p-6">
                    <div className="flex items-start gap-4">
                        <div className={`
                            p-3 rounded-full flex-shrink-0
                            ${type === 'danger' ? 'bg-red-900/20 text-red-500' : 'bg-blue-900/20 text-blue-500'}
                        `}>
                            <AlertTriangle size={24} />
                        </div>
                        <div className="flex-1">
                            <h3 className="text-lg font-semibold text-white mb-2">
                                {title}
                            </h3>
                            <p className="text-gray-400 text-sm leading-relaxed">
                                {message}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="bg-[#0d1117] px-6 py-4 flex items-center justify-end gap-3 border-t border-gray-800">
                    <button 
                        onClick={() => handleClose(onCancel)}
                        className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white transition-colors"
                    >
                        {cancelText}
                    </button>
                    <button 
                        onClick={() => handleClose(onConfirm)}
                        className={`
                            px-4 py-2 text-sm font-medium text-white rounded shadow-lg transition-colors
                            ${type === 'danger' 
                                ? 'bg-red-600 hover:bg-red-700 shadow-red-900/20' 
                                : 'bg-blue-600 hover:bg-blue-700 shadow-blue-900/20'}
                        `}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmDialog;
