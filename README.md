# 🌟 Claude Advanced Interface Platform

<div align="center">

![Version](https://img.shields.io/badge/version-3.0.0-blue)
![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Latest-blue)
![Docker](https://img.shields.io/badge/Docker-Ready-blue)

*An advanced web interface for Claude AI with enterprise-grade caching capabilities, file processing, and cost optimization features.*

[Features](#-key-features) •
[Architecture](#-architecture) •
[Installation](#-installation) •
[Development](#-development) •
[Technical Docs](#-technical-documentation)

</div>

## 📋 Table of Contents

- [Key Features](#-key-features)
- [Caching System](#-caching-system)
- [File Processing](#-file-processing)
- [Architecture](#-architecture)
- [Installation](#-installation)
- [Development](#-development)
- [Technical Documentation](#-technical-documentation)

## ✨ Key Features

### Multi-layered Caching System
- **Conversation Cache** - Individual storage of context and files
- **Global Cache** - System directives and shared context
- **Cost Optimization** - Smart context reuse

### Advanced File Processing
- **Supported Formats** - PDF, images, Office documents, compressed files
- **Configurable Processing** - Choice between Vision API and text extraction
- **Structure Analysis** - Detailed visualization of compressed files

### Modern Interface
- **Real-time Streaming** - Fluid responses with thinking indicator
- **Dual View** - Markdown and plain text with syntax highlighting
- **Debug Panel** - Advanced development and diagnostic tools

## 💾 Caching System

The caching system is one of the platform's most powerful features, designed to optimize API usage and enhance response consistency.

### Conversation Cache

```javascript
// Conversation cache structure
{
    conversation_id: string,
    cache_text: string,      // Conversation-specific context
    cached_files: [{         // Processed and stored files
        name: string,
        content: {
            type: "text" | "image" | "document",
            data: string | base64
        }
    }]
}
```

#### Features:
- Persistent PostgreSQL storage
- Independent per-conversation management
- Automatic recovery when loading conversations
- File processing optimization

### System Global Cache

```javascript
// System configuration structure
{
    system_directives: string,  // Claude's global behavior
    cache_context: string       // Context shared across conversations
}
```

#### Benefits:
- Token usage reduction
- Response consistency
- Behavior customization
- Cost optimization

## 📁 File Processing

### Supported Formats

| Type | Formats | Processing |
|------|----------|---------------|
| Images | JPEG, PNG, GIF, WebP | Native via Claude Vision API |
| Documents | PDF | Configurable (Vision/Text) |
| Office | DOCX, XLSX | Text extraction |
| Compressed | ZIP, RAR | Structural analysis |

### Processing Pipeline

```javascript
async function processFile(file) {
    // 1. Type detection
    const fileType = await detectFileType(file);
    
    // 2. Validation and limits
    validateFileSize(file);  // Limit: 1GB
    
    // 3. Specific processing
    switch(fileType) {
        case 'pdf':
            return convertPdfToText ? extractText(file) : 
                                    prepareForVisionAPI(file);
        case 'image':
            return prepareForVisionAPI(file);
        case 'archive':
            return analyzeStructure(file);
        default:
            return extractText(file);
    }
}
```

## 🏗 Architecture

```plaintext
┌─────────────────────────────────────────┐
│  Frontend (React Components)            │
├─────────────────────────────────────────┤
│  ┌─────────────┐  ┌──────────────────┐  │
│  │  UI Manager │  │  File Processor  │  │
│  └─────────────┘  └──────────────────┘  │
│  ┌─────────────┐  ┌──────────────────┐  │
│  │   Cache     │  │  Debug Panel     │  │
│  └─────────────┘  └──────────────────┘  │
└─────────────────────────────────────────┘
               ↕ HTTP/WS
┌─────────────────────────────────────────┐
│  Backend (Node.js)                      │
├─────────────────────────────────────────┤
│  ┌─────────────┐  ┌──────────────────┐  │
│  │ API Router  │  │  Stream Handler  │  │
│  └─────────────┘  └──────────────────┘  │
│  ┌─────────────┐  ┌──────────────────┐  │
│  │ DB Service  │  │  Claude Client   │  │
│  └─────────────┘  └──────────────────┘  │
└─────────────────────────────────────────┘
               ↕ SQL
┌─────────────────────────────────────────┐
│  PostgreSQL Database                    │
├─────────────────────────────────────────┤
│  ┌─────────────┐  ┌──────────────────┐  │
│  │Conversations│  │  System Config   │  │
│  └─────────────┘  └──────────────────┘  │
│  ┌─────────────────────────────────────┐│
│  │        Conversation Cache           ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

### Key Components

#### Frontend Layer
- React-based components
- Real-time streaming management
- File processing and preview
- Debug tools and monitoring

#### Backend Layer
- Node.js server with Express
- PostgreSQL database integration
- Claude API integration
- Stream processing

#### Database Layer
- JSONB storage for conversations
- Cache management tables
- System configuration storage

## 🚀 Installation

### Prerequisites
```bash
- Docker & Docker Compose
- Node.js ≥ 18.0.0
- Claude API key (sk-)
```

### Quick Start
```bash
# Clone repository
git clone [repository-url]

# Setup environment
cp .env.example .env
make setup

# Start services
make all

# Monitor logs
make logs
```

## 💻 Development

### Available Commands
```bash
# Infrastructure
make setup     # Initialize infrastructure
make all      # Deploy all services
make down     # Stop services
make logs     # View logs
make fclean   # Complete cleanup
```

### Debug Features

The platform includes an advanced debug panel with:
- Real-time request monitoring
- JSON inspection
- Error tracking
- Performance metrics

## 📝 Technical Documentation

### Database Schema
```sql
-- Conversations Table
CREATE TABLE conversations (
    id VARCHAR(50) PRIMARY KEY,
    messages JSONB,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- Cache Table
CREATE TABLE conversation_cache (
    conversation_id VARCHAR(50) PRIMARY KEY,
    cache_text TEXT,
    cached_files JSONB,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

-- System Configuration
CREATE TABLE system_config (
    id SERIAL PRIMARY KEY,
    system_directives TEXT,
    cache_context TEXT
);
```

### API Endpoints

```plaintext
POST /proxy/claude        - Claude API proxy with streaming
GET  /api/conversations  - Retrieve all conversations
POST /api/conversations  - Save conversation
GET  /api/system-config  - Get system configuration
POST /api/system-config  - Update system configuration
```

### Security Measures

- **API Security**
  - Key validation
  - Request sanitization
  - Rate limiting
  - CORS protection

- **Data Security**
  - PostgreSQL encryption
  - Secure file processing
  - Input validation
  - XSS prevention

### Performance Optimizations

1. **Cache Strategy**
   - System directives caching
   - Conversation context persistence
   - File content caching

2. **Memory Management**
   - Streaming processing
   - Efficient file handling
   - Resource cleanup

3. **Cost Optimization**
   - Context reuse
   - Token usage optimization
   - Response caching

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines and submit pull requests to our repository.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

