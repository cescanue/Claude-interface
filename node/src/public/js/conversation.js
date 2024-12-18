import { debug } from './utils.js';
import { clearFiles } from './file-handler.js';
import { 
    appendMessage, 
    updateConversationsList, 
    createCopyButton,
    parseMessageWithFiles,
    createFileContainer,
    autoScrollIfNearBottom,
    switchTab,
    getCurrentTabPreference,
    parseMarkdown
} from './ui-manager.js';
import { sendToAPI } from './api-service.js';



// Improved event listeners
document.addEventListener('messageComplete', async (event) => {
    const messageElement = document.querySelector('.message.incomplete');
    if (messageElement) {
        messageElement.classList.remove('incomplete');
        
        // Save the complete message in the conversation
        const { text } = event.detail;
        if (text?.trim() && activeConversationId && conversations[activeConversationId]) {
            conversations[activeConversationId].push({ 
                role: 'assistant', 
                content: text 
            });
            await saveConversations();
        }
    }
});

document.addEventListener('messageError', (event) => {
    const elements = {
        chatBox: document.getElementById('chat-box'),
        uploadedFilesContainer: document.getElementById('uploaded-files')
    };

    // Remove the thinking indicator
    const thinkingElement = document.querySelector('.thinking');
    if (thinkingElement) {
        thinkingElement.remove();
    }

    // Remove the incomplete message if it exists
    const incompleteMessage = document.querySelector('.message.incomplete');
    if (incompleteMessage) {
        incompleteMessage.classList.remove('incomplete'); // First remove the class
        incompleteMessage.remove(); // Then remove the element
    }

    // Display the error message as a new message
    appendMessage(elements, event.detail.error, 'assistant', true);

    // Clear files
    if (window.uploadedFiles) {
        window.uploadedFiles.clear();
    }
    if (elements.uploadedFilesContainer) {
        elements.uploadedFilesContainer.innerHTML = '';
    }
    document.dispatchEvent(new Event('filesUpdated'));

    // Re-enable controls
    const sendButton = document.getElementById('send-button');
    const userInput = document.getElementById('user-input');
    if (sendButton) {
        sendButton.disabled = false;
        sendButton.style.opacity = '1';
    }
    if (userInput) {
        userInput.disabled = false;
    }
});

