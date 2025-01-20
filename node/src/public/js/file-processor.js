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

// Detecta si el contenido es procesable como documento
async function isProcessableDocument(content) {
    try {
        // Intentar decodificar una muestra del contenido
        const bytes = Array.from(content);
        const sampleSize = Math.min(bytes.length, 1024);
        const sample = bytes.slice(0, sampleSize);
        
        // Contamos bytes que están fuera del rango de caracteres válidos
        // Incluimos caracteres UTF-8 comunes y caracteres de control útiles
        const nonValidCount = sample.filter(byte => {
            // Permitir caracteres de control comunes
            if ([9, 10, 13, 27].includes(byte)) return false;
            
            // Permitir ASCII imprimible
            if (byte >= 32 && byte <= 126) return false;
            
            // Permitir UTF-8 común
            if (byte >= 194 && byte <= 244) return false;
            
            return true;
        }).length;

        // Un umbral más permisivo para texto
        const threshold = 0.15; // 15% de bytes no válidos permitidos
        return (nonValidCount / sampleSize) <= threshold;
    } catch (error) {
        debug(`Error analyzing content: ${error.message}`, 'error');
        return false;
    }
}

async function processCompressedFile(file) {
    try {
        const zip = new JSZip();
        const arrayBuffer = await file.arrayBuffer();
        const zipContent = await zip.loadAsync(arrayBuffer);
        
        let iaStructure = "\n\n";
        let userStructure = "\n=== COMPRESSED FILE STRUCTURE ===\n";
        
        const processedFiles = new Map();
        const validPaths = [];

        // Recolectar todas las rutas válidas primero
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

        // Ordenar las rutas
        validPaths.sort((a, b) => {
            const aDepth = a.path.split('/').length;
            const bDepth = b.path.split('/').length;
            return aDepth - bDepth;
        });

        // Construir el árbol de directorios solo con archivos válidos
        const directoryTree = {};
        const textFiles = new Set(); // Conjunto para rastrear archivos de texto válidos

        // Primera pasada: procesar los archivos y determinar cuáles son de texto
        for (const [path, zipEntry] of Object.entries(zipContent.files)) {
            if (shouldIgnorePath(path) || zipEntry.dir) {
                continue;
            }

            const normalizedPath = normalizePath(path);
            const fileName = path.split('/').pop().toLowerCase();
            const fileExtension = fileName.split('.').pop().toLowerCase();

            debug(`Starting processing of file: ${normalizedPath}`, 'info');
            try {
                const content = await zipEntry.async('uint8array');
                const blob = new Blob([content]);
                const file = new File([blob], fileName);
                
                let processedText = '';
                let fileType = '';

                // Procesar según la extensión para formatos conocidos
                if (fileExtension === 'pdf') {
                    try {
                        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                        const pdf = await pdfjsLib.getDocument({data: content}).promise;
                        let text = '';
                        
                        for (let i = 1; i <= pdf.numPages; i++) {
                            const page = await pdf.getPage(i);
                            const textContent = await page.getTextContent();
                            text += textContent.items.map(item => item.str).join(' ') + '\n';
                        }
                        
                        if (text.trim()) {
                            processedText = text;
                            fileType = 'PDF';
                            debug(`Successfully converted PDF to text: ${normalizedPath}`, 'info');
                        }
                    } catch (pdfError) {
                        debug(`Error processing PDF ${normalizedPath}: ${pdfError.message}`, 'error');
                    }
                } 
                // Procesar archivos de Excel
                else if (['xlsx', 'xls'].includes(fileExtension)) {
                    try {
                        const arrayBuffer = content.buffer;
                        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
                        let text = '';
                        
                        for (const sheetName of workbook.SheetNames) {
                            const sheet = workbook.Sheets[sheetName];
                            const csvContent = XLSX.utils.sheet_to_csv(sheet);
                            text += `=== Sheet: ${sheetName} ===\n${csvContent}\n\n`;
                        }
                        
                        if (text.trim()) {
                            processedText = text;
                            fileType = 'Excel';
                            debug(`Successfully converted Excel to text: ${normalizedPath}`, 'info');
                        }
                    } catch (xlsxError) {
                        debug(`Error processing Excel ${normalizedPath}: ${xlsxError.message}`, 'error');
                    }
                }
                // Procesar archivos de Word
                else if (['docx', 'doc'].includes(fileExtension)) {
                    try {
                        const arrayBuffer = content.buffer;
                        const result = await mammoth.extractRawText({arrayBuffer});
                        if (result.value.trim()) {
                            processedText = result.value;
                            fileType = 'Word';
                            debug(`Successfully converted Word document to text: ${normalizedPath}`, 'info');
                        }
                    } catch (docxError) {
                        debug(`Error processing Word document ${normalizedPath}: ${docxError.message}`, 'error');
                    }
                }
                // Para todos los demás archivos, analizar el contenido
                else {
                    try {
                        if (await isProcessableDocument(content)) {
                            const text = new TextDecoder().decode(content);
                            if (text.trim()) {
                                processedText = text;
                                fileType = 'Text';
                                debug(`Successfully processed as plain text: ${normalizedPath}`, 'info');
                            }
                        } else {
                            debug(`File ${normalizedPath} detected as binary - skipping`, 'info');
                        }
                    } catch (error) {
                        debug(`Error processing file as text ${normalizedPath}: ${error.message}`, 'warning');
                    }
                }

                // Si se logró procesar el contenido, guardarlo
                if (processedText) {
                    debug(`Adding processed file to results: ${normalizedPath} (Type: ${fileType})`, 'info');
                    processedFiles.set(normalizedPath, {
                        text: processedText,
                        type: 'text',
                        metadata: {
                            type: fileType,
                            path: normalizedPath
                        }
                    });
                    textFiles.add(normalizedPath);
                }

            } catch (error) {
                debug(`Error processing file ${normalizedPath}: ${error.message}`, 'error');
            }
        }

        // Segunda pasada: construir el árbol solo con archivos de texto válidos
        for (const {path, isDirectory} of validPaths) {
            if (!isDirectory && !textFiles.has(path)) {
                continue; // Saltar archivos que no son de texto
            }

            const parts = path.split('/').filter(Boolean);
            let current = directoryTree;
            let currentPath = '';

            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                currentPath = currentPath ? `${currentPath}/${part}` : part;
                const isLastPart = i === parts.length - 1;

                // Solo agregar al árbol si es un directorio o un archivo de texto válido
                if (isLastPart && !isDirectory && !textFiles.has(currentPath)) {
                    continue;
                }

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

                if (node.type === 'file' && textFiles.has(fullPath)) {
                    iaStr += `${indent}\n`;
                    iaStr += `${indent}  \n`;
                    iaStr += `${indent}    ${fullPath}\n`;
                    iaStr += `${indent}    ${sanitizedName}\n`;
                    iaStr += `${indent}  \n`;
                    iaStr += `${indent}\n`;
                    userStr += `${indent}📄 ${sanitizedName}\n`;
                } else if (node.type === 'directory') {
                    // Solo incluir directorios que contengan archivos de texto
                    const hasTextFiles = Object.values(node.children).some(child => 
                        child.type === 'file' ? textFiles.has(`${fullPath}/${child.path.split('/').pop()}`) : true
                    );
                    
                    if (hasTextFiles) {
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
            }
            return { ia: iaStr, user: userStr };
        }

        const { ia, user } = buildTreeStructure(directoryTree);
        iaStructure += ia + "\n";
        userStructure += user;

        // Preparar el contenido final
        const finalContent = [];

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
                timestamp: new Date().toISOString()
            }
        });

        // Log resumen final
        debug(`\n=== Processing Summary ===`, 'info');
        debug(`Total files found: ${Object.keys(zipContent.files).filter(f => !zipContent.files[f].dir).length}`, 'info');
        debug(`Successfully processed files: ${processedFiles.size}`, 'info');
        debug(`Skipped/unprocessable files: ${Object.keys(zipContent.files).filter(f => !zipContent.files[f].dir).length - processedFiles.size}`, 'info');
        debug(`File types processed: ${Array.from(new Set(Array.from(processedFiles.values()).map(f => f.metadata.type))).join(', ')}`, 'info');
        debug(`======================\n`, 'info');

        return finalContent.length === 1 ? finalContent[0] : finalContent;

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