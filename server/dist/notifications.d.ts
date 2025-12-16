interface SendNotificationOptions {
    type?: 'email' | 'push' | 'webhook';
}
declare function sendNotification(subject: string, message: string, htmlMessage?: string | null, diff?: string | SendNotificationOptions | null, imagePath?: string | null): Promise<void>;
export { sendNotification };
//# sourceMappingURL=notifications.d.ts.map