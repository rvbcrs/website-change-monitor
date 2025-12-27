import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import type { ReactNode } from 'react';

interface SortableMonitorCardProps {
    id: number;
    children: ReactNode;
}

export function SortableMonitorCard({ id, children }: SortableMonitorCardProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 50 : 'auto',
    };

    return (
        <div ref={setNodeRef} style={style} className="relative group/sortable">
            {/* Drag Handle */}
            <div
                {...attributes}
                {...listeners}
                className="absolute left-0 top-0 bottom-0 w-8 flex items-center justify-center cursor-grab active:cursor-grabbing opacity-0 group-hover/sortable:opacity-100 transition-opacity z-10 bg-gradient-to-r from-[#161b22] via-[#161b22] to-transparent"
            >
                <GripVertical size={18} className="text-gray-500" />
            </div>
            
            {/* Card content with left padding for drag handle */}
            <div className="pl-6">
                {children}
            </div>
        </div>
    );
}
