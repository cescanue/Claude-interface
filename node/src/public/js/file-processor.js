import { debug } from './utils.js';

const SUPPORTED_IMAGE_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp'
];

async function processCompressedFile(file) {
    const zip = new JSZip();
    const arrayBuffer = await file.arrayBuffer();
    const zipContent = await zip.loadAsync(arrayBuffer);
    
    // Structure for the AI
    let iaStructure = "\n<file_structure>\n";
    // Visual structure for the user
    let userStructure = "\n=== COMPRESSED FILE STRUCTURE ===\n";
    
    const processedFiles = new Map();
    
    // Build the directory tree
    const directoryTree = {};
    for (const path of Object.keys(zipContent.files)) {
        const parts = path.split('/');
        let current = directoryTree;
        for (const part of parts) {
            if (part === '') continue;
            if (!current[part]) {
                current[part] = {};
            }
            current = current[part];
        }
    }

    // Recursive function to build both structures
    function buildTreeStructure(tree, indent = '', path = '', userIndent = '') {
        let iaStr = '';
        let userStr = '';
        
        for (const [name, subtree] of Object.entries(tree)) {
            const fullPath = path ? `${path}/${name}` : name;
            
            if (Object.keys(subtree).length === 0) {
                // It's a file
                iaStr += `${indent}<file path="${fullPath}">${name}</file>\n`;
                userStr += `${userIndent}📄 ${name}\n`;
            } else {
                // It's a directory
                iaStr += `${indent}<directory path="${fullPath}">${name}\n`;
                userStr += `${userIndent}📁 ${name}\n`;
                const { ia, user } = buildTreeStructure(subtree, indent + '  ', fullPath, userIndent + '  ');
                iaStr += ia;
                userStr += user;
                iaStr += `${indent}</directory>\n`;
            }
        }
        return { ia: iaStr, user: userStr };
    }

    const { ia, user } = buildTreeStructure(directoryTree);
    iaStructure += ia + "</file_structure>\n";
    userStructure += user;

    // Process each file in the zip
    for (const [path, zipEntry] of Object.entries(zipContent.files)) {
        if (!zipEntry.dir) {
            try {
                const content = await zipEntry.async('uint8array');
                const blob = new Blob([content]);
                const file = new File([blob], path.split('/').pop());
                
                // Attempt to process the file based on its type
                const processedContent = await processFile(file);
                if (processedContent) {
                    processedFiles.set(path, processedContent.text);
                } else {
                    // If it cannot be processed, convert to text
                    const text = new TextDecoder().decode(content);
                    processedFiles.set(path, text);
                }
            } catch (error) {
                debug(`Error processing file ${path} inside the zip: ${error.message}`, 'error');
                processedFiles.set(path, `Error processing the file: ${error.message}`);
            }
        }
    }

    // Combine the structures with the file contents
    let finalContent = iaStructure + "\n";
    finalContent += userStructure + "\n";
    finalContent += "<file_contents>\n";
    
    // Visual section for the user
    finalContent += "=== FILE CONTENTS ===\n\n";
    
    for (const [path, content] of processedFiles.entries()) {
        finalContent += `<file_content path="${path}">\n`;
        finalContent += `=== ${path} ===\n`;
        finalContent += `${content}\n`;
        finalContent += `</file_content>\n\n`;
    }
    finalContent += "</file_contents>";

    return { text: finalContent, type: 'text' };
}

async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const base64String = reader.result
                .replace('data:', '')
                .replace(/^.+,/, '');
            resolve(base64String);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

export async function processFile(file) {
    try {
        const fileType = file.type;
        const fileName = file.name.toLowerCase();
        debug(`Processing file: ${fileName} (${fileType})`);

        // Procesar archivo comprimido
        if (fileType.includes('zip') || 
            fileType.includes('x-rar') ||
            fileName.endsWith('.zip') ||
            fileName.endsWith('.rar') ||
            fileName.endsWith('.7z')) {
            debug('Processing compressed file');
            return await processCompressedFile(file);
        }
        
        // Procesar PDF
        if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) {
            debug('Processing PDF file in native Claude format');
            const base64Data = await fileToBase64(file);
            return {
                type: 'document',
                source: {
                    type: 'base64',
                    media_type: 'application/pdf',
                    data: base64Data,
                    metadata: {file_name: fileName}
                }
            };
        }
        
        // Procesar imágenes
        if (SUPPORTED_IMAGE_TYPES.includes(fileType)) {
            debug('Processing image in native Claude format');
            const base64Data = await fileToBase64(file);
            return {
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: fileType,
                    data: base64Data,
                    metadata: {file_name: fileName}
                }
            };
        }

        // Word Processing
        if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            fileType === 'application/msword' ||
            fileName.endsWith('.docx') ||
            fileName.endsWith('.doc')) {
            debug('Starting Word document processing');
            const arrayBuffer = await file.arrayBuffer();
            const result = await mammoth.extractRawText({arrayBuffer});
            debug('Word document processed successfully');
            return { 
                text: result.value,
                type: 'text',
                metadata: {
                    type: 'Word'
                }
            };
        }
        
        // Excel Processing
        if (fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            fileType === 'application/vnd.ms-excel' ||
            fileName.endsWith('.xlsx') ||
            fileName.endsWith('.xls')) {
            debug('Starting Excel processing');
            const arrayBuffer = await file.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { type: 'array' });
            let fullText = '';
            
            for (const sheetName of workbook.SheetNames) {
                const sheet = workbook.Sheets[sheetName];
                const csvContent = XLSX.utils.sheet_to_csv(sheet);
                fullText += `=== Sheet: ${sheetName} ===\n${csvContent}\n\n`;
            }
            
            debug('Excel processed successfully');
            return { 
                text: fullText,
                type: 'text',
                metadata: {
                    sheets: workbook.SheetNames.length,
                    type: 'Excel'
                }
            };
        }
        
        // Default: return null for unhandled file types
        debug(`Unhandled file type: ${fileType}`);
        return null;
    } catch (error) {
        debug(`Error in processFile: ${error.message}`, 'error');
        throw error;
    }
}