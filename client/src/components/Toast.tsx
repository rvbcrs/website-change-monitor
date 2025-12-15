import { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';

interface ToastProps {
    id?: number;
    message: string;
    type: 'success' | 'error' | 'info';
    onClose: () => void;
}

const Toast = ({ message, type, onClose }: ToastProps) => {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        // Trigger enter animation
        requestAnimationFrame(() => setIsVisible(true));
    }, []);

    const handleClose = () => {
        setIsVisible(false);
        setTimeout(onClose, 300); // Wait for exit animation
    };

    const styles = {
        success: {
            bg: 'bg-[#0d130f]', // Very dark green
            border: 'border-green-900',
            text: 'text-green-400',
            icon: <CheckCircle size={20} className="text-green-500" />
        },
        error: {
            bg: 'bg-[#1a0f0f]', // Very dark red
            border: 'border-red-900',
            text: 'text-red-400',
            icon: <AlertCircle size={20} className="text-red-500" />
        },
        info: {
            bg: 'bg-[#0f111a]', // Very dark blue
            border: 'border-blue-900',
            text: 'text-blue-400',
            icon: <Info size={20} className="text-blue-500" />
        }
    };

    const style = styles[type] || styles.info;

    return (
        <div 
            className={`
                pointer-events-auto
                min-w-[320px] max-w-[420px] 
                rounded-lg border shadow-2xl backdrop-blur-sm
                p-4 flex items-start gap-3
                transform transition-all duration-300 ease-in-out
                ${isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
                ${style.bg} ${style.border}
            `}
        >
            <div className="flex-shrink-0 mt-0.5">
                {style.icon}
            </div>
            <div className="flex-1">
                <p className={`text-sm font-medium ${style.text}`}>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                </p>
                <p className="text-sm text-gray-300 mt-1 leading-relaxed">
                    {message}
                </p>
            </div>
            <button 
                onClick={handleClose}
                className="text-gray-500 hover:text-white transition-colors"
            >
                <X size={16} />
            </button>
        </div>
    );
};

export default Toast;
