const { Pool } = require('pg');
const config = require('./db-config.js');

class DBService {
    static pool;

    static async initDB() {
        try {
            this.pool = new Pool(config);
            
            // Verificar la conexión
            const client = await this.pool.connect();
            console.log('Conexión a la base de datos establecida');

            // Crear tablas si no existen
            await this.createTableIfNotExists(client);
            
            client.release();
            return this.pool;
        } catch (error) {
            console.error('Error inicializando la base de datos:', error);
            throw error;
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
            return Object.fromEntries(
                rows.map(row => [
                    row.id, 
                    row.messages
                ])
            );
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
    
            // Convert to JSON safely, keeping all original content
            let messagesJson;
            try {
                // Use replacer to handle problematic characters specifically
                const replacer = (key, value) => {
                    if (typeof value === 'string') {
                        // Only escape characters that cause PostgreSQL error
                        return value.replace(/\u0000/g, ''); // Remove only NULL character
                    }
                    return value;
                };
    
                messagesJson = JSON.stringify(messages, replacer);
            } catch (error) {
                console.error('Error converting to JSON:', error);
                throw new Error('Error converting messages to JSON: ' + error.message);
            }
            
            const query = `
                INSERT INTO conversations (id, messages) 
                VALUES ($1, $2::jsonb)
                ON CONFLICT (id) DO UPDATE SET 
                    messages = EXCLUDED.messages,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING id
            `;
            
            const result = await client.query(query, [id, messagesJson]);
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
                config.systemDirectives,
                config.cacheContext
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
            const client = await this.pool.connect();
            const { rows } = await client.query(`
                SELECT count(*) as total_count,
                       count(*) FILTER (WHERE state = 'idle') as idle_count
                FROM pg_stat_activity 
                WHERE datname = $1
            `, [config.database]);
            client.release();
            
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
                status: 'disconnected',
                error: error.message
            };
        }
    }
}

module.exports = { DBService };