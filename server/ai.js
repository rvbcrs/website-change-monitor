const OpenAI = require('openai');
const db = require('./db');

function getSettings() {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM settings WHERE id = 1", (err, row) => {
            if (err) reject(err);
            else resolve(row || {});
        });
    });
}

async function summarizeChange(oldText, newText) {
    console.log("AI: summarizeChange called");
    try {
        const settings = await getSettings();
        console.log(`AI: Settings loaded. Enabled=${settings.ai_enabled}, Provider=${settings.ai_provider}, Model=${settings.ai_model}`);

        if (!settings.ai_enabled) {
            console.log("AI: Disabled in settings. Returning null.");
            return null;
        }

        const provider = settings.ai_provider || 'openai';
        const apiKey = settings.ai_api_key;
        const model = settings.ai_model || 'gpt-3.5-turbo';
        const baseUrl = settings.ai_base_url;

        // Skip if configured but missing keys (for OpenAI)
        if (provider === 'openai' && !apiKey) {
            console.log("AI: Missing API Key for OpenAI. Returning null.");
            return null;
        }

        const config = {
            apiKey: apiKey || 'ollama', // Ollama needs a key but it ignores it
        };
        if (baseUrl) {
            config.baseURL = baseUrl;
        }

        const openai = new OpenAI(config);

        // Truncate texts to avoid token limits
        // A rough estimate: 2000 chars each.
        const truncOld = (oldText || '').substring(0, 2000);
        const truncNew = (newText || '').substring(0, 2000);

        const prompt = `
You are a helpful assistant for a website change monitor.
The following is a diff of a website check.
Summarize the key changes (like price, status, content, numbers) in ONE short, natural language sentence for a notification.
Do not mention technical details like HTML tags unless relevant.
Focus on what changed for the user.

Old Content:
"${truncOld}"

New Content:
"${truncNew}"

Summary:
`;

        const requestOptions = {
            model: model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 100,
        };

        // Newer models (o1-, o3-) use max_completion_tokens instead of max_tokens
        if (model.startsWith('o1') || model.startsWith('o3')) {
            delete requestOptions.max_tokens;
            requestOptions.max_completion_tokens = 100;
        }

        let response;
        try {
            console.log(`AI: Sending request to ${model}...`);
            response = await openai.chat.completions.create(requestOptions);
        } catch (e) {
            // Compatibility retry: If max_tokens failed, try max_completion_tokens
            if (e.status === 400 && e.message && (e.message.includes('max_completion_tokens') || e.message.includes('supported parameters'))) {
                console.log("AI: Retrying with max_completion_tokens...");
                delete requestOptions.max_tokens;
                requestOptions.max_completion_tokens = 100;
                response = await openai.chat.completions.create(requestOptions);
            } else {
                throw e;
            }
        }

        const summary = response.choices[0].message.content.trim();
        console.log(`AI: Success. Summary: "${summary}"`);
        return summary;

    } catch (e) {
        console.error("AI Summary Error:", e.message);
        return `⚠️ AI Failed: ${e.message}`;
    }
}

async function getModels(provider, apiKey, baseUrl) {
    if (provider === 'openai') {
        if (!apiKey) throw new Error("API Key required for OpenAI");
        const openai = new OpenAI({ apiKey: apiKey });
        const list = await openai.models.list();
        return list.data.map(m => m.id).sort();
    } else if (provider === 'ollama') {
        // Native Ollama API: GET /api/tags
        let url = baseUrl || 'http://localhost:11434';
        // Strip /v1 if present for the native call logic, or just assume user puts base like http://localhost:11434
        if (url.endsWith('/v1')) url = url.slice(0, -3);
        if (url.endsWith('/')) url = url.slice(0, -1);

        try {
            const res = await fetch(`${url}/api/tags`);
            if (res.ok) {
                const data = await res.json();
                return data.models.map(m => m.name).sort();
            } else {
                throw new Error(`Ollama connection failed: ${res.statusText}`);
            }
        } catch (e) {
            // Fallback: try /v1/models (OpenAI compatible endpoint)
            try {
                const openai = new OpenAI({
                    apiKey: 'ollama',
                    baseURL: (baseUrl || 'http://localhost:11434') + (baseUrl?.includes('/v1') ? '' : '/v1')
                });
                const list = await openai.models.list();
                return list.data.map(m => m.id).sort();
            } catch (e2) {
                throw new Error("Could not fetch models from Ollama. Ensure it's running.");
            }
        }
    }
    return [];
}

const fs = require('fs');

