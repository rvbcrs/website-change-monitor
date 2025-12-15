import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, MousePointerClick, Play } from 'lucide-react';

interface ActionConfig {
    value: string;
    label: string;
    fields: ('value' | 'selector')[];
}

interface ScenarioStep {
    action: string;
    value?: string;
    selector?: string;
}

interface ScenarioBuilderProps {
    value: string | ScenarioStep[] | null;
    onChange: (steps: ScenarioStep[]) => void;
    onPick?: (index: number) => void;
    onRunStep?: (index: number, step: ScenarioStep) => void;
    onRunAll?: () => void;
    activeIndex?: number | null;
}

const ACTIONS: ActionConfig[] = [
    { value: 'wait', label: 'Wait (ms)', fields: ['value'] },
    { value: 'click', label: 'Click Element', fields: ['selector'] },
    { value: 'type', label: 'Type Text', fields: ['selector', 'value'] },
    { value: 'wait_selector', label: 'Wait for Selector', fields: ['selector'] },
    { value: 'scroll', label: 'Scroll (px)', fields: ['value'] },
    { value: 'key', label: 'Press Key', fields: ['value'] }
];

export default function ScenarioBuilder({ value, onChange, onPick, onRunStep, onRunAll, activeIndex }: ScenarioBuilderProps) {
    const [steps, setSteps] = useState<ScenarioStep[]>([]);
    const stepRefs = useRef<(HTMLDivElement | null)[]>([]);

    useEffect(() => {
        if (activeIndex !== null && typeof activeIndex === 'number' && stepRefs.current[activeIndex]) {
            stepRefs.current[activeIndex]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [activeIndex]);

    useEffect(() => {
        try {
            if (value) {
                const parsed = typeof value === 'string' ? JSON.parse(value) : value;
                if (Array.isArray(parsed)) {
                    setSteps(parsed);
                }
            } else {
                 setSteps([]);
            }
        } catch (e) {
            console.error("Invalid scenario JSON", e);
            setSteps([]);
        }
    }, [value]);

    const updateParent = (newSteps: ScenarioStep[]) => {
        setSteps(newSteps);
        onChange(newSteps);
    };

    const addStep = () => {
        updateParent([...steps, { action: 'wait', value: '1000' }]);
    };

    const removeStep = (index: number) => {
        const newSteps = [...steps];
        newSteps.splice(index, 1);
        updateParent(newSteps);
    };

    const updateStep = (index: number, field: keyof ScenarioStep, val: string) => {
        const newSteps = [...steps];
        newSteps[index] = { ...newSteps[index], [field]: val };
        updateParent(newSteps);
    };

    const moveStep = (index: number, direction: number) => {
        if (direction === -1 && index === 0) return;
        if (direction === 1 && index === steps.length - 1) return;
        
        const newSteps = [...steps];
        const temp = newSteps[index];
        newSteps[index] = newSteps[index + direction];
        newSteps[index + direction] = temp;
        updateParent(newSteps);
    };

    const handleActionChange = (index: number, e: ChangeEvent<HTMLSelectElement>) => {
        const newAction = e.target.value;
        updateStep(index, 'action', newAction);
        // Auto-activate picker for selector-based actions
        const config = ACTIONS.find(a => a.value === newAction);
        if (config && config.fields.includes('selector') && onPick) {
            onPick(index);
        }
    };

    return (
        <div className="bg-gray-900 p-4 rounded-lg border border-gray-700">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-gray-300 font-semibold text-sm uppercase tracking-wider">Workflow Scenario</h3>
                <div className="flex gap-2">
                    {onRunAll && (
                        <button 
                            type="button"
                            onClick={onRunAll}
                            className="flex items-center gap-1 bg-green-600 hover:bg-green-500 text-white px-2 py-1 rounded text-xs"
                            title="Run all steps on screen"
                        >
                            <Play size={14} fill="currentColor" /> Run Live
                        </button>
                    )}
                    <button 
                        type="button"
                        onClick={addStep}
                        className="flex items-center gap-1 bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded text-xs"
                    >
                        <Plus size={14} /> Add Step
                    </button>
                </div>
            </div>

            {steps.length === 0 ? (
                 <div className="text-center text-gray-500 py-4 text-sm italic">
                     No steps defined. The monitor will run normally.
                 </div>
            ) : (
                <div className="space-y-2">
                    {steps.map((step, index) => {
                        const actionConfig = ACTIONS.find(a => a.value === step.action) || ACTIONS[0];
                        
                        const isActive = index === activeIndex;
                        
                        return (
                            <div 
                                key={index} 
                                ref={el => { stepRefs.current[index] = el; }}
                                className={`flex flex-col gap-2 p-2 rounded border ${isActive ? 'bg-blue-900/40 border-blue-400 ring-1 ring-blue-400 shadow-lg' : 'bg-gray-800 border-gray-700'} relative group transition-all duration-200`}
                            >
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-500 text-xs w-6 text-center">{index + 1}</span>
                                    <select 
                                        value={step.action}
                                        onChange={(e) => handleActionChange(index, e)}
                                        className="bg-gray-900 border border-gray-600 rounded text-gray-300 text-xs p-1 focus:border-blue-500 outline-none"
                                    >
                                        {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                                    </select>
                                    
                                    {onRunStep && (
                                        <button 
                                           type="button" 
                                           onClick={() => onRunStep(index, step)}
                                           className="text-green-500 hover:text-green-400 border border-green-500/30 bg-green-500/10 p-1 rounded transition-colors shrink-0"
                                           title="Run this step live"
                                        >
                                             <Play size={12} fill="currentColor" />
                                        </button>
                                   )}
                                    <div className="flex-1"></div>

                                    <button type="button" onClick={() => moveStep(index, -1)} className="text-gray-500 hover:text-gray-300 disabled:opacity-30" disabled={index === 0}><ArrowUp size={14} /></button>
                                    <button type="button" onClick={() => moveStep(index, 1)} className="text-gray-500 hover:text-gray-300 disabled:opacity-30" disabled={index === steps.length - 1}><ArrowDown size={14} /></button>
                                    <button type="button" onClick={() => removeStep(index)} className="text-red-500 hover:text-red-400 ml-1"><Trash2 size={14} /></button>
                                </div>

                                <div className="flex flex-col gap-2 pl-8">
                                    {actionConfig.fields.includes('selector') && (
                                        <div className="flex gap-1 w-full">
                                            <input 
                                                type="text" 
                                                placeholder="Enter selector or click 'Pick' ->"
                                                value={step.selector || ''}
                                                onChange={(e) => updateStep(index, 'selector', e.target.value)}
                                                className="flex-1 bg-gray-900 border border-gray-600 rounded text-gray-300 text-xs p-1 focus:border-blue-500 outline-none font-mono min-w-0"
                                            />
                                            {onPick && (
                                                <button
                                                    type="button"
                                                    onClick={() => onPick(index)}
                                                    className="p-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded flex items-center justify-center transition-colors shrink-0"
                                                    title="Pick element from page"
                                                >
                                                    <MousePointerClick size={14} />
                                                </button>
                                            )}
                                        </div>
                                    )}
                                    {actionConfig.fields.includes('value') && (
                                        <input 
                                            type="text" 
                                            placeholder={step.action === 'wait' ? 'Milliseconds' : (step.action === 'type' ? 'Text to type...' : 'Value')}
                                            value={step.value || ''}
                                            onChange={(e) => updateStep(index, 'value', e.target.value)}
                                            className="w-full bg-gray-900 border border-gray-600 rounded text-gray-300 text-xs p-1 focus:border-blue-500 outline-none"
                                        />
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
