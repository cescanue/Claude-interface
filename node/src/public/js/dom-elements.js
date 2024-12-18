export function initializeDOMElements() {
    return {
        chatBox: document.getElementById('chat-box'),
        userInput: document.getElementById('user-input'),
        sendButton: document.getElementById('send-button'),
        newConversationButton: document.getElementById('new-conversation'),
        conversationsList: document.getElementById('conversations-list'),
        modelSelect: document.getElementById('model-select'),
        debugPanel: document.getElementById('debug-panel'),
        toggleDebugButton: document.getElementById('toggle-debug'),
        apiKeyInput: document.getElementById('api-key-input'),
        fileInput: document.getElementById('file-input'),
        uploadButton: document.getElementById('upload-button'),
        uploadedFilesContainer: document.getElementById('uploaded-files'),
        maxTokensOutput: document.getElementById('max-tokens-output')
    };
}