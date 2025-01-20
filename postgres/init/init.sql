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

CREATE TRIGGER update_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Tabla para el caché de conversaciones
CREATE TABLE IF NOT EXISTS conversation_cache (
    conversation_id VARCHAR(50) PRIMARY KEY,
    cache_text TEXT DEFAULT '',
    cached_files JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- Trigger para actualizar el timestamp
CREATE OR REPLACE FUNCTION update_conversation_cache_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_conversation_cache_timestamp
    BEFORE UPDATE ON conversation_cache
    FOR EACH ROW
    EXECUTE FUNCTION update_conversation_cache_timestamp();