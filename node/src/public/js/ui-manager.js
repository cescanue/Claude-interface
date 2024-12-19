import { debug } from './utils.js';
import { handleMessageSend, createNewConversation } from './conversation.js';
import { marked } from 'https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js';

const markedOptions = {
    gfm: true, // Support for GitHub Flavored Markdown
    breaks: false,
    headerIds: false,
    mangle: false,
    sanitize: false, // You are already sanitizing with DOMPurify
    smartLists: true,
    smartypants: false,
    xhtml: false, // Consider disabling it unless you really need it
    langPrefix: 'language-', // To facilitate integration with syntax highlighters
    highlight: function(code, lang) {
        // Optional: Integrate with a syntax highlighting library like highlight.js
        return code; // Or apply highlighting here
    }
};

// Configure marked globally
window.marked.setOptions(markedOptions);

function cleanHtml(html) {
    if (!html) return '';

    return html
        // Remove line breaks between HTML elements, except within <code> and <pre>
        .replace(/>(?!<\/?(code|pre))\n+</g, '><')
        // Keep only one line break after block closures, except for <code> and <pre>
        .replace(/(<\/(?:p|div|h[1-6]|ul|ol|li|blockquote)>)\s*\n+/g, '$1\n')
        // Remove whitespace at the start and end of elements, except for <code> and <pre>
        .replace(/>(?!<\/?(code|pre))\s+([^<]*?)\s+</g, '>$2<')
        // Ensure there are no line breaks before closing tags, except for <code> and <pre>
        .replace(/\n+(?!<\/?(code|pre))([^<]*?)<\/((?:p|div|h[1-6]|ul|ol|li|blockquote))>/g, '$1</$3>')
        // Remove multiple line breaks, except within <code> and <pre>
        .replace(/\n{3,}/g, '\n\n');
}

// Helper function to use marked with consistent configuration
export function parseMarkdown(text) {
    let htmlContent = marked(text, markedOptions);
    return cleanHtml(htmlContent);
}

export function switchTab(messageElement, tab) {
    messageElement.setAttribute('data-active-tab', tab);
    messageElement.querySelectorAll('.message-tab').forEach(t => {
        t.classList.toggle('active', 
            (tab === 'markdown' && t.textContent === 'Markdown') ||
            (tab === 'plain' && t.textContent === 'Plain Text')
        );
    });
    messageElement.querySelector('.markdown-content').classList.toggle('active', tab === 'markdown');
    messageElement.querySelector('.plain-content').classList.toggle('active', tab === 'plain');
}

export function getCurrentTabPreference() {
    const lastMessage = document.querySelector('.message:last-child');
    return lastMessage ? lastMessage.getAttribute('data-active-tab') || 'markdown' : 'markdown';
}

// Model configuration information
export const MODEL_TOKENS = {
    'claude-3-5-sonnet-20241022': 8192,  // Sonnet: 8,192 max output tokens
    'claude-3-opus-20240229': 4096,      // Opus: 4,096 max output tokens
    'claude-3-5-haiku-20241022': 8192    // Haiku: 8,192 max output tokens
};

// Additional model information
export const MODEL_INFO = {
    'claude-3-5-sonnet-20241022': {
        contextWindow: 200000,
        imageSupport: true,
        description: 'Balanced model for general tasks'
    },
    'claude-3-opus-20240229': {
        contextWindow: 200000,
        imageSupport: true,
        description: 'High performance for complex tasks'
    },
    'claude-3-5-haiku-20241022': {
        contextWindow: 200000,
        imageSupport: false,
        description: 'Optimized for speed'
    }
};

// Function to set up menu collapse
function setupMenuCollapse() {
    const toggleButton = document.getElementById('toggle-menu-options');
    const menuOptions = document.getElementById('menu-options');
    const expandArrow = toggleButton.querySelector('.expand-arrow');
    const collapseArrow = toggleButton.querySelector('.collapse-arrow');
    const savedState = localStorage.getItem('menuOptionsCollapsed');
    
    function updateArrows(isCollapsed) {
        if (isCollapsed) {
            expandArrow.classList.remove('hidden');
            collapseArrow.classList.add('hidden');
        } else {
            expandArrow.classList.add('hidden');
            collapseArrow.classList.remove('hidden');
        }
    }
    
    // Set initial state from localStorage
    if (savedState === 'true') {
        menuOptions.classList.add('collapsed');
        updateArrows(true);
    } else {
        updateArrows(false);
    }
    
    toggleButton.addEventListener('click', () => {
        const isCollapsed = menuOptions.classList.contains('collapsed');
        
        // Toggle state
        menuOptions.classList.toggle('collapsed');
        
        // Update arrows
        updateArrows(menuOptions.classList.contains('collapsed'));
        
        // Save state to localStorage
        localStorage.setItem('menuOptionsCollapsed', !isCollapsed);
    });
}

