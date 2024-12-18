// Ensure that uploadedFiles exists globally
window.uploadedFiles = new Map();

import { initializeDOMElements } from './dom-elements.js';
import { setupFileHandlers } from './file-handler.js';
import { initializeConversations } from './conversation.js';
import { setupUIHandlers } from './ui-manager.js';
import { loadSavedApiKey } from './api-service.js';
import { debug, initDebugPanel } from './utils.js';

// app.js
document.addEventListener('DOMContentLoaded', async function () {
    // Initialize all modules
    const elements = initializeDOMElements();
    
    // Initialize services
    loadSavedApiKey(elements.apiKeyInput);
    
    // Set up handlers
    setupFileHandlers(elements);
    setupUIHandlers(elements);
    
    // Initialize conversations
    await initializeConversations(elements);
    
    // Initialize debug panel
    initDebugPanel();

    // Initialize system config component
    const systemConfigContainer = document.getElementById('system-config-container');
    if (systemConfigContainer && window.SystemConfigDialog) {
        const root = ReactDOM.createRoot(systemConfigContainer);
        root.render(React.createElement(window.SystemConfigDialog));
    }
    
    // Auto-resize textarea
    elements.userInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });

    debug('Application initialized');
});
