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
                        // Verificar si el texto contiene una estructura de documento
                        const documentPattern = /<document>\s*<source>(.*?)<\/source>/;
                        const match = trimmedText.match(documentPattern);
                        
                        if (match && match[1]) {
                            // Si se detecta un documento, extraer el nombre del archivo
                            const sourceFileName = match[1];
                            filesInfo.push(`- ${sourceFileName} [as text plain]`); 
                        } else {
                            // Si no es un documento, tratarlo como texto normal
                            textContent.push(trimmedText);
                        }
                    }
                } else if (item.type === 'image') {
                    // Intentar extraer el nombre del archivo de los metadatos o usar un nombre genérico
                    const fileName = item.source.metadata?.file_name || 'image' + (filesInfo.length + 1) + '.' + item.source.media_type.split('/')[1];
                    filesInfo.push(`- ${fileName} [Image]`);
                } else if (item.type === 'document') {
                    // Intentar extraer el nombre del archivo de los metadatos o usar un nombre genérico
                    const fileName = item.source.metadata?.file_name || 'document' + (filesInfo.length + 1) + '.pdf';
                    filesInfo.push(`- ${fileName} [PDF Document]`);
                }
            });
            

            // Construir el displayContent combinando el texto y la información de archivos
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
            // Si es el formato antiguo (string)
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
                    } /*else if (item.type === 'image') {
                        const imagePreview = createImagePreview(item.source.data, item.source.media_type);
                        markdownDiv.appendChild(imagePreview);
                    } else if (item.type === 'document') {
                        const pdfPreview = createPDFPreview(item.source.data);
                        markdownDiv.appendChild(pdfPreview);
                    }*/
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
            // Para mensajes del usuario
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
