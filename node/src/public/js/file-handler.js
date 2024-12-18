import { debug } from './utils.js';
import { processFile as processSpecialFile } from './file-processor.js';

let totalSize = 0;
const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB per file
const MAX_TOTAL_SIZE = 200 * 1024 * 1024; // 200MB total

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
    for (const [_, content] of window.uploadedFiles) {
        currentTotalSize += content.length;
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
            // If it's a special file (PDF, Word, Excel, ZIP...)
            window.uploadedFiles.set(file.name, specialProcessing.text);
            totalSize += specialProcessing.text.length;
            addFileElement(file, specialProcessing.text, uploadedFilesContainer);
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
    
    // If it's a compressed file, add a summary of the content
    if (file.type.includes('zip') || 
        file.type.includes('x-rar') ||
        file.name.toLowerCase().endsWith('.zip') ||
        file.name.toLowerCase().endsWith('.rar') ||
        file.name.toLowerCase().endsWith('.7z')) {
        
        // Extract structure information
        const structureMatch = content.match(/=== ESTRUCTURA DEL ARCHIVO COMPRIMIDO ===([\s\S]*?)(===|<file_contents)/);
        if (structureMatch) {
            const structure = structureMatch[1].trim();
            const fileCount = (structure.match(/📄/g) || []).length;
            const dirCount = (structure.match(/📁/g) || []).length;
            
            displayName += `\n  ${fileCount} files, ${dirCount} directories`;
        }
    }

    fileElement.innerHTML = `
        ${displayName}
        <span class="remove-file" data-filename="${file.name}">×</span>
    `;
    
    fileElement.querySelector('.remove-file').addEventListener('click', (e) => {
        const filename = e.target.dataset.filename;
        removeFile(filename, fileElement, content.length);
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
