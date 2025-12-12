let picking = false;
let highlighter = null;
let currentElement = null;
let serverUrl = 'http://localhost:3000'; // Default, will load from storage

// Load server URL on init
chrome.storage.sync.get({ serverUrl: 'http://localhost:3000' }, (items) => {
    serverUrl = items.serverUrl.replace(/\/$/, '');
});

// Create highlighter element
function createHighlighter() {
    if (highlighter) return;
    highlighter = document.createElement('div');
    highlighter.className = 'dw-highlighter';
    document.body.appendChild(highlighter);
}

// Remove highlighter
function removeHighlighter() {
    if (highlighter && highlighter.parentNode) {
        highlighter.parentNode.removeChild(highlighter);
    }
    highlighter = null;
}

// Generate simpler selector
function generateSelector(el) {
    if (el.id) return `#${el.id}`;
    if (el === document.body) return 'body';

    let path = [];
    while (el.parentNode) {
        let tag = el.tagName.toLowerCase();
        let siblings = el.parentNode.children;

        if (el.className && typeof el.className === 'string' && el.className.trim() !== '') {
            // Use classes if they look unique enough (simplified heuristic)
            const classes = el.className.split(/\s+/).filter(c => !c.startsWith('dw-'));
            if (classes.length > 0) {
                tag += '.' + classes.join('.');
            }
        }

        if (siblings.length > 1) {
            let index = 1;
            for (let i = 0; i < siblings.length; i++) {
                if (siblings[i] === el) {
                    path.unshift(`${tag}:nth-child(${index})`);
                    break;
                }
                if (siblings[i].tagName === el.tagName) {
                    index++;
                }
            }
        } else {
            path.unshift(tag);
        }
        el = el.parentNode;
        if (el.id) {
            path.unshift(`#${el.id}`);
            return path.join(' > ');
        }
    }
    return path.join(' > ');
}


function handleMouseOver(e) {
    if (!picking) return;
    if (e.target.classList.contains('dw-highlighter') || e.target.closest('.dw-modal-overlay')) return;

    currentElement = e.target;

    // Position highlighter
    const rect = currentElement.getBoundingClientRect();
    highlighter.style.width = rect.width + 'px';
    highlighter.style.height = rect.height + 'px';
    highlighter.style.top = (rect.top + window.scrollY) + 'px';
    highlighter.style.left = (rect.left + window.scrollX) + 'px';
}

function stopPicking() {
    picking = false;
    document.removeEventListener('mouseover', handleMouseOver);
    document.removeEventListener('click', handleClick);
    document.removeEventListener('scroll', updateHighlighterPos);
    removeHighlighter();
    document.body.style.cursor = '';
}

function updateHighlighterPos() {
    if (currentElement && highlighter) {
        const rect = currentElement.getBoundingClientRect();
        highlighter.style.top = (rect.top + window.scrollY) + 'px';
        highlighter.style.left = (rect.left + window.scrollX) + 'px';
    }
}

function handleClick(e) {
    if (!picking) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.target.closest('.dw-modal-overlay')) return;

    const selector = generateSelector(currentElement);
    const text = currentElement.innerText.trim().substring(0, 100);

    stopPicking();
    showMonitorModal(selector, text);
}

function showMonitorModal(selector, text) {
    // Remove existing modal if any
    const existing = document.querySelector('.dw-modal-overlay');
    if (existing) existing.remove();

    const title = document.title || 'New Monitor';

    const modal = document.createElement('div');
    modal.className = 'dw-modal-overlay';
    modal.innerHTML = `
        <div class="dw-modal-header">
            <h3 class="dw-modal-title">New DeltaWatch</h3>
            <button class="dw-modal-close">&times;</button>
        </div>
        
        <div class="dw-input-group">
            <label class="dw-label">Name</label>
            <input type="text" class="dw-input" id="dw-name" value="${title.substring(0, 30)}">
        </div>

        <div class="dw-input-group">
            <label class="dw-label">Selector</label>
            <input type="text" class="dw-input" id="dw-selector" value="${selector}">
        </div>

        <div class="dw-input-group">
            <label class="dw-label">Preview Text</label>
            <div class="dw-preview-text">${text || '[No text content]'}</div>
        </div>

        <div class="dw-input-group">
            <label class="dw-label">Interval</label>
            <select class="dw-select" id="dw-interval">
                <option value="1m">1 Minute (Rapid)</option>
                <option value="5m">5 Minutes</option>
                <option value="30m">30 Minutes</option>
                <option value="1h" selected>1 Hour</option>
                <option value="8h">8 Hours</option>
                <option value="24h">24 Hours</option>
                <option value="1w">1 Week</option>
            </select>
        </div>

        <div class="dw-actions">
            <button class="dw-btn dw-btn-secondary" id="dw-cancel">Cancel</button>
            <button class="dw-btn dw-btn-primary" id="dw-create">Create Monitor</button>
        </div>
        <div id="dw-status" class="dw-status"></div>
    `;

    document.body.appendChild(modal);

    // Event Listeners for Modal
    modal.querySelector('.dw-modal-close').onclick = () => modal.remove();
    modal.querySelector('#dw-cancel').onclick = () => modal.remove();

    modal.querySelector('#dw-create').onclick = async () => {
        const btn = modal.querySelector('#dw-create');
        const status = modal.querySelector('#dw-status');
        btn.disabled = true;
        btn.textContent = 'Creating...';
        status.textContent = '';
        status.style.color = '#c9d1d9';

        const payload = {
            url: window.location.href,
            selector: modal.querySelector('#dw-selector').value,
            selector_text: text,
            interval: modal.querySelector('#dw-interval').value,
            type: 'text',
            name: modal.querySelector('#dw-name').value
        };

        // Send to background script to bypass Mixed Content restrictions
        try {
            const response = await chrome.runtime.sendMessage({
                action: "createMonitor",
                data: payload
            });

            if (response && response.success) {
                status.textContent = 'Monitor Created!';
                status.style.color = '#3fb950';
                setTimeout(() => modal.remove(), 1500);
            } else {
                status.textContent = 'Error: ' + (response ? response.error : 'Unknown error');
                status.style.color = '#f85149';
                btn.disabled = false;
                btn.textContent = 'Create Monitor';
            }
        } catch (e) {
            status.textContent = 'Extension Error: ' + e.message;
            status.style.color = '#f85149';
            btn.disabled = false;
            btn.textContent = 'Create Monitor';
        }
    };
}


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "togglePicker") {
        if (picking) {
            stopPicking();
        } else {
            picking = true;
            createHighlighter();
            document.body.style.cursor = 'crosshair';
            document.addEventListener('mouseover', handleMouseOver);
            document.addEventListener('click', handleClick);
            document.addEventListener('scroll', updateHighlighterPos);
            // Re-load server URL just in case
            chrome.storage.sync.get({ serverUrl: 'http://localhost:3000' }, (items) => {
                serverUrl = items.serverUrl.replace(/\/$/, '');
            });
        }
    }
});
