document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('saveSettings').addEventListener('click', saveOptions);
document.getElementById('startPicker').addEventListener('click', startPicker);

const statusDiv = document.getElementById('status');
const settingsSection = document.getElementById('settings-section');
const pickerSection = document.getElementById('picker-section');

function showStatus(msg, type = 'info') {
    statusDiv.textContent = msg;
    statusDiv.className = `status ${type}`;
    setTimeout(() => {
        statusDiv.textContent = '';
        statusDiv.className = 'status';
    }, 3000);
}

function restoreOptions() {
    chrome.storage.sync.get({
        serverUrl: 'http://localhost:3000'
    }, function (items) {
        document.getElementById('serverUrl').value = items.serverUrl;
        // Verify connection automatically? Maybe later.
        // For now assume if URL is there, show picker options
        if (items.serverUrl) {
            pickerSection.style.display = 'block';
        }
    });
}

async function saveOptions() {
    const url = document.getElementById('serverUrl').value.replace(/\/$/, ''); // Remove trailing slash

    // Simple validation
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

    // Send message to content script
    try {
        await chrome.tabs.sendMessage(tab.id, { action: "togglePicker" });
        window.close(); // Close popup so user can interact
    } catch (e) {
        // Content script might not be loaded yet in some cases (e.g. restart),
        // or on restricted pages (chrome://).
        // For MVP we assume it's injected via manifest.
        showStatus('Refresh page & try again', 'error');
    }
}
