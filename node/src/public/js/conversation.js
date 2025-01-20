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

function updateActiveConversationId(id) {
    window.activeConversationId = id;
    activeConversationId = id;
    // Disparar un evento custom para notificar el cambio
    document.dispatchEvent(new CustomEvent('conversationChanged', { 
        detail: { id } 
    }));
    debug(`Active conversation updated: ${id}`);
}

document.addEventListener('messageComplete', async (event) => {
    const messageElement = document.querySelector('.message.incomplete');
    if (messageElement) {
        messageElement.classList.remove('incomplete');
        
        const { text } = event.detail;
        if (text && activeConversationId && conversations[activeConversationId]) {
            // Asegurarnos de que el mensaje está en el formato correcto
            const messageContent = typeof text === 'string' ? 
                [{ type: 'text', text: text }] : text;

            conversations[activeConversationId].push({ 
                role: 'assistant', 
                content: messageContent
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
    let displayMessage = message || '';
    
    // Preparar el contenido del mensaje
    const messageContent = [];

    // Añadir el texto inicial si existe
    if (message?.trim()) {
        messageContent.push({
            type: 'text',
            text: message.trim()
        });
    }

    // Procesar archivos
    if (files.size > 0) {
        debug(`Processing ${files.size} files`);
        displayMessage += displayMessage ? '\n\n' : '';
        displayMessage += 'Attached files:';
        
        for (const [filename, content] of files.entries()) {
            displayMessage += `\n- ${filename}`;
            
            // Si es un archivo nativo de Claude (PDF o imagen)
            if (content.type === 'document' || content.type === 'image') {
                messageContent.push(content);
            } else {
                // Para otros tipos de archivos, mantener el formato actual
                const textContent = typeof content === 'string' ? content : content.text;
                messageContent.push({
                    type: 'text',
                    text: `\n<document>\n<source>${filename}</source>\n<document_content>${textContent}</document_content>\n</document>`
                });
            }
        }
    }

    if (messageContent.length > 0) {
        try {
            // Si no hay conversación activa, crearla primero y esperar a que esté lista
            if (!activeConversationId) {
                debug('Creating new conversation...');
                await createNewConversation(elements);
                await new Promise(resolve => setTimeout(resolve, 100));
                debug('New conversation created and ready');
            }

            // Mostrar el mensaje después de asegurar que existe la conversación
            debug('Displaying user message...');
            appendMessage(elements, displayMessage, 'user');
            
            debug('Updating conversation with new message...');
            conversations[activeConversationId].push({
                role: 'user',
                content: messageContent
            });
            await saveConversations();

            // Limpiar el input y archivos inmediatamente después de guardar
            elements.userInput.value = '';
            elements.userInput.style.height = 'auto';
            if (window.uploadedFiles) {
                window.uploadedFiles.clear();
            }
            clearFiles(elements.uploadedFilesContainer);
            document.dispatchEvent(new Event('filesUpdated'));

            const shouldUpdateTitle = message && 
                                   message.trim().length > 0 && 
                                   !message.startsWith('===') &&
                                   !message.startsWith('```') &&
                                   !files.size > 0;
            
            if (shouldUpdateTitle) {
                updateConversationsList(elements, conversations, loadConversation, deleteConversation);
            }

            debug('Starting API request...');
            showThinkingIndicator(elements);
            await sendToAPI(messageContent, elements, conversations, activeConversationId);

        } catch (error) {
            debug(`Error sending: ${error.message}`, 'error');
            hideThinkingIndicator(elements);
            
            const errorMessage = error.message === 'OVERLOADED' 
                ? 'Claude is overloaded at the moment. Please try again later.'
                : `Error: ${error.message}`;
            
            appendMessage(elements, errorMessage, 'assistant', true);

        } finally {
            hideThinkingIndicator(elements);

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

// Primero definimos las funciones de comunicación con el servidor
async function deleteConversationFromServer(id) {
    try {
        const response = await fetch(`/api/conversations/${id}`, {
            method: 'DELETE'
        });
        if (!response.ok) {
            throw new Error(`Server responded with ${response.status}: ${await response.text()}`);
        }
        return await response.json();
    } catch (error) {
        debug(`Error in deleteConversationFromServer: ${error.message}`, 'error');
        throw error;
    }
}


// Luego las funciones de manejo de conversaciones
export async function deleteConversation(elements, id) {
    if (confirm('Are you sure you want to delete this conversation?')) {
        try {
            await deleteConversationFromServer(id);
            delete conversations[id];
            
            if (id === activeConversationId) {
                updateActiveConversationId(null);
                activeConversationId = null;
                clearChat(elements);
                
                // Disparar evento cuando no quedan conversaciones
                if (Object.keys(conversations).length === 0) {
                    document.dispatchEvent(new Event('conversationsCleared'));
                }
            }
            
            updateConversationsList(elements, conversations, loadConversation, deleteConversation);
            debug(`Conversation deleted: ${id}`);
            
        } catch (error) {
            debug(`Error deleting conversation: ${error.message}`, 'error');
            throw error;
        }
    }
}

// El resto de las funciones permanecen igual...

export async function initializeConversations(elements) {
    try {
        // Cargar conversaciones existentes
        conversations = await fetchConversations();
        
        // Si no hay conversaciones, crear una nueva
        if (Object.keys(conversations).length === 0) {
            debug('No conversations found, creating a new one...');
            await createNewConversation(elements);
        } else {
            // Si hay conversaciones, cargar la más reciente
            const mostRecentId = Object.keys(conversations)[0]; // El primero es el más reciente
            debug(`Loading most recent conversation: ${mostRecentId}`);
            loadConversation(elements, mostRecentId);
        }

        // Actualizar la lista de conversaciones
        updateConversationsList(elements, conversations, loadConversation, deleteConversation);
        return conversations;
    } catch (error) {
        debug(`Error initializing conversations: ${error.message}`, 'error');
        // Si hay un error, al menos crear una nueva conversación
        await createNewConversation(elements);
    }
}

export async function createNewConversation(elements) {
    try {
        const newId = Date.now().toString();
        conversations[newId] = [];
        updateActiveConversationId(newId);
        activeConversationId = newId;
        
        await saveConversationToServer(newId, []);
        updateConversationsList(elements, conversations, loadConversation, deleteConversation);
        clearChat(elements);
        clearFiles(elements.uploadedFilesContainer);
        
        debug(`New conversation created: ${newId}`);
        
        // Disparar evento de cambio de conversación
        document.dispatchEvent(new CustomEvent('conversationChanged', { 
            detail: { id: newId } 
        }));

    } catch (error) {
        debug(`Error creating new conversation: ${error.message}`, 'error');
        throw error;
    }
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
    updateActiveConversationId(id);
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
        
        // Container for plain text
        const plainDiv = document.createElement('div');
        plainDiv.className = 'message-content plain-content';

        // Convertir el contenido al formato de visualización
        let displayContent = '';
        let rawContent = '';

        // Si el contenido es un array (nuevo formato)
        if (Array.isArray(message.content)) {
            let filesInfo = [];
            let textContent = [];
            
            message.content.forEach(item => {
                if (item.type === 'text') {
                    const trimmedText = item.text.trim();
                    if (trimmedText) {
                        const documentPattern = /\s*(.*?)<\/source>/;
                        const match = trimmedText.match(documentPattern);
                        
                        if (match && match[1]) {
                            const sourceFileName = match[1];
                            filesInfo.push(`- ${sourceFileName} [as text plain]`); 
                        } else {
                            textContent.push(trimmedText);
                        }
                    }
                } else if (item.type === 'image') {
                    const fileName = item.source.metadata?.file_name || 'image' + (filesInfo.length + 1) + '.' + item.source.media_type.split('/')[1];
                    filesInfo.push(`- ${fileName} [Image]`);
                } else if (item.type === 'document') {
                    const fileName = item.source.metadata?.file_name || 'document' + (filesInfo.length + 1) + '.pdf';
                    filesInfo.push(`- ${fileName} [PDF Document]`);
                }
            });

            displayContent = '';
            if (textContent.length > 0) {
                displayContent = textContent.join('\n');
            }
            if (filesInfo.length > 0) {
                if (displayContent) displayContent += '\n\n';
                displayContent += 'Attached files:\n' + filesInfo.join('\n');
            }
            
            rawContent = displayContent;
        } else {
            displayContent = formatFileDisplay(message.content);
            rawContent = message.content;
        }

        markdownDiv.setAttribute('data-raw-content', rawContent);
        plainDiv.textContent = displayContent;

        // Process content based on the message role
        if (message.role === 'assistant') {
            if (Array.isArray(message.content)) {
                markdownDiv.innerHTML = '';
                message.content.forEach(item => {
                    if (item.type === 'text') {
                        const textDiv = document.createElement('div');
                        textDiv.innerHTML = parseMarkdown(item.text);
                        markdownDiv.appendChild(textDiv);
                    }
                });
            } else {
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
            }

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
            markdownDiv.innerHTML = parseMarkdown(displayContent);
        }

        messageElement.appendChild(markdownDiv);
        messageElement.appendChild(plainDiv);
        elements.chatBox.appendChild(messageElement);

        const preferredTab = getCurrentTabPreference();
        if (preferredTab === 'plain') {
            switchTab(messageElement, 'plain');
        }
    });
    
    clearFiles(elements.uploadedFilesContainer);
    autoScrollIfNearBottom(elements.chatBox);
    debug(`Conversation loaded: ${id}`);

    // Disparar evento de cambio de conversación
    document.dispatchEvent(new CustomEvent('conversationChanged', { 
        detail: { id: id } 
    }));
}

export async function saveConversations() {
    if (activeConversationId) {
        try {
            debug('Starting conversation save...');
            
            // Validate messages exists and is an array
            const messages = conversations[activeConversationId];
            if (!messages || !Array.isArray(messages)) {
                throw new Error('Invalid message structure');
            }

            // Make a backup before sending
            const payload = {
                id: activeConversationId,
                messages: [...messages]
            };

            const response = await fetch('/api/conversations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload)
            });

            const data = await response.text();

            if (!response.ok) {
                debug(`Server error: ${data}`);
                throw new Error(`Server error: ${data}`);
            }

            try {
                const jsonData = JSON.parse(data);
                debug('Conversation saved successfully');
                return jsonData;
            } catch (e) {
                debug(`Error parsing response: ${data}`);
                throw new Error('Error in server response format');
            }

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
