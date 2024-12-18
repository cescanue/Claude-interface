# 🚀 Claude Advanced Interface Platform

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker)](https://www.docker.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-336791?style=for-the-badge&logo=postgresql)](https://www.postgresql.org/)
[![Node.js](https://img.shields.io/badge/Node.js-Powered-339933?style=for-the-badge&logo=node.js)](https://nodejs.org/)

## 🌟 Purpose & Vision

A powerful and elegant web interface for Claude AI that combines enterprise-grade functionality with seamless user experience. Built to maximize the potential of Claude's API while ensuring security and efficiency.

### Why This Platform Exists

1. **File Processing Power**: Process files up to 200MB directly in your browser, supporting multiple formats while maintaining privacy and security.

2. **Enterprise Architecture**: Built on PostgreSQL and Docker, ensuring robust data persistence and easy deployment.

3. **Streamlined Communication**: Real-time streaming responses and persistent conversation storage.

4. **Developer Friendly**: Comprehensive debugging tools and system configuration options.

### Core Features & Capabilities

#### File Processing
- Browser-based file processing
- Support for multiple formats:
  - PDF with text extraction
  - Word documents (.docx)
  - Excel spreadsheets (.xlsx)
  - Compressed files (ZIP, RAR)
- Structure visualization for archives
- Code syntax highlighting

#### Interface Features
- Real-time streaming responses
- Dark mode interface
- Markdown rendering
- Code highlighting
- Conversation history
- Debug panel

#### Data Management
- PostgreSQL storage with JSONB
- Conversation persistence
- System configuration storage
- Efficient query handling

## 🚀 Getting Started

### Prerequisites
```bash
- Docker & Docker Compose
- Claude API key (starts with sk-)
```

### Installation
```bash
git clone [repository-url]
cd claude-chat-interface/Docker
make setup  # Create necessary structures
make all    # Build and start containers
```

### Quick Access
```plaintext
http://localhost:3000
```

## 📘 User Guide

### File Processing
```plaintext
Supported Formats:
- PDF documents
- Word (.docx)
- Excel (.xlsx)
- Archives (ZIP, RAR)
- Code files
```

### System Configuration
```javascript
Available Models:
- claude-3-sonnet
- claude-3-opus
- claude-3-haiku
```

### Debug Features
- JSON request inspection
- API communication logs
- Response monitoring

### Best Practices
```plaintext
Files:
✓ Clean, formatted documents
✓ Organized archives
✓ Standard encodings
✗ Avoid password-protected files

Performance:
✓ Optimize large files
✓ Process related files together
✓ Monitor file sizes
```

## 🔬 Technical Implementation

### File Processing System
```javascript
// Implementación real de file-processor.js
async function processFile(file) {
    try {
        const fileType = file.type;
        const fileName = file.name.toLowerCase();
        
        // PDF Processing
        if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) {
            const arrayBuffer = await file.arrayBuffer();
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
            let fullText = '';
            
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                fullText += textContent.items.map(item => item.str).join(' ') + '\n';
            }
            
            return { 
                text: fullText,
                type: 'text'
            };
        }
        
        // Archive Processing
        if (fileName.endsWith('.zip') || fileName.endsWith('.rar')) {
            const zip = new JSZip();
            const arrayBuffer = await file.arrayBuffer();
            const zipContent = await zip.loadAsync(arrayBuffer);
            
            let fileStructure = "\n=== COMPRESSED FILE STRUCTURE ===\n";
            for (const path of Object.keys(zipContent.files)) {
                fileStructure += `📄 ${path}\n`;
            }
            
            return { text: fileStructure, type: 'text' };
        }
    } catch (error) {
        debug(`Error processing file: ${error.message}`, 'error');
        throw error;
    }
}
```

### Database Integration
```javascript
// Implementación real de db-service.js
class DBService {
    static async initDB() {
        try {
            this.pool = new Pool(config);
            await this.createTableIfNotExists();
            return this.pool;
        } catch (error) {
            console.error('Error initializing database:', error);
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
                rows.map(row => [row.id, row.messages])
            );
        } catch (error) {
            console.error('Error getting conversations:', error);
            return {};
        }
    }

    static async saveConversation(id, messages) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const query = `
                INSERT INTO conversations (id, messages) 
                VALUES ($1, $2::jsonb)
                ON CONFLICT (id) DO UPDATE SET 
                    messages = EXCLUDED.messages,
                    updated_at = CURRENT_TIMESTAMP
            `;
            await client.query(query, [id, messages]);
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}
```

### API Integration
```javascript
// Implementación real de api-service.js
async function sendToAPI(message, elements) {
    try {
        const requestBody = {
            model: elements.modelSelect.value,
            max_tokens: parseInt(elements.maxTokensOutput.value),
            stream: true,
            messages: conversations[activeConversationId]
        };

        const response = await fetch('/proxy/claude', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': elements.apiKeyInput.value
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(await response.text());
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const {value, done} = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, {stream: true});
            processStreamingResponse(buffer);
        }
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}
```

### Docker Configuration
```yaml
# docker-compose.yml real
services:
  db:
    image: postgres:latest
    container_name: postgres_container
    environment:
      POSTGRES_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      POSTGRES_USER: ${MYSQL_USER}
      POSTGRES_DB: ${MYSQL_DATABASE}
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
      - ./logs/postgres:/var/log/postgresql
      - ./postgres/init:/docker-entrypoint-initdb.d
    networks:
      - backend

  node:
    build:
      context: ./node
      dockerfile: Dockerfile
    container_name: node_container
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=${NODE_ENV}
      - DB_HOST=${DB_HOST}
      - DB_USER=${DB_USER}
      - DB_PASSWORD=${DB_PASSWORD}
      - DB_DATABASE=${DB_DATABASE}
    volumes:
      - ./node/src:/app
      - ./logs/node:/app/logs
    depends_on:
      - db
    networks:
      - backend

networks:
  backend:
    driver: bridge
```

## 🔒 Security Features

- API key validation
- Local file processing
- Basic error handling
- Environment variable protection
- Database connection pooling

## 🛠️ Development Commands

```bash
# Service Management
make setup     # Initialize directories
make all      # Start services
make down     # Stop services
make logs     # View logs
make fclean   # Complete cleanup
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

*Built with precision and care for advanced AI interactions*

