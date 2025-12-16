document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('saveSettings').addEventListener('click', saveOptions);
document.getElementById('pick-btn').addEventListener('click', startPicker);
document.getElementById('auto-detect-btn').addEventListener('click', startAutoDetect);
document.getElementById('loginBtn').addEventListener('click', handleLogin);
document.getElementById('logoutBtn').addEventListener('click', handleLogout);
document.getElementById('showSettingsFromLogin').addEventListener('click', () => {
    document.getElementById('login-section').style.display = 'none';
    document.getElementById('settings-section').style.display = 'block';
});

const statusDiv = document.getElementById('status');
const settingsSection = document.getElementById('settings-section');
const pickerSection = document.getElementById('picker-section');
const loginSection = document.getElementById('login-section');

// Settings Toggle
document.getElementById('settings-toggle').addEventListener('click', () => {
    if (settingsSection.style.display === 'block') {
        settingsSection.style.display = 'none';
        // restoreOptions will show login or picker
        restoreOptions();
    } else {
        settingsSection.style.display = 'block';
        pickerSection.style.display = 'none';
        loginSection.style.display = 'none';
    }
});

function showStatus(msg, type = 'info') {
    statusDiv.textContent = msg;
    statusDiv.className = `status ${type}`;
    if (type !== 'info') {
        setTimeout(() => {
            statusDiv.textContent = '';
            statusDiv.className = 'status';
        }, 5000);
    }
}

function restoreOptions() {
    chrome.storage.sync.get({
        serverUrl: 'http://localhost:3000',
        token: null,
        userEmail: null
    }, function (items) {
        document.getElementById('serverUrl').value = items.serverUrl;

        if (items.serverUrl) {
            if (items.token) {
                // We have a token, show picker
                pickerSection.style.display = 'block';
                loginSection.style.display = 'none';
                settingsSection.style.display = 'none';
                document.getElementById('logoutBtn').style.display = 'block'; // Show logout
            } else {
                // Connected to server but no token -> Show Login
                loginSection.style.display = 'block';
                pickerSection.style.display = 'none';
                settingsSection.style.display = 'none';
                document.getElementById('logoutBtn').style.display = 'none'; // Hide logout
            }
        } else {
            // No URL setup
            settingsSection.style.display = 'block';
            loginSection.style.display = 'none';
            pickerSection.style.display = 'none';
        }
    });
}

async function handleLogin() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const serverUrl = document.getElementById('serverUrl').value.replace(/\/$/, '');

    if (!email || !password) {
        showStatus('Please enter email and password', 'error');
        return;
    }

    try {
        showStatus('Logging in...', 'info');
        const res = await fetch(`${serverUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await res.json();

        if (res.ok && data.token) {
            chrome.storage.sync.set({
                token: data.token,
                userEmail: data.user.email
            }, function () {
                showStatus('Logged in successfully!', 'success');
                restoreOptions();
            });
        } else {
            showStatus(data.error || 'Login failed', 'error');
        }
    } catch (e) {
        showStatus('Network error: ' + e.message, 'error');
    }
}

function handleLogout() {
    chrome.storage.sync.remove(['token', 'userEmail'], function () {
        showStatus('Logged out', 'info');
        restoreOptions();
    });
}

async function saveOptions() {
    const url = document.getElementById('serverUrl').value.replace(/\/$/, '');
    if (!url.startsWith('http')) {
        showStatus('Invalid URL', 'error');
        return;
    }

    // Just verify connection, unauthenticated call effectively
    try {
        // We call /status to check if server is there. Monitors is protected now.
        // Or we can just assume it works and try to login?
        // Let's call /status which should be public if we implemented it, 
        // OR just save and let user try to login.

        chrome.storage.sync.set({
            serverUrl: url
        }, function () {
            showStatus('Server URL saved', 'success');
            restoreOptions(); // This will trigger login view
        });

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

    // Get token first
    chrome.storage.sync.get(['serverUrl', 'token'], async function (items) {
        const token = items.token;
        const serverUrl = items.serverUrl || 'http://localhost:3000';

        if (!token) {
            showStatus('Not Logged In', 'error');
            restoreOptions();
            return;
        }

        showStatus('Analyzing page with AI...', 'info');

        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => document.documentElement.outerHTML
            });

            const html = results[0].result;

            try {
                const userPrompt = document.getElementById('ai-prompt').value;

                const res = await fetch(`${serverUrl}/api/ai/analyze-page`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        url: tab.url,
                        html: html,
                        prompt: userPrompt
                    })
                });

                if (res.status === 401 || res.status === 403) {
                    showStatus('Session expired. Please login again.', 'error');
                    handleLogout();
                    return;
                }

                const text = await res.text();

                let data;
                try {
                    data = JSON.parse(text);
                } catch (e) {
                    throw new Error("Invalid Server Response");
                }

                if (data.data) {
                    const { name, selector, type } = data.data;

                    let frontendBase = serverUrl;
                    if (serverUrl.includes('localhost:3000')) {
                        frontendBase = serverUrl.replace('3000', '5173');
                    }

                    const editorUrl = `${frontendBase}/new?url=${encodeURIComponent(tab.url)}&name=${encodeURIComponent(name)}&selector=${encodeURIComponent(selector)}&type=${encodeURIComponent(type || 'text')}&auto=true`;

                    chrome.tabs.create({ url: editorUrl });
                    window.close();
                } else {
                    showStatus('AI found nothing.', 'error');
                }
            } catch (err) {
                showStatus('AI Error: ' + err.message, 'error');
            }

        } catch (e) {
            showStatus('Failed to capture page: ' + e.message, 'error');
        }
    });
}