function escapeHtmlContent(text) {
    if (!text) return '';
    
    const htmlEntities = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '/': '&#x2F;',
        '`': '&#x60;',
        '=': '&#x3D;'
    };

    return String(text).replace(/[&<>"'`=\/]/g, char => htmlEntities[char]);
}

export function formatCodeContent(text) {
    if (!text) return '';
    
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let result = '';

    let match;
    while ((match = codeBlockRegex.exec(text)) !== null) {
        // Add text before the code block (escaped)
        result += escapeHtmlContent(text.slice(lastIndex, match.index));
        
        // Add the formatted code block
        const [fullMatch, language, code] = match;
        result += `<pre><code class="language-${escapeHtmlContent(language)}">${escapeHtmlContent(code.trim())}</code></pre>`;
        
        lastIndex = match.index + fullMatch.length;
    }

    // Add the remaining text
    result += escapeHtmlContent(text.slice(lastIndex));
    return result;
}

export function formatMessage(text) {
    if (!text) return '';
    
    // Ensure the text starts with a line break if it does not start with a special format
    if (!/^(\s*[#*`-]|$)/.test(text)) {
        text = '\n' + text;
    }
    
    // Normalize line breaks
    text = text.replace(/\r\n/g, '\n');
    
    // Preserve initial paragraphs
    text = text.replace(/^\n*(.+?)(\n\n|\n(?=[#*`-])|$)/s, '<p>$1</p>$2');
    
    // Remove multiple blank lines
    text = text.replace(/\n\s*\n\s*\n/g, '\n\n');
    
    // Ensure bold titles have the correct format
    text = text.replace(/\*\*([^*\n]+)\*\*\s*\n/g, '**$1**\n');
    
    // Ensure lists are properly formatted
    text = text.replace(/^(\s*[-*])\s+/gm, '$1 ');
    
    // Process with marked
    text = marked(text, {
        gfm: true,
        breaks: true,
        smartLists: true,
        smartypants: false
    });
    
    // Clean excessive spaces
    text = text.replace(/<\/p>\s*<p>/g, '</p><p>');
    text = text.replace(/<\/li>\s*<li>/g, '</li><li>');
    text = text.replace(/>\s+</g, '><');
    
    // Ensure strong tags are properly spaced
    text = text.replace(/(<\/strong>)(\s*<p>)/g, '$1\n$2');
    
    return text;
}

export function parseMessageWithFiles(message) {
    const parts = [];
    const codeBlockRegex = /```([a-zA-Z]*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    // Extended list of common file extensions
    const fileExtensions = [
        // Programming languages
        'js', 'py', 'java', 'cpp', 'c', 'h', 'hpp', 'cs', 'php', 'rb', 'go', 'rs', 'swift',
        'kt', 'kts', 'scala', 'clj', 'ts', 'tsx', 'jsx', 'dart', 'lua', 'r', 'm', 'mm',
        'pl', 'pm', 'f90', 'f95', 'f03', 'for', 'f', 'lisp', 'scm', 'rkt', 'hs', 'elm',
        // Web and markup
        'html', 'htm', 'css', 'scss', 'sass', 'less', 'styl', 'svg', 'vue', 'jsx', 'tsx',
        // Data and configuration
        'json', 'yaml', 'yml', 'xml', 'toml', 'ini', 'conf', 'cfg', 'config', 'env',
        'properties', 'props', 'prefs', 'plist',
        // Documentation and text
        'md', 'markdown', 'txt', 'text', 'rst', 'asciidoc', 'adoc', 'tex', 'rtf', 'doc',
        'docx', 'pdf', 'csv', 'tsv',
        // Shell and scripts
        'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'vbs', 'awk', 'sed',
        // Others
        'sql', 'db', 'dbf', 'mdb', 'log', 'lock', 'pid', 'tmp', 'bak'
    ].join('|');

    // Improved multilingual patterns (all with global flag)
    const filePatterns = [
        // Explicit patterns in Spanish
        new RegExp(`(?:file content|content of|file|code of|source code of|contents of|implementation of|definition of)\\s+([^:\\n]+\\.(?:${fileExtensions})):\\s*$`, 'ig'),
        new RegExp(`(?:file content|content of|file|code of|source code of|contents of|implementation of|definition of)\\s+["'\`]([^"'\`\\n]+\\.(?:${fileExtensions}))["'\`]:\\s*$`, 'ig'),
        
        // Explicit patterns in English
        new RegExp(`(?:file content|content of|file|code of|source code of|contents of|implementation of|definition of)\\s+([^:\\n]+\\.(?:${fileExtensions})):\\s*$`, 'ig'),
        new RegExp(`(?:file content|content of|file|code of|source code of|contents of|implementation of|definition of)\\s+["'\`]([^"'\`\\n]+\\.(?:${fileExtensions}))["'\`]:\\s*$`, 'ig'),
        
        // Code patterns in Spanish
        new RegExp(`(?:code|implementation|definition)\\s+(?:of|for)\\s+["'\`]([^"'\`\\n]+\\.(?:${fileExtensions}))["'\`]:\\s*$`, 'ig'),
        
        // Code patterns in English
        new RegExp(`(?:code|implementation|definition)\\s+(?:of|for)\\s+["'\`]([^"'\`\\n]+\\.(?:${fileExtensions}))["'\`]:\\s*$`, 'ig'),
        
        // Patterns for files in quotes or backticks
        new RegExp(`\\b(?:file|archivo|fichero)\\s*["'\`]([^"'\`\\n]+\\.(?:${fileExtensions}))["'\`]`, 'ig'),
        
        // Simple references to files
        new RegExp(`["'\`]([^"'\`\\n]+\\.(?:${fileExtensions}))["'\`]:\\s*$`, 'ig'),
        new RegExp(`^([^:\\n]+\\.(?:${fileExtensions})):\\s*$`, 'mg'),
        new RegExp(`\`([^'\`\\n]+\\.(?:${fileExtensions}))\``, 'g')
    ];

    while ((match = codeBlockRegex.exec(message)) !== null) {
        const [fullMatch, language, codeContent] = match;
        const textBefore = message.substring(lastIndex, match.index).trim();
        let filename = null;
        let matchIndex = -1;
        let matchLength = 0;
        let hasFilePattern = false;

        // Process text before the code block
        if (textBefore) {
            // Search for file patterns in the text
            for (const pattern of filePatterns) {
                // Reset lastIndex for each pattern
                pattern.lastIndex = 0;
                
                let patternMatch;
                while ((patternMatch = pattern.exec(textBefore)) !== null) {
                    const index = patternMatch.index;
                    const matchEnd = index + patternMatch[0].length;
                    
                    // Prioritize matches near the end of the text
                    const isNearEnd = matchEnd >= textBefore.length - 20;
                    const isExplicitPattern = patternMatch[0].includes(':');
                    
                    if (index > matchIndex && (isNearEnd || isExplicitPattern)) {
                        matchIndex = index;
                        matchLength = patternMatch[0].length;
                        filename = (patternMatch[2] || patternMatch[1]).trim();
                        hasFilePattern = isExplicitPattern;
                    }
                }
            }

            // Add the text before as content
            parts.push({ type: 'text', content: textBefore });
        }

        // Determine whether to create a file or code container
        if (filename || language) {
            parts.push({
                type: 'file',
                filename: filename || `code.${language || 'txt'}`,
                content: codeContent.trim(),
                language: language || ''
            });
        } else {
            parts.push({
                type: 'text',
                content: fullMatch
            });
        }

        lastIndex = match.index + fullMatch.length;
    }

    // Process any remaining text
    if (lastIndex < message.length) {
        const remainingText = message.substring(lastIndex).trim();
        if (remainingText) {
            parts.push({ type: 'text', content: remainingText });
        }
    }

    return parts;
}

// Maintain the original createFileContainer function
export function createFileContainer(filename, content) {
    const container = document.createElement('div');
    container.className = 'file-section';
    
    const header = document.createElement('div');
    header.className = 'file-header';
    header.textContent = filename;

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'file-buttons';

    const copyButton = document.createElement('button');
    copyButton.textContent = 'Copy';
    copyButton.onclick = async () => {
        try {
            let success = false;
            
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(content);
                success = true;
            } else {
                const textArea = document.createElement('textarea');
                textArea.value = content;
                textArea.style.position = 'fixed';
                textArea.style.left = '-9999px';
                textArea.style.top = '-9999px';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                
                try {
                    success = document.execCommand('copy');
                    textArea.remove();
                } catch (err) {
                    console.error('Error copying using execCommand:', err);
                    textArea.remove();
                    throw new Error('Could not copy the text');
                }
            }

            if (success) {
                copyButton.textContent = 'Copied!';
                copyButton.style.backgroundColor = '#22c55e';
                copyButton.style.color = 'white';
            } else {
                throw new Error('Could not copy the text');
            }
            
            setTimeout(() => {
                copyButton.textContent = 'Copy';
                copyButton.style.backgroundColor = '';
                copyButton.style.color = '';
            }, 2000);
            
        } catch (err) {
            console.error('Error copying:', err);
            copyButton.textContent = 'Error copying';
            copyButton.style.backgroundColor = '#ef4444';
            copyButton.style.color = 'white';
            
            setTimeout(() => {
                copyButton.textContent = 'Copy';
                copyButton.style.backgroundColor = '';
                copyButton.style.color = '';
            }, 2000);
        }
    };

    const downloadButton = document.createElement('button');
    downloadButton.textContent = 'Download';
    downloadButton.onclick = () => {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename.split('/').pop().split('\\').pop();
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    buttonContainer.appendChild(copyButton);
    buttonContainer.appendChild(downloadButton);
    
    const contentContainer = document.createElement('div');
    contentContainer.className = 'file-content';
    contentContainer.innerHTML = formatCodeContent(content);

    container.appendChild(header);
    container.appendChild(buttonContainer);
    container.appendChild(contentContainer);

    return container;
}

export function createCopyButton(message) {
    const button = document.createElement('button');
    button.className = 'copy-button';
    button.setAttribute('data-tooltip', 'Copy message');
    
    button.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M8 4v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.242a2 2 0 0 0-.602-1.43L16.083 2.57A2 2 0 0 0 14.685 2H10a2 2 0 0 0-2 2z" />
            <path d="M16 18v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2" />
        </svg>
        <span>Copy</span>
    `;

    let timeoutId;

    button.addEventListener('click', async () => {
        try {
            // Get the plain content which is the raw text
            const messageElement = button.closest('.message');
            const plainContent = messageElement.querySelector('.plain-content');
            const textToCopy = plainContent.textContent;
            
            let success = false;

            if (navigator.clipboard && window.isSecureContext) {
                try {
                    await navigator.clipboard.writeText(textToCopy);
                    success = true;
                } catch (err) {
                    console.log('Fallback to alternative copy method');
                }
            }

            if (!success) {
                const textArea = document.createElement('textarea');
                textArea.value = textToCopy;
                textArea.style.position = 'fixed';
                textArea.style.opacity = '0';
                textArea.style.pointerEvents = 'none';
                textArea.style.left = '-9999px';
                
                document.body.appendChild(textArea);
                textArea.select();
                
                try {
                    success = document.execCommand('copy');
                    textArea.remove();
                } catch (err) {
                    console.error('Error in copy fallback:', err);
                    textArea.remove();
                    throw new Error('Could not copy the text');
                }
            }

            if (success) {
                button.classList.add('copied');
                button.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path d="M20 6L9 17l-5-5" />
                    </svg>
                    <span>Copied!</span>
                `;
            } else {
                throw new Error('Could not copy the text');
            }
            
            if (timeoutId) clearTimeout(timeoutId);
            
            timeoutId = setTimeout(() => {
                button.classList.remove('copied');
                button.innerHTML = `
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    <span>Copy</span>
                `;
            }, 2000);
            
        } catch (err) {
            console.error('Error copying:', err);
            button.innerHTML = `
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="15" y1="9" x2="9" y2="15"></line>
                    <line x1="9" y1="9" x2="15" y2="15"></line>
                </svg>
                <span>Error</span>
            `;
            
            if (timeoutId) clearTimeout(timeoutId);
            
            timeoutId = setTimeout(() => {
                button.innerHTML = `
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    <span>Copy</span>
                `;
            }, 2000);
        }
    });

    return button;
}

// Nuevas funciones para manejar la visualización de contenido nativo

function createImagePreview(imageData, mediaType) {
    const container = document.createElement('div');
    container.className = 'image-preview';
    container.style.cssText = `
        margin: 1rem 0;
        max-width: 100%;
        overflow: hidden;
        border-radius: 8px;
        border: 1px solid var(--color-border);
    `;

    const img = document.createElement('img');
    img.src = `data:${mediaType};base64,${imageData}`;
    img.style.cssText = `
        max-width: 100%;
        height: auto;
        display: block;
    `;

    container.appendChild(img);
    return container;
}

function createPDFPreview(pdfData) {
    const container = document.createElement('div');
    container.className = 'pdf-preview';
    container.style.cssText = `
        margin: 1rem 0;
        padding: 1rem;
        background: var(--color-secondary);
        border: 1px solid var(--color-border);
        border-radius: 8px;
    `;

    const icon = document.createElement('div');
    icon.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
        </svg>
    `;
    icon.style.marginBottom = '0.5rem';

    const text = document.createElement('div');
    text.textContent = 'PDF Document (Embedded)';
    text.style.color = 'var(--color-text-muted)';

    const downloadButton = document.createElement('button');
    downloadButton.className = 'btn btn-secondary';
    downloadButton.style.marginTop = '0.5rem';
    downloadButton.textContent = 'Download PDF';
    downloadButton.onclick = () => {
        const blob = new Blob([Uint8Array.from(atob(pdfData), c => c.charCodeAt(0))], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'document.pdf';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    container.appendChild(icon);
    container.appendChild(text);
    container.appendChild(downloadButton);
    return container;
}

export function appendMessage(elements, message, sender, isError = false) {
    let messageElement = elements.chatBox.querySelector('.message.incomplete');
    
    if (!messageElement) {
        messageElement = document.createElement('div');
        messageElement.classList.add('message');
        
        if (isError) {
            messageElement.classList.add('error-message');
        } else {
            messageElement.classList.add(`${sender}-message`);
            if (sender === 'assistant') {
                messageElement.classList.add('incomplete');
            }
        }

        if (!isError) {
            const copyButton = createCopyButton(message);
            messageElement.appendChild(copyButton);
            
            const tabsContainer = document.createElement('div');
            tabsContainer.className = 'message-tabs';
            
            const markdownTab = document.createElement('button');
            markdownTab.className = 'message-tab active';
            markdownTab.textContent = 'Markdown';
            markdownTab.onclick = () => switchTab(messageElement, 'markdown');
            
            const plainTab = document.createElement('button');
            plainTab.className = 'message-tab';
            plainTab.textContent = 'Plain Text';
            plainTab.onclick = () => switchTab(messageElement, 'plain');
            
            tabsContainer.appendChild(markdownTab);
            tabsContainer.appendChild(plainTab);
            messageElement.appendChild(tabsContainer);
        }

        const markdownDiv = document.createElement('div');
        markdownDiv.className = 'message-content markdown-content active';
        
        const plainDiv = document.createElement('div');
        plainDiv.className = 'message-content plain-content';
        
        messageElement.appendChild(markdownDiv);
        messageElement.appendChild(plainDiv);
        elements.chatBox.appendChild(messageElement);

        const preferredTab = getCurrentTabPreference();
        if (preferredTab === 'plain') {
            switchTab(messageElement, 'plain');
        }
    }

    const markdownDiv = messageElement.querySelector('.markdown-content');
    const plainDiv = messageElement.querySelector('.plain-content');

    // Procesar el contenido basado en su tipo
    let displayText = '';
    
    if (typeof message === 'string') {
        displayText = message;
    } else if (Array.isArray(message)) {
        // Si es un array de contenido (nuevo formato)
        message.forEach(item => {
            if (item.type === 'text') {
                displayText += (displayText ? '\n' : '') + item.text;
            } else if (item.type === 'image') {
                displayText += (displayText ? '\n' : '') + `[Image: ${item.source.media_type}]`;
            } else if (item.type === 'document' && item.source.media_type === 'application/pdf') {
                displayText += (displayText ? '\n' : '') + '[PDF Document]';
            }
        });
    }

    plainDiv.textContent = displayText;

    if (sender === 'assistant' && !isError) {
        const parts = parseMessageWithFiles(displayText);
        markdownDiv.innerHTML = '';
        
        parts.forEach(part => {
            if (part.type === 'file') {
                const fileContainer = createFileContainer(part.filename, part.content);
                markdownDiv.appendChild(fileContainer);
            } else if (part.type === 'image') {
                const imagePreview = createImagePreview(part.source.data, part.source.media_type);
                markdownDiv.appendChild(imagePreview);
            } else if (part.type === 'document' && part.source.media_type === 'application/pdf') {
                const pdfPreview = createPDFPreview(part.source.data);
                markdownDiv.appendChild(pdfPreview);
            } else {
                const textDiv = document.createElement('div');
                textDiv.innerHTML = parseMarkdown(part.content || part.text);
                markdownDiv.appendChild(textDiv);
            }
        });

        // Set up the copy button
        const copyButton = messageElement.querySelector('.copy-button');
        if (copyButton) {
            copyButton.onclick = async () => {
                try {
                    await navigator.clipboard.writeText(plainDiv.textContent);
                    copyButton.classList.add('copied');
                    setTimeout(() => copyButton.classList.remove('copied'), 2000);
                } catch (err) {
                    console.error('Error copying:', err);
                    debug(`Error copying message: ${err.message}`, 'error');
                }
            };
        }
    } else {
        markdownDiv.innerHTML = parseMarkdown(displayText);
    }

    // Auto-scroll if near bottom
    const isNearBottom = elements.chatBox.scrollHeight - elements.chatBox.scrollTop - elements.chatBox.clientHeight < 200;
    if (isNearBottom) {
        elements.chatBox.scrollTop = elements.chatBox.scrollHeight;
    }
}

export function autoScrollIfNearBottom(chatBox) {
    const threshold = 100; // 100px from the bottom
    const isNearBottom = chatBox.scrollHeight - chatBox.scrollTop - chatBox.clientHeight < threshold;
    if (isNearBottom) {
        chatBox.scrollTop = chatBox.scrollHeight;
    }
}

export function setupUIHandlers(elements) {
    // Mobile menu handling
    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.getElementById('menu');
    const overlay = document.querySelector('.sidebar-overlay');

    function toggleMenu() {
        sidebar.classList.toggle('visible');
        overlay.classList.toggle('visible');
        document.body.style.overflow = sidebar.classList.contains('visible') ? 'hidden' : '';
    }

    function hideMenu() {
        sidebar.classList.remove('visible');
        overlay.classList.remove('visible');
        document.body.style.overflow = '';
    }

    if (menuToggle && overlay) {
        menuToggle.addEventListener('click', toggleMenu);
        overlay.addEventListener('click', hideMenu);
    }

    setupMenuCollapse();
    
    // New conversation
    elements.newConversationButton.addEventListener('click', () => {
        createNewConversation(elements);
        if (window.innerWidth <= 768) {
            hideMenu();
        }
    });

    // Debug panel toggle
    elements.toggleDebugButton.addEventListener('click', () => {
        elements.debugPanel.classList.toggle('visible');
        debug('Debug panel toggled');
    });

    // API Key handling with improved validation
    elements.apiKeyInput.addEventListener('change', () => {
        const apiKey = elements.apiKeyInput.value.trim();
        if (apiKey.startsWith('sk-') || apiKey === '') {
            localStorage.setItem('claude_api_key', apiKey);
            debug('API Key updated');
        } else {
            debug('Invalid API Key - must start with sk-', 'error');
            elements.apiKeyInput.value = localStorage.getItem('claude_api_key') || '';
        }
        updateSendButtonState();
    });

    // Model change handling
    elements.modelSelect.addEventListener('change', () => {
        const selectedModel = elements.modelSelect.value;
        const maxTokens = MODEL_TOKENS[selectedModel];
        const modelInfo = MODEL_INFO[selectedModel];

        elements.maxTokensOutput.max = maxTokens;
        elements.maxTokensOutput.value = maxTokens;

        if (modelInfo.imageSupport) {
            elements.uploadButton?.removeAttribute('disabled');
            elements.fileInput?.removeAttribute('disabled');
        } else {
            elements.uploadButton?.setAttribute('disabled', 'true');
            elements.fileInput?.setAttribute('disabled', 'true');
        }

        debug(`Tokens updated to ${maxTokens} for model ${selectedModel}`);
        debug(`Context window: ${modelInfo.contextWindow} tokens`);
        debug(`Image support: ${modelInfo.imageSupport}`);
    });

    // Token validation
    elements.maxTokensOutput.addEventListener('input', function() {
        const maxTokens = MODEL_TOKENS[elements.modelSelect.value];
        const value = parseInt(this.value);
        
        if (isNaN(value) || value < 1) {
            this.value = 1;
        } else if (value > maxTokens) {
            this.value = maxTokens;
            debug(`Token value adjusted to the maximum allowed: ${maxTokens}`);
        }
    });

    // Message sending handling
    elements.sendButton.addEventListener('click', () => {
        const message = elements.userInput.value.trim();
        const hasFiles = window.uploadedFiles && window.uploadedFiles.size > 0;
        
        if (message || hasFiles) {
            handleMessageSend(elements, message);
            elements.userInput.value = '';
            elements.userInput.style.height = 'auto';
            elements.sendButton.disabled = true;
            elements.sendButton.style.opacity = '0.5';
        } else {
            debug('No content to send');
        }
    });

    // Enter to send (with shift+enter for new line)
    elements.userInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            elements.sendButton.click();
        }
    });

    // Auto-resize of the textarea
    elements.userInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        updateSendButtonState();
    });

    // Function to update the send button state
    function updateSendButtonState() {
        const hasMessage = elements.userInput.value.trim().length > 0;
        const hasFiles = window.uploadedFiles && window.uploadedFiles.size > 0;
        const isValidApiKey = elements.apiKeyInput.value.trim().startsWith('sk-');
        
        const canSend = (hasMessage || hasFiles) && isValidApiKey;
        
        elements.sendButton.disabled = !canSend;
        elements.sendButton.style.opacity = canSend ? '1' : '0.5';
        
        if (!isValidApiKey && (hasMessage || hasFiles)) {
            debug('A valid API key is required to send messages', 'error');
        }
    }

    // Observer for changes in uploaded files
    const uploadedFilesObserver = new MutationObserver(updateSendButtonState);

    if (elements.uploadedFilesContainer) {
        uploadedFilesObserver.observe(elements.uploadedFilesContainer, {
            childList: true,
            subtree: true
        });
    }

    // Additional events for button update
    elements.userInput.addEventListener('input', updateSendButtonState);
    elements.apiKeyInput.addEventListener('input', updateSendButtonState);
    document.addEventListener('filesUpdated', updateSendButtonState);

    // Close menu when selecting a conversation on mobile
    const conversationsList = document.getElementById('conversations-list');
    if (conversationsList) {
        conversationsList.addEventListener('click', (e) => {
            if (window.innerWidth <= 768) {
                hideMenu();
            }
        });
    }

    // Debug JSON toggle
    if (elements.debugJsonCheckbox) {
        elements.debugJsonCheckbox.addEventListener('change', function() {
            debug(`Debug JSON ${this.checked ? 'enabled' : 'disabled'}`);
        });
    }

    // Initial token configuration
    const selectedModel = elements.modelSelect.value;
    const initialMaxTokens = MODEL_TOKENS[selectedModel];
    elements.maxTokensOutput.max = initialMaxTokens;
    elements.maxTokensOutput.value = initialMaxTokens;
    debug(`Initial tokens set to ${initialMaxTokens} for model ${selectedModel}`);

    // Initial call to set states
    updateSendButtonState();
}

// Function to extract plain text from HTML content
function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
}

// Function to decode HTML entities
function decodeHtmlEntities(text) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
}

// Function to get a readable title for the conversation
// En ui-manager.js, modificar la función getConversationTitle
function getConversationTitle(messages) {
    if (!messages || messages.length === 0) return 'New conversation';
    
    const firstUserMessage = messages.find(m => m.role === 'user');
    if (!firstUserMessage) return 'New conversation';

    // Obtener el texto del primer mensaje
    const textContent = firstUserMessage.content.find(c => c.type === 'text');
    if (!textContent || !textContent.text) return 'New conversation';

    // Decodificar y limpiar el texto
    let decodedMessage = decodeHtmlEntities(textContent.text);
    
    // Remover marcado especial
    const strippedMessage = decodedMessage.replace(/<[^>]*>/g, '')
                                        .replace(/```[\s\S]*?```/g, '')
                                        .replace(/\[.*?\]/g, '')
                                        .replace(/=== .*? ===/g, '');

    const cleanMessage = strippedMessage.replace(/\s+/g, ' ').trim();
    
    if (!cleanMessage || cleanMessage.length < 3) {
        return 'New conversation';
    }

    return cleanMessage;
}

// Update conversations list
export function updateConversationsList(elements, conversations, loadConversation, deleteConversation) {
    elements.conversationsList.innerHTML = '';
    Object.entries(conversations).forEach(([id, messages]) => {
        const conversationDiv = document.createElement('div');
        conversationDiv.className = 'conversation-item';

        const button = document.createElement('button');
        button.className = 'conversation-button';
        
        // Get a readable title
        const title = getConversationTitle(messages);
        button.textContent = truncateText(title, 30); // Increased to 30 characters for more context
        
        button.addEventListener('click', () => loadConversation(elements, id));

        const deleteButton = document.createElement('button');
        deleteButton.className = 'delete-button';
        deleteButton.textContent = '×';
        deleteButton.title = 'Delete conversation';
        deleteButton.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteConversation(elements, id);
        });

        conversationDiv.appendChild(button);
        conversationDiv.appendChild(deleteButton);
        elements.conversationsList.appendChild(conversationDiv);
    });
}

// Helper function to truncate text
function truncateText(text, maxLength = 20) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

// Function to show thinking indicator
export function showThinkingIndicator(elements) {
    const thinkingDiv = document.createElement('div');
    thinkingDiv.className = 'thinking';
    thinkingDiv.innerHTML = `
        <div class="thinking-icon"></div>
        <div class="thinking-text">Claude is thinking...</div>
    `;
    elements.chatBox.appendChild(thinkingDiv);
    elements.chatBox.scrollTop = elements.chatBox.scrollHeight;
}

// Function to hide thinking indicator
export function hideThinkingIndicator(elements) {
    const thinkingDiv = elements.chatBox.querySelector('.thinking');
    if (thinkingDiv) {
        thinkingDiv.remove();
    }
}

document.addEventListener('messageUpdate', (event) => {
    const elements = {
        chatBox: document.getElementById('chat-box'),
        uploadedFilesContainer: document.getElementById('uploaded-files')
    };

    const { text, fullText } = event.detail;
    
    let messageElement = elements.chatBox.querySelector('.message.incomplete');
    if (!messageElement) {
        hideThinkingIndicator(elements);
        appendMessage(elements, text, 'assistant');
    } else {
        const markdownDiv = messageElement.querySelector('.markdown-content');
        const plainDiv = messageElement.querySelector('.plain-content');
        if (markdownDiv && plainDiv) {
            markdownDiv.setAttribute('data-raw-content', fullText);
            plainDiv.textContent = fullText;
            
            const parts = parseMessageWithFiles(fullText);
            markdownDiv.innerHTML = '';
            
            parts.forEach(part => {
                if (part.type === 'file') {
                    const fileContainer = createFileContainer(part.filename, part.content);
                    markdownDiv.appendChild(fileContainer);
                } else {
                    const textDiv = document.createElement('div');
                    textDiv.innerHTML = parseMarkdown(part.content);
                    markdownDiv.appendChild(textDiv);
                }
            });

            const copyButton = messageElement.querySelector('.copy-button');
            if (copyButton) {
                copyButton.onclick = async () => {
                    try {
                        const plainContent = messageElement.querySelector('.plain-content');
                        await navigator.clipboard.writeText(plainContent.textContent);
                        copyButton.classList.add('copied');
                        setTimeout(() => copyButton.classList.remove('copied'), 2000);
                    } catch (err) {
                        console.error('Error copying:', err);
                        debug(`Error copying message: ${err.message}`, 'error');
                    }
                };
            }
            
            const isNearBottom = elements.chatBox.scrollHeight - elements.chatBox.scrollTop - elements.chatBox.clientHeight < 100;
            if (isNearBottom) {
                elements.chatBox.scrollTop = elements.chatBox.scrollHeight;
            }
        }
    }
});

function decodeHtml(html) {
    const txt = document.createElement('textarea');
    txt.innerHTML = html;
    return txt.value;
}
