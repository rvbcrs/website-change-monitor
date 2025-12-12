// Background script to handle requests (avoiding Mixed Content issues)

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "createMonitor") {
        createMonitor(request.data)
            .then(data => sendResponse({ success: true, data }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Will respond asynchronously
    }
});

async function createMonitor(payload) {
    // Get server URL from storage
    const items = await chrome.storage.sync.get({ serverUrl: 'http://localhost:3000' });
    const serverUrl = items.serverUrl.replace(/\/$/, '');

    try {
        const response = await fetch(`${serverUrl}/monitors`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(errText || response.statusText);
        }

        return await response.json();
    } catch (error) {
        console.error('Fetch error:', error);
        throw error;
    }
}
