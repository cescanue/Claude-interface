const { Pool } = require('pg');
const config = require('./db-config.js');

class DBService {
    static pool;

    // Función de utilidad para sanitizar el contenido
    static sanitizeContent(content) {
        if (typeof content === 'string') {
            return content.replace(/\u0000/g, '');
        }
        
        if (Array.isArray(content)) {
            return content.map(item => this.sanitizeContent(item));
        }
        
        if (typeof content === 'object' && content !== null) {
            const sanitized = {};
            for (const [key, value] of Object.entries(content)) {
                sanitized[key] = this.sanitizeContent(value);
            }
            return sanitized;
        }
        
        return content;
    }

    static async initDB() {
        let retries = 20;
        let lastError = null;
        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

        while (retries > 0) {
            try {
                if (!this.pool) {
                    this.pool = new Pool(config);
                }
                
                const client = await this.pool.connect();
                console.log('Conexión a la base de datos establecida');

                await this.createTableIfNotExists(client);
                
                client.release();
                return this.pool;
            } catch (error) {
                lastError = error;
                console.error(`Error de conexión (intento ${21 - retries}/20):`, error.message);
                
                if (this.pool) {
                    try {
                        await this.pool.end();
                    } catch (endError) {
                        console.error('Error cerrando pool:', endError);
                    }
                    this.pool = null;
                }
                
                if (retries > 1) {
                    await delay(3000);
                    retries--;
                } else {
                    throw lastError;
                }
            }
        }
    }

    static async createTableIfNotExists(client) {
        try {
            // Crear tabla de conversaciones
            const conversationsQuery = `
                CREATE TABLE IF NOT EXISTS conversations (
                    id VARCHAR(50) PRIMARY KEY,
                    messages JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT idx_updated_at UNIQUE (updated_at),
                    CONSTRAINT idx_created_at UNIQUE (created_at)
                );

                CREATE OR REPLACE FUNCTION update_updated_at_column()
                RETURNS TRIGGER AS $$
                BEGIN
                    NEW.updated_at = CURRENT_TIMESTAMP;
                    RETURN NEW;
                END;
                $$ language 'plpgsql';

                DROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;
                
                CREATE TRIGGER update_conversations_updated_at
                    BEFORE UPDATE ON conversations
                    FOR EACH ROW
                    EXECUTE FUNCTION update_updated_at_column();
            `;
            await client.query(conversationsQuery);
            console.log('Tabla conversations verificada/creada con índices');

            // Crear tabla de configuración del sistema
            const systemConfigQuery = `
                CREATE TABLE IF NOT EXISTS system_config (
                    id SERIAL PRIMARY KEY,
                    system_directives TEXT,
                    cache_context TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT system_config_updated_at_key UNIQUE (updated_at)
                );

                DROP TRIGGER IF EXISTS update_system_config_updated_at ON system_config;
                
                CREATE TRIGGER update_system_config_updated_at
                    BEFORE UPDATE ON system_config
                    FOR EACH ROW
                    EXECUTE FUNCTION update_updated_at_column();

                -- Insertar valores por defecto si la tabla está vacía
                INSERT INTO system_config (system_directives, cache_context)
                SELECT 
                    'You are my personal AI assistant named AI. Provide accurate and helpful answers, and by default, respond in Markdown. The user is interacting with you through a web interface. Strive to be concise but complete in your answers. Additionally, ensure that your responses are aesthetically pleasing, utilizing proper formatting, styling, and visual organization to enhance readability and engagement.', 
                    ''
                WHERE NOT EXISTS (SELECT 1 FROM system_config);
            `;
            await client.query(systemConfigQuery);
            console.log('Tabla system_config verificada/creada');

            // Crear tabla de caché de conversaciones
            const conversationCacheQuery = `
                CREATE TABLE IF NOT EXISTS conversation_cache (
                    conversation_id VARCHAR(50) PRIMARY KEY,
                    cache_text TEXT DEFAULT '',
                    cached_files JSONB DEFAULT '[]',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
                );

                DROP TRIGGER IF EXISTS update_conversation_cache_timestamp ON conversation_cache;

                CREATE TRIGGER update_conversation_cache_timestamp
                    BEFORE UPDATE ON conversation_cache
                    FOR EACH ROW
                    EXECUTE FUNCTION update_updated_at_column();
            `;
            await client.query(conversationCacheQuery);
            console.log('Tabla conversation_cache verificada/creada');

        } catch (error) {
            console.error('Error creando las tablas:', error);
            throw error;
        }
    }

    static async getAllConversations() {
        try {
            const { rows } = await this.pool.query(`
                SELECT 
                    id, 
                    messages, 
                    created_at,
                    updated_at 
                FROM conversations 
                ORDER BY updated_at DESC
            `);
            return Object.fromEntries(rows.map(row => [row.id, row.messages]));
        } catch (error) {
            console.error('Error obteniendo conversaciones:', error);
            return {};
        }
    }

    static async getConversationById(id) {
        try {
            const { rows } = await this.pool.query(
                'SELECT * FROM conversations WHERE id = $1',
                [id]
            );
            return rows[0];
        } catch (error) {
            console.error('Error obteniendo conversación por ID:', error);
            throw error;
        }
    }

    static async saveConversation(id, messages) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            
            console.log(`Starting conversation save ${id}`);
            
            // Ensure messages are valid
            if (!Array.isArray(messages)) {
                throw new Error('messages must be an array');
            }

