// Ensure that uploadedFiles exists globally
window.uploadedFiles = new Map();

// Export as global for React components
window.activeConversationId = null;  // Añadido para que los componentes React tengan acceso

import { initializeDOMElements } from './dom-elements.js';
import { setupFileHandlers } from './file-handler.js';
import { initializeConversations } from './conversation.js';
import { setupUIHandlers } from './ui-manager.js';
import { loadSavedApiKey } from './api-service.js';
import { debug, initDebugPanel } from './utils.js';

function initializeReactComponents() {
    // Initialize system config component
    const systemConfigContainer = document.getElementById('system-config-container');
    if (systemConfigContainer && window.SystemConfigDialog) {
        try {
            const root = ReactDOM.createRoot(systemConfigContainer);
            root.render(React.createElement(window.SystemConfigDialog));
            debug('SystemConfigDialog initialized');
        } catch (error) {
            console.error('Error initializing SystemConfigDialog:', error); // Cambiar a console.error
            debug('Error initializing SystemConfigDialog: ' + error.message, 'error');
        }
    } else {
        console.warn('SystemConfigDialog container or component not found'); // Cambiar a console.warn
    }

    // Initialize conversation cache component
    const conversationCacheContainer = document.getElementById('conversation-cache-container');
    if (conversationCacheContainer && window.ConversationCacheDialog) {
        try {
            const root = ReactDOM.createRoot(conversationCacheContainer);
            root.render(React.createElement(window.ConversationCacheDialog));
            debug('ConversationCacheDialog initialized');
        } catch (error) {
            debug('Error initializing ConversationCacheDialog: ' + error.message, 'error');
        }
    } else {
        debug('ConversationCacheDialog container or component not found', 'warning');
    }
}

async function initializeApplication() {
    try {
        // Initialize all modules
        const elements = initializeDOMElements();
        debug('DOM elements initialized');
        
        // Initialize services
        loadSavedApiKey(elements.apiKeyInput);
        debug('API key loaded');
        
        // Set up handlers
        setupFileHandlers(elements);
        setupUIHandlers(elements);
        debug('Event handlers set up');
        
        // Initialize conversations
        await initializeConversations(elements);
        debug('Conversations initialized');
        
        // Initialize debug panel
        initDebugPanel();
        debug('Debug panel initialized');

        // Initialize React components
        initializeReactComponents();
        debug('React components initialized');
        
        // Auto-resize textarea
        elements.userInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
        });
        
        debug('Application initialization complete');
    } catch (error) {
        debug('Error during application initialization: ' + error.message, 'error');
        console.error('Application initialization failed:', error);
    }
}

// Wait for the DOM to be fully loaded
document.addEventListener('DOMContentLoaded', initializeApplication);

// Export necessary globals
window.initializeReactComponents = initializeReactComponents; // Por si necesitamos reinicializar los componentes