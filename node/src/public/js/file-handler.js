import { debug } from './utils.js';
import { processFile as processSpecialFile } from './file-processor.js';

let totalSize = 0;
const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1GB per file
const MAX_TOTAL_SIZE = 1024 * 1024 * 1024; // 1GB total

export function setupFileHandlers(elements) {
    if (!window.uploadedFiles) {
        window.uploadedFiles = new Map();
    }

    const { uploadButton, fileInput, uploadedFilesContainer } = elements;

    uploadButton.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (event) => {
        handleFileSelection(uploadedFilesContainer, event);
    });
}

async function handleFileSelection(uploadedFilesContainer, event) {
    const files = event.target.files;
    
    if (!window.uploadedFiles) {
        window.uploadedFiles = new Map();
    }

    debug(`Starting processing of ${files.length} new files`);

    for (const file of files) {
        try {
            if (!validateFileSize(file)) continue;
            await processFile(file, uploadedFilesContainer);
            debug(`File processed successfully: ${file.name}`);
            document.dispatchEvent(new Event('filesUpdated'));
        } catch (error) {
            console.error(`Error processing file ${file.name}:`, error);
            debug(`Error processing file ${file.name}: ${error.message}`, 'error');
        }
    }
    
    event.target.value = '';
    debug(`Total files uploaded: ${window.uploadedFiles.size}`);
}

function validateFileSize(file) {
    if (file.size > MAX_FILE_SIZE) {
        debug(`File ${file.name} is too large (${(file.size/1024/1024).toFixed(2)}MB). Maximum 200MB.`, 'error');
        return false;
    }

    let currentTotalSize = 0;
    for (const [_, fileData] of window.uploadedFiles) {
        // Si es un objeto con source (formato nuevo para imágenes/PDFs)
        if (fileData.source && fileData.source.data) {
            currentTotalSize += fileData.source.data.length * 0.75; // Estimación del tamaño base64
        }
        // Si es un string (formato antiguo)
        else if (typeof fileData === 'string') {
            currentTotalSize += fileData.length;
        }
        // Si es un objeto con text (otros formatos)
        else if (fileData.text) {
            currentTotalSize += fileData.text.length;
        }
    }

    if (currentTotalSize + file.size > MAX_TOTAL_SIZE) {
        debug(`Cannot add ${file.name}. It would exceed the total limit of 200MB.`, 'error');
        return false;
    }

    return true;
}

async function processFile(file, uploadedFilesContainer) {
    debug(`Processing file: ${file.name}`);
    
    if (window.uploadedFiles.has(file.name)) {
        debug(`The file ${file.name} already exists. It will be replaced.`);
        const existingElement = uploadedFilesContainer.querySelector(`[data-filename="${file.name}"]`);
        if (existingElement) {
            existingElement.parentElement.remove();
        }
    }
    
    try {
        // Try processing special files first
        const specialProcessing = await processSpecialFile(file);
        
        if (specialProcessing) {
            // Si es una imagen o PDF (formato nuevo)
            if (specialProcessing.type === 'image' || 
                (specialProcessing.type === 'document' && specialProcessing.source.media_type === 'application/pdf')) {
                window.uploadedFiles.set(file.name, specialProcessing);
                totalSize += specialProcessing.source.data.length * 0.75; // Estimación del tamaño base64
            } else {
                // Para otros tipos de archivos especiales
                window.uploadedFiles.set(file.name, specialProcessing);
                totalSize += specialProcessing.text ? specialProcessing.text.length : 0;
            }
            addFileElement(file, specialProcessing, uploadedFilesContainer);
            return;
        }

        // Process as a normal text file
        const content = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result.trim());
            reader.onerror = () => reject(new Error('Error reading the file'));
            reader.readAsText(file);
        });

        if (!content) {
            throw new Error('The file is empty');
        }

        debug(`Content read: ${content.substring(0, 100)}...`);
        window.uploadedFiles.set(file.name, content);
        totalSize += content.length;
        addFileElement(file, content, uploadedFilesContainer);

    } catch (error) {
        debug(`Error processing file: ${error.message}`, 'error');
        throw error;
    }
}

function addFileElement(file, content, container) {
    const fileElement = document.createElement('div');
    fileElement.className = 'uploaded-file';
    fileElement.setAttribute('data-filename', file.name);

    let displayName = `${file.name} (${(file.size/1024/1024).toFixed(2)}MB)`;
    
    // Si es contenido de archivo comprimido
    if (typeof content === 'string' && (
        file.type.includes('zip') || 
        file.type.includes('x-rar') ||
        file.name.toLowerCase().endsWith('.zip') ||
        file.name.toLowerCase().endsWith('.rar') ||
        file.name.toLowerCase().endsWith('.7z'))) {
        
        const structureMatch = content.match(/=== COMPRESSED FILE STRUCTURE ===([\s\S]*?)(===|<file_contents)/);
        if (structureMatch) {
            const structure = structureMatch[1].trim();
            const fileCount = (structure.match(/📄/g) || []).length;
            const dirCount = (structure.match(/📁/g) || []).length;
            displayName += `\n  ${fileCount} files, ${dirCount} directories`;
        }
    }
    // Si es una imagen
    else if (content.type === 'image') {
        displayName += '\n  [Image file]';
    }
    // Si es un PDF
    else if (content.type === 'document' && content.source.media_type === 'application/pdf') {
        displayName += '\n  [PDF document]';
    }

    fileElement.innerHTML = `
        ${displayName}
        <span class="remove-file" data-filename="${file.name}">×</span>
    `;
    
    fileElement.querySelector('.remove-file').addEventListener('click', (e) => {
        const filename = e.target.dataset.filename;
        const fileContent = window.uploadedFiles.get(filename);
        let contentSize;
        
        if (fileContent.source && fileContent.source.data) {
            contentSize = fileContent.source.data.length * 0.75; // Estimación para base64
        } else if (typeof fileContent === 'string') {
            contentSize = fileContent.length;
        } else if (fileContent.text) {
            contentSize = fileContent.text.length;
        } else {
            contentSize = 0;
        }
        
        removeFile(filename, fileElement, contentSize);
    });
    
    container.appendChild(fileElement);
}

function removeFile(filename, element, contentSize) {
    totalSize -= contentSize;
    window.uploadedFiles.delete(filename);
    element.remove();
    document.dispatchEvent(new Event('filesUpdated'));
    debug(`File removed: ${filename} (${(contentSize/1024/1024).toFixed(2)}MB)`);
}

export function clearFiles(uploadedFilesContainer) {
    if (!uploadedFilesContainer) return;
    window.uploadedFiles = new Map();
    totalSize = 0;
    uploadedFilesContainer.innerHTML = '';
    document.dispatchEvent(new Event('filesUpdated'));
    debug('Files cleared');
}