export async function handleMessageSend(elements, message) {
    debug('Starting handleMessageSend');
    debug(`State - Message: "${message}", Files: ${window.uploadedFiles.size}`);

    if (!window.uploadedFiles) {
        window.uploadedFiles = new Map();
    }

    // Capture files before creating a new conversation
    const files = new Map(window.uploadedFiles);
    let fullMessage = message || '';
    let displayMessage = message || '';

    if (!activeConversationId) {
        await createNewConversation(elements);
    }

    if (files.size > 0) {
        debug(`Processing ${files.size} files`);
        displayMessage += displayMessage ? '\n\n' : '';
        displayMessage += 'Attached files:';
        
        files.forEach((content, filename) => {
            displayMessage += `\n- ${filename}`;
            
            // If it's a compressed file, show the summary in the display
            if (filename.toLowerCase().endsWith('.zip') || 
                filename.toLowerCase().endsWith('.rar') ||
                filename.toLowerCase().endsWith('.7z')) {
                const structureMatch = content.match(/=== COMPRESSED FILE STRUCTURE ===([\s\S]*?)(===|<file_contents)/);
                if (structureMatch) {
                    const structure = structureMatch[1].trim();
                    const fileCount = (structure.match(/📄/g) || []).length;
                    const dirCount = (structure.match(/📁/g) || []).length;
                    displayMessage += `\n  ${fileCount} files, ${dirCount} directories`;
                }
            }
        });

        // Build the message with document formatting for Claude
        fullMessage += '\n\n<documents>';
        
        files.forEach((content, filename) => {
            fullMessage += '\n<document>';
            fullMessage += `\n<source>${filename}</source>`;
            
            // For compressed files, maintain the special structure
            if (filename.toLowerCase().endsWith('.zip') || 
                filename.toLowerCase().endsWith('.rar') ||
                filename.toLowerCase().endsWith('.7z')) {
                fullMessage += `\n<document_content>${content}</document_content>`;
            } else {
                const escapedContent = content
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
                fullMessage += `\n<document_content>${escapedContent}</document_content>`;
            }
            
            fullMessage += '\n</document>';
        });
        
        fullMessage += '\n</documents>';
    }

    if (fullMessage.trim() || files.size > 0) {
        try {
            appendMessage(elements, displayMessage, 'user');
            conversations[activeConversationId].push({ 
                role: 'user', 
                content: fullMessage
            });
            await saveConversations();

            const shouldUpdateTitle = message && 
                                   message.trim().length > 0 && 
                                   !message.startsWith('===') &&
                                   !message.startsWith('```') &&
                                   !files.size > 0;
            
            if (shouldUpdateTitle) {
                updateConversationsList(elements, conversations, loadConversation, deleteConversation);
            }

            showThinkingIndicator(elements);
            await sendToAPI(fullMessage, elements, conversations, activeConversationId);

        } catch (error) {
            debug(`Error sending: ${error.message}`, 'error');
            
            // Ensure that the thinking indicator is hidden
            hideThinkingIndicator(elements);
            
            // Fallback in case the messageError event fails
            const errorElement = document.querySelector('.message.error-message');
            if (!errorElement) {
                const errorMessage = error.message === 'OVERLOADED' 
                    ? 'Claude is overloaded at the moment. Please try again later.' 
                    : 'Error communicating with the API: ' + error.message;
                
                appendMessage(elements, errorMessage, 'assistant', true);
            }

        } finally {
            // Always clear files, regardless of the outcome
            if (window.uploadedFiles) {
                window.uploadedFiles.clear();
            }
            clearFiles(elements.uploadedFilesContainer);
            document.dispatchEvent(new Event('filesUpdated'));

            // Ensure that the send button and textarea are re-enabled
            if (elements.sendButton) {
                elements.sendButton.disabled = false;
                elements.sendButton.style.opacity = '1';
            }
            if (elements.userInput) {
                elements.userInput.disabled = false;
            }
        }
    } else if (!files.size) {
        debug('No content or files to send');
        return;
    }
}

export let conversations = {};
export let activeConversationId = null;

// Functions to interact with the backend
async function fetchConversations() {
    try {
        const response = await fetch('/api/conversations');
        if (!response.ok) throw new Error('Error fetching conversations');
        const data = await response.json();
        return data;
    } catch (error) {
        debug('Error fetching conversations: ' + error.message, 'error');
        return {};
    }
}

async function saveConversationToServer(id, messages) {
    try {
        const response = await fetch('/api/conversations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
                id, 
                messages: Array.isArray(messages) ? messages : JSON.parse(messages) 
            })
        });
        if (!response.ok) throw new Error('Error saving conversation');
        return await response.json();
    } catch (error) {
        debug('Error saving conversation: ' + error.message, 'error');
        throw error;
    }
}

