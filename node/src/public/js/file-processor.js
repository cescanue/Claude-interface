import { debug } from './utils.js';

const SUPPORTED_IMAGE_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp'
];

const MACOS_SYSTEM_FILES = [
    '__MACOSX',
    '.DS_Store',
    '.AppleDouble',
    '.LSOverride',
    'Icon\r',
    '._'
];

function sanitizePath(path) {
    return path.replace(/[<>:\"\/\\|?*]/g, '_')
               .replace(/\s+/g, ' ')
               .trim();
}

function normalizePath(path) {
    return path.split('/')
              .filter(part => part && !part.match(/^\\.+$/))
              .join('/');
}

function shouldIgnorePath(path) {
    return MACOS_SYSTEM_FILES.some(pattern => 
        path.includes(pattern) || 
        path.startsWith(pattern) ||
        path.split('/').some(part => part.startsWith(pattern))
    );
}

function buildMetadata(file, type, additionalInfo = {}) {
    return {
        type: type,
        filename: file.name,
        size: file.size,
        lastModified: new Date(file.lastModified).toISOString(),
        path: file.path || '',
        ...additionalInfo
    };
}

async function processCompressedFile(file) {
    try {
        const zip = new JSZip();
        const arrayBuffer = await file.arrayBuffer();
        const zipContent = await zip.loadAsync(arrayBuffer);
        
        let iaStructure = "\n\n";
        let userStructure = "\n=== COMPRESSED FILE STRUCTURE ===\n";
        
        const processedFiles = new Map();
        const nativeContents = [];
        const convertToTextCheckbox = document.getElementById('convert-pdf-to-text');
        
        // Guardar el estado original del checkbox
        const originalCheckboxState = convertToTextCheckbox.checked;
        
        // Activar el checkbox temporalmente para el procesamiento
        convertToTextCheckbox.checked = true;

        try {
            // Mejorar la construcción del árbol de directorios
            const directoryTree = {};
            
            // Primero, recolectar todas las rutas válidas
            const validPaths = [];
            for (const [path, entry] of Object.entries(zipContent.files)) {
                if (!shouldIgnorePath(path)) {
                    const normalizedPath = normalizePath(path);
                    if (normalizedPath) {
                        validPaths.push({
                            path: normalizedPath,
                            isDirectory: entry.dir
                        });
                    }
                }
            }

            // Ordenar las rutas para procesar primero los directorios
            validPaths.sort((a, b) => {
                const aDepth = a.path.split('/').length;
                const bDepth = b.path.split('/').length;
                return aDepth - bDepth;
            });

            // Construir el árbol
            for (const {path, isDirectory} of validPaths) {
                const parts = path.split('/').filter(Boolean);
                let current = directoryTree;
                let currentPath = '';

                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i];
                    currentPath = currentPath ? `${currentPath}/${part}` : part;
                    const isLastPart = i === parts.length - 1;

                    if (!current[part]) {
                        current[part] = {
                            type: isLastPart ? (isDirectory ? 'directory' : 'file') : 'directory',
                            path: currentPath,
                            children: {}
                        };
                    }
                    current = current[part].children;
                }
            }

            function buildTreeStructure(tree, indent = '', currentPath = '') {
                let iaStr = '';
                let userStr = '';
                
                const sortedEntries = Object.entries(tree)
                    .sort(([nameA], [nameB]) => nameA.localeCompare(nameB));

                for (const [name, node] of sortedEntries) {
                    const sanitizedName = sanitizePath(name);
                    const fullPath = currentPath ? `${currentPath}/${sanitizedName}` : sanitizedName;

                    if (node.type === 'file') {
                        iaStr += `${indent}\n`;
                        iaStr += `${indent}  \n`;
                        iaStr += `${indent}    ${fullPath}\n`;
                        iaStr += `${indent}    ${sanitizedName}\n`;
                        iaStr += `${indent}  \n`;
                        iaStr += `${indent}\n`;
                        userStr += `${indent}📄 ${sanitizedName}\n`;
                    } else {
                        iaStr += `${indent}\n`;
                        userStr += `${indent}📁 ${sanitizedName}\n`;
                        const { ia: childIa, user: childUser } = buildTreeStructure(
                            node.children,
                            `${indent}  `,
                            fullPath
                        );
                        iaStr += childIa;
                        userStr += childUser;
                        iaStr += `${indent}\n`;
                    }
                }
                return { ia: iaStr, user: userStr };
            }

            const { ia, user } = buildTreeStructure(directoryTree);
            iaStructure += ia + "\n";
            userStructure += user;

            // Procesar archivos
            for (const [path, zipEntry] of Object.entries(zipContent.files)) {
                if (shouldIgnorePath(path) || zipEntry.dir) {
                    continue;
                }

                const normalizedPath = normalizePath(path);
                const sanitizedPath = sanitizePath(normalizedPath);

                try {
                    const content = await zipEntry.async('uint8array');
                    const blob = new Blob([content]);
                    const file = new File([blob], path.split('/').pop());
                    const fileName = file.name.toLowerCase();

                    // Procesamiento específico según tipo de archivo
                    if (fileName.endsWith('.pdf')) {
                        const base64Data = await fileToBase64(blob);
                        
                        if (!convertToTextCheckbox?.checked) {
                            nativeContents.push({
                                type: 'document',
                                source: {
                                    type: 'base64',
                                    media_type: 'application/pdf',
                                    data: base64Data,
                                    metadata: buildMetadata(file, 'PDF', {
                                        path: sanitizedPath
                                    })
                                }
                            });
                        } else {
                            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                            
                            const loadingTask = pdfjsLib.getDocument({
                                data: content,
                                fontExtraProperties: true,
                                useSystemFonts: true,
                                disableFontFace: false,
                                verbosity: 0
                            });
                            
                            const pdf = await loadingTask.promise;
                            let fullText = '';
                            
                            for (let i = 1; i <= pdf.numPages; i++) {
                                const page = await pdf.getPage(i);
                                const textContent = await page.getTextContent();
                                fullText += textContent.items.map(item => item.str).join(' ') + '\n';
                            }
                            
                            processedFiles.set(sanitizedPath, { 
                                text: fullText,
                                type: 'text',
                                metadata: buildMetadata(file, 'PDF', {
                                    pages: pdf.numPages,
                                    path: sanitizedPath
                                })
                            });
                        }
                    } else if (SUPPORTED_IMAGE_TYPES.includes(file.type)) {
                        const base64Data = await fileToBase64(blob);
                        nativeContents.push({
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: file.type,
                                data: base64Data,
                                metadata: buildMetadata(file, 'Image', {
                                    path: sanitizedPath,
                                    format: file.type
                                })
                            }
                        });
                    } else if (fileName.endsWith('.docx') || fileName.endsWith('.doc')) {
                        const arrayBuffer = await blob.arrayBuffer();
                        const result = await mammoth.extractRawText({arrayBuffer});
                        processedFiles.set(sanitizedPath, { 
                            text: result.value,
                            type: 'text',
                            metadata: buildMetadata(file, 'Word', {
                                path: sanitizedPath,
                                format: fileName.endsWith('.docx') ? 'DOCX' : 'DOC'
                            })
                        });
                    } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
                        const arrayBuffer = await blob.arrayBuffer();
                        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
                        let fullText = '';
                        
                        for (const sheetName of workbook.SheetNames) {
                            const sheet = workbook.Sheets[sheetName];
                            const csvContent = XLSX.utils.sheet_to_csv(sheet);
                            fullText += `=== Sheet: ${sheetName} ===\n${csvContent}\n\n`;
                        }
                        
                        processedFiles.set(sanitizedPath, { 
                            text: fullText,
                            type: 'text',
                            metadata: buildMetadata(file, 'Excel', {
                                path: sanitizedPath,
                                sheets: workbook.SheetNames.length,
                                sheetNames: workbook.SheetNames,
                                format: fileName.endsWith('.xlsx') ? 'XLSX' : 'XLS'
                            })
                        });
                    } else {
                        try {
                            const text = new TextDecoder().decode(content);
                            processedFiles.set(sanitizedPath, {
                                text: text,
                                type: 'text',
                                metadata: buildMetadata(file, 'Text', {
                                    path: sanitizedPath
                                })
                            });
                        } catch (error) {
                            debug(`Error decoding file ${sanitizedPath}: ${error.message}`, 'error');
                            processedFiles.set(sanitizedPath, {
                                text: `Error decoding file: ${error.message}`,
                                type: 'error',
                                metadata: buildMetadata(file, 'Error', {
                                    path: sanitizedPath,
                                    error: error.message
                                })
                            });
                        }
                    }
                } catch (error) {
                    debug(`Error processing file ${sanitizedPath}: ${error.message}`, 'error');
                    processedFiles.set(sanitizedPath, {
                        text: `Error processing file: ${error.message}`,
                        type: 'error',
                        metadata: buildMetadata(
                            { name: path.split('/').pop(), size: 0, lastModified: Date.now() },
                            'Error',
                            { path: sanitizedPath, error: error.message }
                        )
                    });
                }
            }

            // Preparar el contenido final
            const finalContent = [];

            if (!convertToTextCheckbox?.checked && nativeContents.length > 0) {
                finalContent.push(...nativeContents);
            }

            let textContent = iaStructure + "\n";
            textContent += userStructure + "\n";
            
            if (processedFiles.size > 0) {
                textContent += "\n";
                
                const sortedFiles = Array.from(processedFiles.entries())
                    .sort(([pathA], [pathB]) => pathA.localeCompare(pathB));
                
                for (const [path, content] of sortedFiles) {
                    textContent += `\n`;
                    textContent += `  \n`;
                    for (const [key, value] of Object.entries(content.metadata)) {
                        textContent += `    <${key}>${value}\n`;
                    }
                    textContent += `  \n`;
                    textContent += `  \n`;
                    
                    if (content.type === 'text') {
                        textContent += content.text + '\n';
                    } else if (content.type === 'error') {
                        textContent += `[ERROR] ${content.text}\n`;
                    }
                    
                    textContent += `  \n`;
                    textContent += `\n\n`;
                }
                
                textContent += "";
            }

            finalContent.push({
                type: 'text',
                text: textContent,
                metadata: {
                    totalFiles: processedFiles.size,
                    hasNativeContent: nativeContents.length > 0,
                    timestamp: new Date().toISOString()
                }
            });

            return finalContent.length === 1 ? finalContent[0] : finalContent;

        } finally {
            // Restaurar el estado original del checkbox
            convertToTextCheckbox.checked = originalCheckboxState;
        }

    } catch (error) {
        debug(`Error in processCompressedFile: ${error.message}`, 'error');
        throw error;
    }
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
            debug('Processing PDF file');
            const base64Data = await fileToBase64(file);
            
            const convertToTextCheckbox = document.getElementById('convert-pdf-to-text');
            if (convertToTextCheckbox && convertToTextCheckbox.checked) {
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
                    type: 'text',
                    metadata: {
                        type: 'PDF',
                        filename: file.name
                    }
                };
            } else {
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