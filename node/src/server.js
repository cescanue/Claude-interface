// Importar fetch de forma que soporte streaming
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const express = require('express');
const cors = require('cors');
const { DBService } = require('./db-service.js');
const app = express();
const path = require('path');

// Configuración básica
app.use(cors());
app.use(express.json({ limit: '1gb' }));
app.use(express.urlencoded({ limit: '1gb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Función para esperar
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Función para intentar conectar a la base de datos
async function connectWithRetry(retries = 20, delay = 3000) {
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`Intento de conexión a la base de datos ${i + 1}/${retries}`);
            await DBService.initDB();
            console.log('Conexión exitosa a la base de datos');
            return true;
        } catch (error) {
            console.error(`Error de conexión (intento ${i + 1}/${retries}):`, error.message);
            if (i < retries - 1) {
                console.log(`Reintentando en ${delay/1000} segundos...`);
                await sleep(delay);
            }
        }
    }
    throw new Error('No se pudo conectar a la base de datos después de múltiples intentos');
}

// Middleware para logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Middleware para manejo de errores
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        error: {
            type: 'internal_error',
            message: 'Error interno del servidor',
            details: err.message
        }
    });
});

app.post('/proxy/claude', async (req, res) => {
    const isStreaming = req.body.stream === true;
    let timeoutId;

    // Función para manejar timeout
	const setupTimeout = () => {
		return setTimeout(() => {
			const timeoutError = {
				error: {
					type: 'timeout_error',
					message: 'Request exceeded the 5-minute time limit. Please try again.',
					details: 'The server is processing a large request and needs more time.'
				}
			};
			
			if (isStreaming) {
				res.write(`data: ${JSON.stringify(timeoutError)}\n\n`);
				res.end();
			} else {
				res.status(408).json(timeoutError);
			}
		}, 300000); // 5 minutes
	};

    try {
        // Validar que existe API key
        const apiKey = req.headers['x-api-key'];
        if (!apiKey) {
            return res.status(401).json({
                error: {
                    type: 'authentication_error',
                    message: 'API key no proporcionada'
                }
            });
        }

        // Validar tamaño del contenido
        const totalLength = JSON.stringify(req.body).length;
        const maxSize = 200 * 1024 * 1024; // 200MB
        if (totalLength > maxSize) {
            return res.status(413).json({
                error: {
                    type: 'content_too_large',
                    message: `El contenido supera los 200MB permitidos. Tamaño actual: ${(totalLength / (1024 * 1024)).toFixed(2)}MB`
                }
            });
        }

        // Validar estructura del body
        if (!req.body.messages || !Array.isArray(req.body.messages) || !req.body.model) {
            return res.status(400).json({
                error: {
                    type: 'invalid_request',
                    message: 'Estructura de solicitud inválida'
                }
            });
        }

        // Configurar headers según el modo
        if (isStreaming) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
        }

        console.log(`Enviando solicitud a Claude con ${(totalLength / 1024).toFixed(2)}KB de datos`);

        // Limpiar mensajes vacíos con soporte para el nuevo formato
        const cleanMessages = req.body.messages.filter(msg => {
            // Si content es un array (nuevo formato)
            if (Array.isArray(msg.content)) {
                return msg.content.some(item => {
                    if (item.type === 'text') {
                        return item.text && item.text.trim() !== '';
                    }
                    // Para otros tipos (image, document, etc.), considerarlos no vacíos
                    return true;
                });
            }
            // Si content es string (formato antiguo)
            if (typeof msg.content === 'string') {
                return msg.content.trim() !== '';
            }
            // Para cualquier otro caso, considerar no vacío
            return true;
        });

        const cleanBody = {
            ...req.body,
            messages: cleanMessages
        };

        // Configurar headers para la llamada a Claude
        const headers = {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'prompt-caching-2024-07-31'
        };

        if (isStreaming) {
            headers['accept'] = 'text/event-stream';
        }

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(cleanBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorData;
            try {
                errorData = JSON.parse(errorText);
            } catch (e) {
                errorData = { error: { message: errorText } };
            }
            console.error('Error de Claude:', errorData);
            
            // Mejorar el mensaje de error para PDFs y otros casos específicos
            if (errorText.includes('pdf') || errorText.includes('PDF')) {
                errorData.error.message = 'Error processing PDF file: ' + errorData.error.message;
            }
            
            if (isStreaming) {
                res.write(`data: ${JSON.stringify(errorData)}\n\n`);
                res.end();
            } else {
                return res.status(response.status).json({
                    error: {
                        type: errorData.error?.type || 'api_error',
                        message: errorData.error?.message || 'Error en la API de Claude',
                        details: errorData
                    }
                });
            }
            return;
        }

        if (isStreaming) {
            try {
                // Iniciar timeout
                timeoutId = setupTimeout();

                const textDecoder = new TextDecoder();
                const stream = response.body;
                let buffer = '';
                
                for await (const chunk of stream) {
                    // Resetear el timeout con cada chunk recibido
                    clearTimeout(timeoutId);
                    timeoutId = setupTimeout();

                    buffer += textDecoder.decode(chunk, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop(); // Guardar la última línea incompleta

                    for (const line of lines) {
                        if (line.trim()) {
                            // Asegurarnos de que cada línea tenga el prefijo data:
                            const dataLine = line.startsWith('data: ') ? line : `data: ${line}`;
                            res.write(`${dataLine}\n\n`);
                            
                            // Forzar el envío inmediato
                            if (res.flush) res.flush();
                        }
                    }
                }

                // Limpiar el timeout al finalizar correctamente
                clearTimeout(timeoutId);

                // Procesar cualquier dato restante en el buffer
                if (buffer.trim()) {
                    const dataLine = buffer.startsWith('data: ') ? buffer : `data: ${buffer}`;
                    res.write(`${dataLine}\n\n`);
                }

                // Enviar señal de finalización
                res.write('data: [DONE]\n\n');
                res.end();

            } catch (error) {
                clearTimeout(timeoutId);
                console.error('Error en el streaming:', error);
                res.write(`data: {"error": "Streaming error: ${error.message}"}\n\n`);
                res.end();
            }
        } else {
            // Iniciar timeout para modo no streaming
            timeoutId = setupTimeout();

            try {
                const responseText = await response.text();
                clearTimeout(timeoutId);
                console.log('Respuesta exitosa de Claude');
                
                try {
                    const data = JSON.parse(responseText);
                    res.json(data);
                } catch (e) {
                    console.error('Error parseando respuesta:', responseText);
                    res.status(500).json({
                        error: {
                            type: 'parse_error',
                            message: 'Error parseando respuesta de Claude',
                            details: e.message
                        }
                    });
                }
            } catch (error) {
                clearTimeout(timeoutId);
                throw error;
            }
        }

    } catch (error) {
        // Limpiar el timeout si existe
        if (timeoutId) clearTimeout(timeoutId);

        console.error('Error en /proxy/claude:', error);
        const errorResponse = {
            error: {
                type: 'internal_error',
                message: 'Error procesando la solicitud',
                details: error.message
            }
        };

        if (isStreaming) {
            res.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
            res.end();
        } else {
            res.status(500).json(errorResponse);
        }
    }
});

