export function initDebugPanel() {
    const debugPanel = document.getElementById('debug-panel');
    if (!debugPanel) return;

    // Crear header y contenido
    const header = document.createElement('div');
    header.id = 'debug-panel-header';
    header.innerHTML = 'Debug Panel';
    
    const content = document.createElement('div');
    content.id = 'debug-panel-content';

    // Mover el contenido existente
    while (debugPanel.firstChild) {
        content.appendChild(debugPanel.firstChild);
    }

    debugPanel.appendChild(header);
    debugPanel.appendChild(content);

    // Variables para el arrastre
    let isMouseDown = false;
    let offsetX, offsetY;

    header.addEventListener('mousedown', function(e) {
        isMouseDown = true;
        
        const rect = debugPanel.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        
        debugPanel.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', function(e) {
        if (!isMouseDown) return;

        const x = e.clientX - offsetX;
        const y = e.clientY - offsetY;

        // Aplicar límites
        const maxX = window.innerWidth - debugPanel.offsetWidth;
        const maxY = window.innerHeight - debugPanel.offsetHeight;

        debugPanel.style.left = Math.min(Math.max(0, x), maxX) + 'px';
        debugPanel.style.top = Math.min(Math.max(0, y), maxY) + 'px';
        debugPanel.style.transform = 'none'; // Eliminar el transform inicial
    });

    document.addEventListener('mouseup', function() {
        isMouseDown = false;
        debugPanel.style.cursor = '';
    });
}

export function debug(message, type = 'info') {
    const debugContent = document.getElementById('debug-panel-content');
    if (!debugContent) return;

    // Asegurar que el tipo es una cadena
    const logType = String(type).toLowerCase();
    
    // Formatear el mensaje dependiendo de su tipo
    let formattedMessage = '';
    if (typeof message === 'string') {
        formattedMessage = message;
    } else if (typeof message === 'object') {
        try {
            formattedMessage = JSON.stringify(message, null, 2);
        } catch (e) {
            formattedMessage = String(message);
        }
    } else {
        formattedMessage = String(message);
    }
    
    // Formatear timestamp
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
    
    // Crear el elemento para el mensaje
    const debugMessage = document.createElement('div');
    debugMessage.className = `debug-message debug-${logType}`;
    
    // Estilizar según el tipo
    switch(logType) {
        case 'error':
            debugMessage.style.color = '#ff4444';
            break;
        case 'warning':
            debugMessage.style.color = '#ffbb33';
            break;
        case 'success':
            debugMessage.style.color = '#00C851';
            break;
        default:
            debugMessage.style.color = '#ffffff';
    }

    // Formatear el mensaje
    debugMessage.textContent = `[${timestamp}] [${logType.toUpperCase()}] ${formattedMessage}`;
    
    // Añadir al panel
    debugContent.appendChild(debugMessage);
    debugContent.scrollTop = debugContent.scrollHeight;

    // También logear a la consola
    const consoleMethod = logType === 'error' ? 'error' : 
                         logType === 'warning' ? 'warn' : 'log';
    console[consoleMethod](`[${logType.toUpperCase()}] ${formattedMessage}`);
}

export function validateApiKey(apiKey) {
    if (!apiKey || apiKey.trim() === '') {
        throw new Error('API key no proporcionada');
    }
    return apiKey.trim();
}

export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}