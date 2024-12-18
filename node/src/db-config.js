module.exports = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'claude_chat',
    port: 5432,
    max: 10,
    idleTimeoutMillis: 30000
};