app.get('/api/conversations', async (req, res) => {
    try {
        const conversations = await DBService.getAllConversations();
        res.json(conversations);
    } catch (error) {
        console.error('Error getting conversations:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/conversations', async (req, res) => {
    try {
        console.log('Received request to save conversation');
        const { id, messages } = req.body;
        
        // Basic validations
        if (!id) {
            console.error('Missing ID in request');
            return res.status(400).json({ 
                error: 'ID is required' 
            });
        }

        if (!messages || !Array.isArray(messages)) {
            console.error('Invalid messages:', messages);
            return res.status(400).json({ 
                error: 'Messages must be an array' 
            });
        }

        // Log the request
        console.log('Saving conversation:', {
            id,
            messageCount: messages.length
        });

        // Try to save
        await DBService.saveConversation(id, messages);
        
        // Respond success
        res.json({ 
            success: true,
            id,
            messageCount: messages.length
        });

    } catch (error) {
        // Log error
        console.error('Error saving conversation:', {
            error: error.message,
            stack: error.stack
        });

        // Respond error
        res.status(500).json({
            error: 'Error saving conversation',
            details: error.message
        });
    }
});

app.post('/api/conversations', async (req, res) => {
    try {
        const { id, messages } = req.body;
        await DBService.saveConversation(id, messages);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/conversations/:id', async (req, res) => {
    try {
        await DBService.deleteConversation(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/system-config', async (req, res) => {
    try {
        const config = await DBService.getSystemConfig();
        res.json(config);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/system-config', async (req, res) => {
    try {
        const { systemDirectives, cacheContext } = req.body;
        await DBService.saveSystemConfig({
            systemDirectives,
            cacheContext
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Healthcheck endpoint
app.get('/health', async (req, res) => {
    try {
        const dbStatus = await DBService.getConnectionStatus();
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            database: dbStatus
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            error: error.message
        });
    }
});

app.get('/api/conversations/:id/cache', async (req, res) => {
    try {
        const config = await DBService.getConversationCache(req.params.id);
        res.json(config);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/conversations/:id/cache', async (req, res) => {
    try {
        const { cacheText, cachedFiles } = req.body;
        await DBService.saveConversationCache(req.params.id, {
            cacheText,
            cachedFiles
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Manejador para rutas no encontradas
app.use((req, res) => {
    res.status(404).json({
        error: {
            type: 'not_found',
            message: 'Ruta no encontrada'
        }
    });
});

// Iniciar servidor con reintentos de conexión
const PORT = process.env.PORT || 3000;

connectWithRetry()
    .then(() => {
		app.listen(PORT, '0.0.0.0', () => {
			console.log(`Server started on port ${PORT}`);
			console.log(`Start time: ${new Date().toISOString()}`);
			console.log(`Size limit configured: 1GB`); // Updated to show new limit
		});
    })
    .catch(err => {
        console.error('Error fatal:', err);
        process.exit(1);
    });