async function summarizeVisualChange(oldImagePath, newImagePath, customPrompt = null) {
    console.log("AI: summarizeVisualChange called");
    try {
        const settings = await getSettings();
        if (!settings.ai_enabled) return null;

        const provider = settings.ai_provider || 'openai';
        const apiKey = settings.ai_api_key;
        const model = settings.ai_model || 'gpt-4o-mini';

        if (!apiKey && provider === 'openai') return null;

        const config = { apiKey: apiKey || 'ollama' };
        if (settings.ai_base_url) config.baseURL = settings.ai_base_url;

        const openai = new OpenAI(config);

        // Access checks
        if (!oldImagePath || !fs.existsSync(oldImagePath)) {
            console.log("AI: Old image missing, skipping visual check.");
            return null;
        }
        if (!newImagePath || !fs.existsSync(newImagePath)) {
            console.log("AI: New image missing, skipping visual check.");
            return null;
        }

        const oldImage = fs.readFileSync(oldImagePath, { encoding: 'base64' });
        const newImage = fs.readFileSync(newImagePath, { encoding: 'base64' });

        // Build a more intelligent prompt
        let prompt = `You are an expert visual change detector for a website monitoring system.

I'm showing you two screenshots of the SAME webpage taken at different times:
- IMAGE 1: The OLD/previous state
- IMAGE 2: The NEW/current state

Your task:
1. Compare both screenshots carefully
2. Identify ALL meaningful visual differences
3. Ignore irrelevant changes like: timestamps, ads, random images, minor styling flickers
4. Focus on important changes like: prices, stock status, content text, buttons, error messages, layout shifts

`;

        if (customPrompt) {
            prompt += `\nADDITIONAL CONTEXT from the user:\n"${customPrompt}"\n\n`;
        }

        prompt += `Respond with a concise summary of what changed. If nothing significant changed, say "No significant visual changes detected."
Format: Start directly with what changed, e.g. "The price changed from €299 to €249" or "A new banner appeared at the top".`;

        const response = await openai.chat.completions.create({
            model: model,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: `data:image/png;base64,${oldImage}` } },
                        { type: 'image_url', image_url: { url: `data:image/png;base64,${newImage}` } },
                    ],
                },
            ],
            max_tokens: 400,
        });

        const summary = response.choices[0].message.content.trim();
        console.log(`AI: Visual Summary: "${summary}"`);
        return summary;

    } catch (e) {
        console.error("AI Visual Summary Error:", e.message);
        // Fallback or just return error string
        return null;
    }
}

