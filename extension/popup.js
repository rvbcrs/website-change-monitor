document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('saveSettings').addEventListener('click', saveOptions);
document.getElementById('pick-btn').addEventListener('click', startPicker);
document.getElementById('auto-detect-btn').addEventListener('click', startAutoDetect);

const statusDiv = document.getElementById('status');
const settingsSection = document.getElementById('settings-section');
const pickerSection = document.getElementById('picker-section');

// Settings Toggle
document.getElementById('settings-toggle').addEventListener('click', () => {
    if (settingsSection.style.display === 'block') {
        settingsSection.style.display = 'none';
    } else {
        settingsSection.style.display = 'block';
    }
});

function showStatus(msg, type = 'info') {
    statusDiv.textContent = msg;
    statusDiv.className = `status ${type}`;
    if (type !== 'info') { // Don't clear ongoing info
        setTimeout(() => {
            statusDiv.textContent = '';
            statusDiv.className = 'status';
        }, 5000);
    }
}

function restoreOptions() {
    chrome.storage.sync.get({
        serverUrl: 'http://localhost:3000'
    }, function (items) {
        document.getElementById('serverUrl').value = items.serverUrl;
        if (items.serverUrl) {
            pickerSection.style.display = 'block';
        }
    });
}

async function saveOptions() {
    const url = document.getElementById('serverUrl').value.replace(/\/$/, '');
    if (!url.startsWith('http')) {
        showStatus('Invalid URL', 'error');
        return;
    }
    try {
        const res = await fetch(`${url}/monitors`, { method: 'GET' });
        if (res.ok) {
            chrome.storage.sync.set({
                serverUrl: url
            }, function () {
                showStatus('Connected!', 'success');
                pickerSection.style.display = 'block';
                settingsSection.style.display = 'none'; // Auto-hide settings on valid save
            });
        } else {
            showStatus('Server Error', 'error');
        }
    } catch (e) {
        showStatus('Connection Failed', 'error');
    }
}

async function startPicker() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    try {
        await chrome.tabs.sendMessage(tab.id, { action: "togglePicker" });
        window.close();
    } catch (e) {
        showStatus('Refresh page & try again', 'error');
    }
}

async function startAutoDetect() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    showStatus('Analyzing page with AI...', 'info');

    try {
        // executeScript to get HTML content directly
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => document.documentElement.outerHTML
        });

        const html = results[0].result;

        chrome.storage.sync.get(['serverUrl'], async function (items) {
            const serverUrl = items.serverUrl || 'http://localhost:3000';

            try {
                const userPrompt = document.getElementById('ai-prompt').value;

                const res = await fetch(`${serverUrl}/api/ai/analyze-page`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: tab.url,
                        html: html,
                        prompt: userPrompt
                    })
                });

                const text = await res.text();
                console.log("Raw Response:", text); // Debug

                let data;
                try {
                    data = JSON.parse(text);
                } catch (e) {
                    throw new Error("Invalid Server Response: " + text.substring(0, 50));
                }

                // const data = await res.json(); // Replaced with safer parse

                if (data.data) {
                    // We found a config! Now pre-fill the creation form? 
                    // Extension usually opens the Web App to finish creation, 
                    // OR we could create it directly. 
                    // Let's create it directly for "Magic" feel, or at least open editor.
                    // Opening Editor with params is safer to verify.

                    const { name, selector, type } = data.data;

                    // Frontend URL logic:
                    // If we are on localhost:3000, use localhost:5173 for the frontend to hit Vite dev server
                    let frontendBase = serverUrl;
                    if (serverUrl.includes('localhost:3000')) {
                        frontendBase = serverUrl.replace('3000', '5173');
                    }

                    // Encode params
                    const editorUrl = `${frontendBase}/new?url=${encodeURIComponent(tab.url)}&name=${encodeURIComponent(name)}&selector=${encodeURIComponent(selector)}&type=${encodeURIComponent(type || 'text')}&auto=true`;

                    chrome.tabs.create({ url: editorUrl });
                    window.close();
                } else {
                    showStatus('AI found nothing.', 'error');
                }
            } catch (err) {
                showStatus('AI Error: ' + err.message, 'error');
            }
        });

    } catch (e) {
        showStatus('Failed to capture page: ' + e.message, 'error');
    }
}
