export declare function cleanValue(val: string): string;
/**
 * Convert a date to a human-readable "time ago" string.
 * @param dateParam - Date string, Date object, or null/undefined
 * @returns Human-readable string like "5m ago", "2h ago", "3d ago"
 */
export declare function timeAgo(dateParam: string | Date | null | undefined): string | null;
/**
 * Format a date string to a localized date/time string.
 * Handles ISO format and space-separated format.
 */
export declare function formatDate(dateString: string | null | undefined): string;
/**
 * Parse tags from JSON string safely.
 * @param tagsJson - JSON string like '["tag1", "tag2"]' or undefined
 * @returns Array of tag strings
 */
export declare function parseTags(tagsJson: string | undefined): string[];
/**
 * Calculate sparkline index for displaying history bars.
 * History is sorted newest-first, but we want newest on the right.
 *
 * @param barIndex - The bar position (0 = leftmost, barCount-1 = rightmost)
 * @param historyLength - Number of history items available
 * @param barCount - Total number of bars to display
 * @returns The history array index, or -1 if bar should be empty
 */
export declare function getSparklineHistoryIndex(barIndex: number, historyLength: number, barCount?: number): number;
/**
 * Get the color for a history status.
 */
export declare function getStatusColor(status: 'unchanged' | 'changed' | 'error'): string;
//# sourceMappingURL=index.d.ts.map