async function findSelector(htmlSnapshot, oldSelector, oldText, userPrompt) {
    console.log("AI: findSelector called for repair");
    try {
        const settings = await getSettings();
        if (!settings.ai_enabled) return null;

        const provider = settings.ai_provider || 'openai';
        const apiKey = settings.ai_api_key;
        const model = settings.ai_model || 'gpt-4o-mini';
        const baseUrl = settings.ai_base_url;

        // Skip if configured but missing keys (for OpenAI)
        if (provider === 'openai' && !apiKey) return null;

        const config = { apiKey: apiKey || 'ollama' };
        if (baseUrl) config.baseURL = baseUrl;

        const openai = new OpenAI(config);

        // Truncate HTML to be safe with tokens
        const truncHtml = (htmlSnapshot || '').substring(0, 15000); // 15k chars is generous but fits in modern context

        const prompt = `You are a CSS Selector Repair Expert.

I have a website where the layout changed, and my old CSS selector is broken.
Your task is to analyze the NEW HTML snippet and find the BEST replacement selector.

Context:
- Old Selector: "${oldSelector}"
- Previous Content: "${oldText || 'N/A'}"
- User Goal (if any): "${userPrompt || 'N/A'}"

Instructions:
1. Look for an element in the HTML that contains similar text or serves the same purpose.
2. If the old content was a price (e.g. $100), look for a price. If it was "Out of Stock", look for that.
3. Return ONLY the new CSS selector string. No markdown, no explanations.
4. If you cannot find a confident match, return "NULL".

New HTML Snippet:
${truncHtml}
`;

        const requestOptions = {
            model: model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 100,
        };

        // Newer models logic
        if (model.startsWith('o1') || model.startsWith('o3')) {
            delete requestOptions.max_tokens;
            requestOptions.max_completion_tokens = 100;
        }

        const response = await openai.chat.completions.create(requestOptions);
        let newSelector = response.choices[0].message.content.trim();

        // Clean up response if it has backticks
        newSelector = newSelector.replace(/`/g, '').replace('css', '').trim();

        if (newSelector.toUpperCase() === 'NULL' || newSelector.length === 0) {
            console.log("AI: Could not find a replacement selector.");
            return null;
        }

        console.log(`AI: Proposed Repair Selector: "${newSelector}"`);
        return newSelector;

    } catch (e) {
        console.error("AI Selector Repair Error:", e.message);
        return null;
    }
}

async function analyzePage(htmlSnapshot, url, userPrompt) {
    console.log("AI: analyzePage called");
    try {
        const settings = await getSettings();
        if (!settings.ai_enabled) return null;

        const provider = settings.ai_provider || 'openai';
        const apiKey = settings.ai_api_key;
        const model = settings.ai_model || 'gpt-4o-mini';
        const baseUrl = settings.ai_base_url;

        // Skip if configured but missing keys (for OpenAI)
        if (provider === 'openai' && !apiKey) return null;

        const config = { apiKey: apiKey || 'ollama' };
        if (baseUrl) config.baseURL = baseUrl;

        const openai = new OpenAI(config);

        const truncHtml = (htmlSnapshot || '').substring(0, 15000);

        const prompt = `You are an expert Website configuration assistant.
I have visited a URL: ${url}
I want to monitor the MOST IMPORTANT content on this page (e.g. Product Price, Stock Status, Article Title, Server Status).

Your task:
1. Analyze the HTML snippet.
2. Identify the single most relevant element to monitor.
3. Return a JSON object (and ONLY JSON) with:
   - "name": A short descriptive name (e.g. "Nintendo Switch Price")
   - "selector": The BEST, ROBUST CSS selector for that element.
   - "type": "text" (default) or "visual" (if it's a chart or complex area).

SELECTOR RULES:
- PREFER: IDs (#price), uniqe data attributes ([data-testid="price"]), or specific classes (.product-price).
- AVOID: Generic tag chains (div > div > p), :nth-child(1), or brittle structures that might break easily.
- STRICTLY VALIDATE: The class or ID you choose MUST exist in the HTML snippet provided. Do not "guess" or "clean up" the class name. If the class is "ty-product-prices", do NOT return ".product-price".
- If the element is a price, ensure the selector targets the price text specifically.

User Hint (optional): "${userPrompt || ''}"

HTML Snippet:
${truncHtml}

Response Format:
{"name": "...", "selector": "...", "type": "..."}
`;

        const requestOptions = {
            model: model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 300,
            response_format: { type: "json_object" }
        };

        // Newer models logic
        if (model.startsWith('o1') || model.startsWith('o3')) {
            delete requestOptions.max_tokens;
            delete requestOptions.response_format; // o1-preview doesn't support json_object yet mostly
            requestOptions.max_completion_tokens = 300;
        }

        const response = await openai.chat.completions.create(requestOptions);
        let content = response.choices[0].message.content.trim();

        // Clean markdown if present (e.g. ```json ... ```)
        content = content.replace(/```json/g, '').replace(/```/g, '').trim();

        console.log(`AI: Analyze Page Result: ${content}`);

        try {
            let result = JSON.parse(content);

            // Validation step
            const cheerio = require('cheerio');
            const $ = cheerio.load(htmlSnapshot);
            const selector = result.selector;

            if ($(selector).length === 0) {
                console.warn(`AI: Validation Failed. Selector "${selector}" not found in HTML.`);

                // Retry once with explicit feedback
                console.log("AI: Retrying with validation feedback...");

                const retryPrompt = prompt + `\n\nPREVIOUS ATTEMPT FAILED: The selector "${selector}" does NOT exist in the provided HTML. Please look again and return a selector that ACCURATELY matches an element in the snippet. Do not hallucinate classes.`;

                requestOptions.messages = [{ role: 'user', content: retryPrompt }];
                const retryResponse = await openai.chat.completions.create(requestOptions);
                let retryContent = retryResponse.choices[0].message.content.trim();
                retryContent = retryContent.replace(/```json/g, '').replace(/```/g, '').trim();

                console.log(`AI: Retry Result: ${retryContent}`);

                try {
                    result = JSON.parse(retryContent);
                    if ($(result.selector).length === 0) {
                        console.warn(`AI: Retry also failed for selector "${result.selector}". Returning Body fallback.`);
                        // Fallback to body to avoid "null" and let user refine
                        result.selector = 'body';
                        result.name = result.name + ' (Fallback)';
                    }
                } catch (e) {
                    console.error("AI: Retry JSON parse failed.");
                    return null;
                }
            }

            return result;
        } catch (parseErr) {
            console.error("AI: Failed to parse JSON response", content);
            return null;
        }

    } catch (e) {
        console.error("AI Analyze Page Error:", e.message);
        return null;
    }
}

module.exports = { summarizeChange, summarizeVisualChange, getModels, findSelector, analyzePage };
