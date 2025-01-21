import { debug } from './utils.js';

export function loadSavedApiKey(apiKeyInput) {
    const savedApiKey = localStorage.getItem('claude_api_key');
    if (savedApiKey) {
        apiKeyInput.value = savedApiKey;
    }
}

function cleanContentForAPI(content) {
    if (Array.isArray(content)) {
        return content.map(item => {
            if (item.type === 'text') {
                return item;
            } else if (item.type === 'image' || item.type === 'document') {
                return {
                    type: item.type,
                    source: {
                        type: item.source.type,
                        media_type: item.source.media_type,
                        data: item.source.data
                    }
                };
            }
            return item;
        });
    }
    return content;
}

export async function sendToAPI(messageContent, elements, conversations, activeConversationId, retryCount = 0) {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 2000;

    try {
        debug('Sending request to the API...' + (retryCount > 0 ? ` (retry ${retryCount}/${MAX_RETRIES})` : ''));
        debug(`Selected model: ${elements.modelSelect.value}`);
        
        const systemConfig = await fetch('/api/system-config').then(res => res.json())
            .catch(error => {
                debug('Error fetching system config, continuing without it:', error);
                return { systemDirectives: '', cacheContext: '' };
            });

        const conversationCache = await fetch(`/api/conversations/${activeConversationId}/cache`).then(res => res.json())
            .catch(error => {
                debug('Error fetching conversation cache, continuing without it:', error);
                return { cacheText: '', cachedFiles: [] };
            });

        const requestBody = {
            model: elements.modelSelect.value,
            max_tokens: parseInt(elements.maxTokensOutput.value),
            stream: true,
            system: []
        };

        // Add system directives if they exist
        if (systemConfig.systemDirectives) {
            requestBody.system.push({
                type: "text",
                text: systemConfig.systemDirectives,
                cache_control: { type: "ephemeral" }
            });
        }
        
        if (systemConfig.cacheContext) {
            requestBody.system.push({
                type: "text",
                text: systemConfig.cacheContext,
                cache_control: { type: "ephemeral" }
            });
        }

        // Add conversation cache text if it exists
        if (conversationCache.cacheText) {
            requestBody.system.push({
                type: "text",
                text: conversationCache.cacheText,
                cache_control: { type: "ephemeral" }
            });
        }

        // Process and concatenate all cached files into a single system entry
        if (conversationCache.cachedFiles && conversationCache.cachedFiles.length > 0) {
            const nativeFiles = [];
            const textFiles = [];

            for (const file of conversationCache.cachedFiles) {
                if (!file.content) continue;

                if (file.content.type && (file.content.type === 'image' || file.content.type === 'document') && file.content.source) {
                    debug(`Processing native file: ${file.name}`, 'info');
                    const { type, source } = file.content;
                    const cleanSource = { ...source };
                    if (cleanSource.metadata) {
                        delete cleanSource.metadata;
                    }
                    nativeFiles.push({ type, source: cleanSource });
                } else {
                    const fileContent = typeof file.content === 'object' ? 
                        JSON.stringify(file.content, null, 2) : 
                        file.content;
                    textFiles.push(`File: ${file.name}\n\n${fileContent}`);
                }
            }

            // Add concatenated text files as a single entry
            if (textFiles.length > 0) {
                requestBody.system.push({
                    type: "text",
                    text: textFiles.join('\n\n---\n\n'),
                    cache_control: { type: "ephemeral" }
                });
            }

            // Add native files as a single concatenated entry
            if (nativeFiles.length > 0) {
                const concatenatedNativeFiles = nativeFiles.map(file => ({
                    ...file,
                    cache_control: { type: "ephemeral" }
                }));
                requestBody.system.push(...concatenatedNativeFiles);
            }
        }

        // Remove system array if empty
        if (requestBody.system.length === 0) {
            delete requestBody.system;
        }

        // Convert previous messages to correct format and clean metadata
        requestBody.messages = conversations[activeConversationId].map(msg => ({
            role: msg.role,
            content: cleanContentForAPI(msg.content)
        }));

        // Handle debug JSON checkbox
        const debugJsonCheckbox = document.getElementById('debug-json-checkbox');
        if (debugJsonCheckbox && debugJsonCheckbox.checked) {
            const shouldContinue = await showDebugDialog(requestBody);
            if (!shouldContinue) {
                throw new Error('Request canceled by the user');
            }
        }

        debug('Request body: ' + JSON.stringify(requestBody, null, 2));

        const response = await fetch('/proxy/claude', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': elements.apiKeyInput.value,
                'Accept': 'text/event-stream'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            debug(`Error in response: ${errorText}`, 'error');
            const incompleteMessage = document.querySelector('.message.incomplete');
            if (incompleteMessage) {
                incompleteMessage.remove();
            }
            throw new Error(errorText);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulatedMessage = '';
        let buffer = '';
        let lastResponseTime = Date.now();

        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                lastResponseTime = Date.now();

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (line.trim().startsWith('data: ')) {
                        const data = line.slice(6);
                        
                        if (data === '[DONE]') {
                            document.dispatchEvent(new CustomEvent('messageComplete', {
                                detail: { text: accumulatedMessage }
                            }));
                            return { 
                                content: [{
                                    type: 'text',
                                    text: accumulatedMessage
                                }]
                            };
                        }

                        try {
                            const parsed = JSON.parse(data);
                            debug('Received chunk:', parsed);

                            if (parsed.type === 'error' || parsed.error) {
                                const errorMessage = parsed.error?.message || parsed.message || 'Unknown error in the API';
                                debug(`Error in response: ${errorMessage}`, 'error');
                                
                                const incompleteMessage = document.querySelector('.message.incomplete');
                                if (incompleteMessage) {
                                    incompleteMessage.remove();
                                }

                                document.dispatchEvent(new CustomEvent('messageError', {
                                    detail: {
                                        error: `API Error: ${errorMessage}`,
                                        isError: true
                                    }
                                }));
                                
                                throw new Error(errorMessage);
                            }

                            if (parsed.error?.type === 'timeout_error') {
                                throw new Error(parsed.error.message);
                            }

                            if (parsed.type === 'message_start' || parsed.type === 'content_block_start') {
                                debug(`${parsed.type} received`);
                                continue;
                            }

                            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                                const newText = parsed.delta.text;
                                if (typeof accumulatedMessage === 'string') {
                                    accumulatedMessage = (accumulatedMessage || '') + newText;
                                } else {
                                    accumulatedMessage = [{
                                        type: 'text',
                                        text: newText
                                    }];
                                }
                                
                                document.dispatchEvent(new CustomEvent('messageUpdate', {
                                    detail: { 
                                        text: newText,
                                        fullText: typeof accumulatedMessage === 'string' ? 
                                                accumulatedMessage : 
                                                accumulatedMessage[0].text
                                    }
                                }));
                            }

                            if (parsed.type === 'content_block_stop' || parsed.type === 'message_stop') {
                                debug(`${parsed.type} received`);
                            }

                        } catch (e) {
                            if (!data.includes('event:')) {
                                debug(`Error parsing chunk: ${data}`, 'error');
                                const incompleteMessage = document.querySelector('.message.incomplete');
                                if (incompleteMessage) {
                                    incompleteMessage.remove();
                                }
                                throw new Error(`Error processing response: ${e.message}`);
                            }
                        }
                    }
                }

                if (Date.now() - lastResponseTime > 60000) {
                    throw new Error('Response timeout: No response received for 60 seconds');
                }
            }

            return { 
                content: [{
                    type: 'text',
                    text: accumulatedMessage
                }]
            };
            
        } catch (error) {
            debug(`Streaming error: ${error.message}`, 'error');
            const incompleteMessage = document.querySelector('.message.incomplete');
            if (incompleteMessage) {
                incompleteMessage.remove();
            }
            throw error;
        }

    } catch (error) {
        if (error.message === 'OVERLOADED' && retryCount < MAX_RETRIES) {
            debug(`Retrying in ${RETRY_DELAY/1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            return sendToAPI(messageContent, elements, conversations, activeConversationId, retryCount + 1);
        }

        const incompleteMessage = document.querySelector('.message.incomplete');
        if (incompleteMessage) {
            incompleteMessage.remove();
        }

        document.dispatchEvent(new CustomEvent('messageError', {
            detail: {
                error: error.message === 'OVERLOADED'
                    ? 'Claude is overloaded at the moment. Please try again later.'
                    : `Error communicating with the API: ${error.message}`,
                isError: true
            }
        }));

        throw error;
    }
}

async function showDebugDialog(requestBody) {
    return new Promise((resolve) => {
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #21262d;
            padding: 20px;
            border-radius: 8px;
            border: 1px solid #30363d;
            z-index: 1000;
            max-width: 80%;
            max-height: 80vh;
            overflow-y: auto;
        `;

        dialog.innerHTML = `
            <h3 style="color: #58a6ff; margin-top: 0;">Debug JSON</h3>
            <pre style="background: #0d1117; padding: 10px; border-radius: 4px; overflow-x: auto;">
${JSON.stringify(requestBody, null, 2)}
            </pre>
            <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 15px;">
                <button id="cancel-debug" style="padding: 8px 16px; border-radius: 4px; background: #da3633; color: white; border: none; cursor: pointer;">Cancel</button>
                <button id="send-debug" style="padding: 8px 16px; border-radius: 4px; background: #238636; color: white; border: none; cursor: pointer;">Send</button>
            </div>
        `;

        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 999;
        `;

        document.body.appendChild(overlay);
        document.body.appendChild(dialog);

        document.getElementById('send-debug').onclick = () => {
            overlay.remove();
            dialog.remove();
            resolve(true);
        };

        document.getElementById('cancel-debug').onclick = () => {
            overlay.remove();
            dialog.remove();
            resolve(false);
        };
    });
}