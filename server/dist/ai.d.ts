interface AnalyzePageResult {
    name: string;
    selector: string;
    type: 'text' | 'visual';
}
declare function summarizeChange(oldText: string | null, newText: string | null): Promise<string | null>;
declare function getModels(provider: string, apiKey: string | undefined, baseUrl: string | undefined): Promise<string[]>;
declare function summarizeVisualChange(oldImagePath: string | null, newImagePath: string | null, customPrompt?: string | null): Promise<string | null>;
declare function findSelector(htmlSnapshot: string, oldSelector: string, oldText: string | null, userPrompt: string | null): Promise<string | null>;
declare function analyzePage(htmlSnapshot: string, url: string, userPrompt: string | null): Promise<AnalyzePageResult | null>;
export { summarizeChange, summarizeVisualChange, getModels, findSelector, analyzePage };
//# sourceMappingURL=ai.d.ts.map