            // Sanitizar los mensajes antes de guardar
            const sanitizedMessages = this.sanitizeContent(messages);
            
            const query = `
                INSERT INTO conversations (id, messages) 
                VALUES ($1, $2::jsonb)
                ON CONFLICT (id) DO UPDATE SET 
                    messages = EXCLUDED.messages,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING id
            `;
            
            const result = await client.query(query, [id, JSON.stringify(sanitizedMessages)]);
            await client.query('COMMIT');
            
            console.log(`Conversation ${id} saved successfully`);
            return result.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error in saveConversation:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    static async deleteConversation(id) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            
            const { rowCount } = await client.query(
                'DELETE FROM conversations WHERE id = $1',
                [id]
            );
            
            if (rowCount === 0) {
                throw new Error(`No se encontró la conversación con ID: ${id}`);
            }
            
            await client.query('COMMIT');
            console.log(`Conversación ${id} eliminada correctamente`);
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error eliminando conversación:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    static async deleteAllConversations() {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('DELETE FROM conversations');
            await client.query('COMMIT');
            console.log('Todas las conversaciones han sido eliminadas');
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error eliminando todas las conversaciones:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    static async getSystemConfig() {
        const client = await this.pool.connect();
        try {
            const { rows } = await client.query(
                'SELECT system_directives, cache_context FROM system_config ORDER BY updated_at DESC LIMIT 1'
            );
            return {
                systemDirectives: rows[0]?.system_directives || '',
                cacheContext: rows[0]?.cache_context || ''
            };
        } catch (error) {
            console.error('Error obteniendo configuración del sistema:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    static async saveSystemConfig(config) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            
            // Sanitizar la configuración
            const sanitizedConfig = this.sanitizeContent(config);
            
            const query = `
                INSERT INTO system_config 
                    (system_directives, cache_context)
                VALUES 
                    ($1, $2)
                ON CONFLICT ON CONSTRAINT system_config_updated_at_key 
                DO UPDATE SET
                    system_directives = EXCLUDED.system_directives,
                    cache_context = EXCLUDED.cache_context,
                    updated_at = CURRENT_TIMESTAMP
            `;
            
            await client.query(query, [
                sanitizedConfig.systemDirectives,
                sanitizedConfig.cacheContext
            ]);
            
            await client.query('COMMIT');
            console.log('Configuración del sistema guardada correctamente');
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error guardando configuración del sistema:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    static async getConnectionStatus() {
        try {
            let client;
            try {
                client = await this.pool.connect();
            } catch (error) {
                return {
                    status: 'disconnected',
                    error: `Connection failed: ${error.message}`,
                    details: error
                };
            }
            
            try {
                const { rows } = await client.query(`
                    SELECT count(*) as total_count,
                           count(*) FILTER (WHERE state = 'idle') as idle_count
                    FROM pg_stat_activity 
                    WHERE datname = $1
                `, [config.database]);
                
                return {
                    status: 'connected',
                    pool: {
                        max: this.pool.options.max,
                        totalConnections: parseInt(rows[0].total_count),
                        idleConnections: parseInt(rows[0].idle_count)
                    }
                };
            } catch (error) {
                return {
                    status: 'error',
                    error: `Query failed: ${error.message}`,
                    details: error
                };
            } finally {
                client.release();
            }
        } catch (error) {
            return {
                status: 'error',
                error: error.message,
                details: error
            };
        }
    }

    static async getConversationCache(conversationId) {
        const client = await this.pool.connect();
        try {
            const { rows } = await client.query(
                'SELECT cache_text, cached_files FROM conversation_cache WHERE conversation_id = $1',
                [conversationId]
            );
            
            if (rows.length === 0) {
                // Si no existe, crear una entrada por defecto
                await client.query(
                    'INSERT INTO conversation_cache (conversation_id, cache_text, cached_files) VALUES ($1, $2, $3)',
                    [conversationId, '', '[]']
                );
                return {
                    cacheText: '',
                    cachedFiles: []
                };
            }
            
            return {
                cacheText: rows[0].cache_text || '',
                cachedFiles: rows[0].cached_files || []
            };
        } catch (error) {
            console.error('Error getting conversation cache:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    static async saveConversationCache(conversationId, config) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            
            // Sanitizar el contenido antes de guardarlo
            const sanitizedConfig = {
                cacheText: config.cacheText ? this.sanitizeContent(config.cacheText) : '',
                cachedFiles: config.cachedFiles ? this.sanitizeContent(config.cachedFiles) : []
            };
            
            // Convertir explícitamente a JSON con manejo de errores
            let jsonStr;
            try {
                jsonStr = JSON.stringify(sanitizedConfig.cachedFiles);
            } catch (error) {
                console.error('Error stringifying cachedFiles:', error);
                throw new Error('Invalid cached files format');
            }
            
            const query = `
                INSERT INTO conversation_cache 
                    (conversation_id, cache_text, cached_files)
                VALUES 
                    ($1, $2, $3::jsonb)
                ON CONFLICT (conversation_id) 
                DO UPDATE SET
                    cache_text = EXCLUDED.cache_text,
                    cached_files = EXCLUDED.cached_files,
                    updated_at = CURRENT_TIMESTAMP
            `;
            
            await client.query(query, [
                conversationId,
                sanitizedConfig.cacheText,
                jsonStr
            ]);
            
            await client.query('COMMIT');
            console.log('Conversation cache saved successfully');
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error saving conversation cache:', error);
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = { DBService };