async function deleteConversationFromServer(id) {
    try {
        const response = await fetch(`/api/conversations/${id}`, {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error('Error deleting conversation');
        return await response.json();
    } catch (error) {
        debug('Error deleting conversation: ' + error.message, 'error');
        throw error;
    }
}

export async function initializeConversations(elements) {
    conversations = await fetchConversations();
    if (Object.keys(conversations).length === 0) {
        await createNewConversation(elements);
    }
    updateConversationsList(elements, conversations, loadConversation, deleteConversation);
    return conversations;
}

export async function createNewConversation(elements) {
    const newId = Date.now().toString();
    conversations[newId] = [];
    activeConversationId = newId;
    await saveConversationToServer(newId, []);
    updateConversationsList(elements, conversations, loadConversation, deleteConversation);
    clearChat(elements);
    clearFiles(elements.uploadedFilesContainer);
    debug(`New conversation created: ${newId}`);
}

function formatFileDisplay(originalContent) {
    if (!originalContent?.includes('<documents>')) {
        return originalContent;
    }

    const parts = originalContent.split('<documents>');
    const baseMessage = parts[0].trim();
    const documentsSection = parts[1];

    const fileNames = [];
    const regex = /<source>(.*?)<\/source>/g;
    let match;
    while ((match = regex.exec(documentsSection)) !== null) {
        fileNames.push(match[1]);
    }

    return baseMessage + 
           (baseMessage ? '\n\n' : '') + 
           'Attached files:\n' + 
           fileNames.map(name => `- ${name}`).join('\n');
}

export function loadConversation(elements, id) {
    activeConversationId = id;
    clearChat(elements);
    
    if (!conversations[id]) {
        debug(`Error: Conversation ${id} not found`, 'error');
        return;
    }

    conversations[id].forEach(message => {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${message.role}-message`;
        
        if (!message.content) {
            debug(`Warning: Message without content in conversation ${id}`, 'warning');
            return;
        }

        if (!messageElement.classList.contains('error-message')) {
            const copyButton = createCopyButton(message.content);
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

        // Container for Markdown view
        const markdownDiv = document.createElement('div');
        markdownDiv.className = 'message-content markdown-content active';
        markdownDiv.setAttribute('data-raw-content', message.content);
        
        // Container for plain text
        const plainDiv = document.createElement('div');
        plainDiv.className = 'message-content plain-content';
        const displayContent = formatFileDisplay(message.content);
        plainDiv.textContent = displayContent;//message.content;

        // Process content based on the message role
        if (message.role === 'assistant') {
            const parts = parseMessageWithFiles(message.content);
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

            // Set up the copy button
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
        } else {
            // For user messages
            const displayContent = formatFileDisplay(message.content);
            markdownDiv.innerHTML = parseMarkdown(displayContent);
        }

        messageElement.appendChild(markdownDiv);
        messageElement.appendChild(plainDiv);
        elements.chatBox.appendChild(messageElement);

        // Set active tab based on preference
        const preferredTab = getCurrentTabPreference();
        if (preferredTab === 'plain') {
            switchTab(messageElement, 'plain');
        }
    });
    
    clearFiles(elements.uploadedFilesContainer);
    autoScrollIfNearBottom(elements.chatBox);
    debug(`Conversation loaded: ${id}`);
}

export async function deleteConversation(elements, id) {
    if (confirm('Are you sure you want to delete this conversation?')) {
        await deleteConversationFromServer(id);
        delete conversations[id];
        if (id === activeConversationId) {
            activeConversationId = null;
            clearChat(elements);
        }
        updateConversationsList(elements, conversations, loadConversation, deleteConversation);
        debug(`Conversation deleted: ${id}`);
    }
}

export async function saveConversations() {
    if (activeConversationId) {
        try {
            // Ensure that messages is an array before saving
            const messages = conversations[activeConversationId];
            if (!Array.isArray(messages)) {
                throw new Error('Messages must be an array');
            }

            await saveConversationToServer(
                activeConversationId, 
                messages
            );
            debug('Conversation saved to the server');
        } catch (error) {
            debug(`Error saving conversation: ${error.message}`, 'error');
            throw error;
        }
    }
}

export function clearChat(elements) {
    elements.chatBox.innerHTML = '';
    debug('Chat cleared');
}

function showThinkingIndicator(elements) {
    const thinkingDiv = document.createElement('div');
    thinkingDiv.className = 'thinking';
    thinkingDiv.innerHTML = `
        <div class="thinking-icon"></div>
        <div class="thinking-text">Claude is thinking...</div>
    `;
    elements.chatBox.appendChild(thinkingDiv);
    elements.chatBox.scrollTop = elements.chatBox.scrollHeight;
}

function hideThinkingIndicator(elements) {
    const thinkingDiv = elements.chatBox.querySelector('.thinking');
    if (thinkingDiv) {
        thinkingDiv.remove();
    }
}
