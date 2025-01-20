// ConversationCacheDialog.js
import { processFile } from '../file-processor.js';
import { debug } from '../utils.js';

window.ConversationCacheDialog = () => {
    const [isVisible, setIsVisible] = React.useState(false);
    const [cacheText, setCacheText] = React.useState('');
    const [cachedFiles, setCachedFiles] = React.useState([]);
    const [isEnabled, setIsEnabled] = React.useState(false);
    const [activeFileView, setActiveFileView] = React.useState(null);
    const [isProcessing, setIsProcessing] = React.useState(false);
    const [previousConvertPdfState, setPreviousConvertPdfState] = React.useState(false);
    const fileInputRef = React.useRef(null);

    // Función para truncar texto
    const truncateText = (text, maxLength = 20) => {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength - 3) + '...';
    };

    React.useEffect(() => {
        const handleConversationChange = (event) => {
            setIsEnabled(!!event.detail.id);
        };

        const handleConversationsCleared = () => {
            setIsEnabled(false);
            setIsVisible(false);
        };

        document.addEventListener('conversationChanged', handleConversationChange);
        document.addEventListener('conversationsCleared', handleConversationsCleared);

        setIsEnabled(!!window.activeConversationId);

        return () => {
            document.removeEventListener('conversationChanged', handleConversationChange);
            document.removeEventListener('conversationsCleared', handleConversationsCleared);
        };
    }, []);

    React.useEffect(() => {
        const convertPdfCheckbox = document.getElementById('convert-pdf-to-text');
        if (!convertPdfCheckbox) return;

        if (isVisible) {
            // Guardar el estado actual antes de activarlo
            setPreviousConvertPdfState(convertPdfCheckbox.checked);
            convertPdfCheckbox.checked = true;
        } else {
            // Restaurar el estado anterior cuando se cierra
            convertPdfCheckbox.checked = previousConvertPdfState;
        }
    }, [isVisible]);

    React.useEffect(() => {
        const loadCache = async () => {
            const conversationId = window.activeConversationId;
            if (isVisible && conversationId) {
                try {
                    const response = await fetch(`/api/conversations/${conversationId}/cache`);
                    if (response.ok) {
                        const data = await response.json();
                        setCacheText(data.cacheText || '');
                        setCachedFiles(data.cachedFiles || []);
                    }
                } catch (error) {
                    debug(`Error loading cache: ${error.message}`, 'error');
                }
            }
        };

        loadCache();
    }, [isVisible]);

    React.useEffect(() => {
        if (activeFileView) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [activeFileView]);

    const handleSave = async () => {
        const conversationId = window.activeConversationId;
        if (!conversationId) {
            debug('No active conversation', 'error');
            return;
        }

        try {
            const response = await fetch(`/api/conversations/${conversationId}/cache`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    cacheText,
                    cachedFiles
                })
            });

            if (response.ok) {
                setIsVisible(false);
                debug('Cache configuration saved successfully');
            } else {
                debug('Error saving cache configuration', 'error');
            }
        } catch (error) {
            debug(`Error saving cache: ${error.message}`, 'error');
        }
    };

    const handleFileUpload = async (event) => {
        const files = Array.from(event.target.files);
        setIsProcessing(true);
        debug(`Starting to process ${files.length} files...`);

        try {
            const processedFiles = await Promise.all(files.map(async (file) => {
                let content;
                try {
                    debug(`Processing file: ${file.name}`);
                    const processedContent = await processFile(file);
                    if (processedContent) {
                        debug(`File processed successfully: ${file.name}`);
                        return {
                            name: file.name,
                            size: file.size,
                            type: file.type,
                            content: processedContent,
                            lastModified: file.lastModified
                        };
                    }
                } catch (error) {
                    debug(`Error processing file ${file.name}: ${error.message}`, 'error');
                }

                // Fallback a lectura básica si processFile falla
                debug(`Using fallback processing for file: ${file.name}`);
                content = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target.result);
                    reader.onerror = (e) => {
                        debug(`FileReader error: ${e.target.error}`, 'error');
                        reject(e);
                    };
                    reader.readAsText(file);
                });

                return {
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    content: content,
                    lastModified: file.lastModified
                };
            }));

            setCachedFiles([...cachedFiles, ...processedFiles]);
            debug(`Successfully processed ${processedFiles.length} files`);
        } catch (error) {
            debug(`Error in batch file processing: ${error.message}`, 'error');
        } finally {
            setIsProcessing(false);
            event.target.value = null;
        }
    };

    const removeFile = (fileName) => {
        debug(`Removing file: ${fileName}`);
        setCachedFiles(cachedFiles.filter(file => file.name !== fileName));
    };

    const viewFileContent = (file) => {
        debug(`Viewing file content: ${file.name}`);
        setActiveFileView(file);
    };

    // FileViewerModal component
    const FileViewerModal = ({ file, onClose }) => {
        return ReactDOM.createPortal(
            React.createElement(
                'div',
                {
                    className: 'fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4',
                    style: { zIndex: 9999 },
                    onClick: (e) => {
                        if (e.target === e.currentTarget) {
                            onClose();
                        }
                    },
                },
                React.createElement(
                    'div',
                    {
                        className: 'bg-gray-800 rounded-lg w-full max-w-6xl flex flex-col relative',
                        onClick: (e) => e.stopPropagation(),
                        style: {
                            maxHeight: 'calc(100vh - 2rem)',
                            minHeight: '200px'
                        }
                    },
                    [
                        // Header del visor
                        React.createElement(
                            'div',
                            {
                                className: 'flex justify-between items-center p-4 border-b border-gray-700 sticky top-0 bg-gray-800 z-10'
                            },
                            [
                                React.createElement(
                                    'h3',
                                    {
                                        className: 'text-lg font-semibold text-white truncate flex-1 mr-4',
                                        title: file.name
                                    },
                                    file.name
                                ),
                                React.createElement(
                                    'button',
                                    {
                                        onClick: onClose,
                                        className: 'text-gray-400 hover:text-white transition-colors p-2 text-xl leading-none',
                                        title: 'Close'
                                    },
                                    '×'
                                )
                            ]
                        ),
                        // Contenedor con scroll
                        React.createElement(
                            'div',
                            {
                                className: 'flex-1 overflow-auto p-4 relative'
                            },
                            React.createElement(
                                'pre',
                                {
                                    className: 'text-white whitespace-pre-wrap break-words font-mono text-sm leading-relaxed',
                                    style: {
                                        maxWidth: '100%',
                                        overflowWrap: 'break-word'
                                    }
                                },
                                typeof file.content === 'object' ? 
                                    JSON.stringify(file.content, null, 2) : 
                                    file.content
                            )
                        )
                    ]
                )
            ),
            document.body
        );
    };

    return React.createElement(
        React.Fragment,
        null,
        [
            // El botón de Cache
            React.createElement(
                'button',
                {
                    onClick: () => setIsVisible(true),
                    className: `btn btn-primary ${(!isEnabled || isVisible) ? 'opacity-50 cursor-not-allowed' : ''}`,
                    disabled: !isEnabled || isVisible,
                    title: !isEnabled ? 'Please start or select a conversation first' : 
                           isVisible ? 'Dialog is open' : 'Cache',
                    key: 'cache-button'
                },
                [
                    React.createElement(
                        'svg',
                        {
                            xmlns: 'http://www.w3.org/2000/svg',
                            width: '16',
                            height: '16',
                            viewBox: '0 0 24 24',
                            fill: 'none',
                            stroke: 'currentColor',
                            strokeWidth: '2',
                            strokeLinecap: 'round',
                            strokeLinejoin: 'round',
                            className: 'mr-2'
                        },
                        [
                            React.createElement('path', {
                                d: 'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z'
                            }),
                            React.createElement('path', {
                                d: 'M8 2v4'
                            }),
                            React.createElement('path', {
                                d: 'M16 2v4'
                            }),
                            React.createElement('path', {
                                d: 'M12 10v6'
                            }),
                            React.createElement('path', {
                                d: 'M9 13l3-3 3 3'
                            })
                        ]
                    ),
                    'Cache'
                ]
            ),

            // El diálogo modal principal
            isVisible && React.createElement(
                'div',
                {
                    className: 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4',
                    style: { zIndex: 50 },
                    key: 'modal'
                },
                React.createElement(
                    'div',
                    {
                        className: 'w-full max-w-2xl bg-gray-800 rounded-lg shadow-xl p-6'
                    },
                    [
                        // Header
                        React.createElement(
                            'div',
                            {
                                className: 'flex justify-between items-center mb-4',
                                key: 'header'
                            },
                            [
                                React.createElement(
                                    'h2',
                                    {
                                        className: 'text-xl font-bold text-white'
                                    },
                                    'Conversation Cache Configuration'
                                ),
                                React.createElement(
                                    'span',
                                    {
                                        className: 'text-sm text-gray-400'
                                    },
                                    `Conversation ID: ${window.activeConversationId}`
                                )
                            ]
                        ),

                        // Content Container
                        React.createElement(
                            'div',
                            {
                                className: 'space-y-4',
                                key: 'content'
                            },
                            [
                                // Cache Text Section
                                React.createElement(
                                    'div',
                                    {
                                        key: 'cache-text-section'
                                    },
                                    [
                                        React.createElement(
                                            'label',
                                            {
                                                className: 'block text-sm font-medium text-gray-200 mb-2'
                                            },
                                            'Cache Text'
                                        ),
                                        React.createElement(
                                            'textarea',
                                            {
                                                className: 'w-full h-40 px-3 py-2 text-white bg-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500',
                                                value: cacheText,
                                                onChange: (e) => setCacheText(e.target.value),
                                                placeholder: 'Enter cache text here...'
                                            }
                                        )
                                    ]
                                ),

                                // Files Section
                                React.createElement(
                                    'div',
                                    {
                                        key: 'files-section'
                                    },
                                    [
                                        React.createElement(
                                            'label',
                                            {
                                                className: 'block text-sm font-medium text-gray-200 mb-2'
                                            },
                                            'Cached Files'
                                        ),
                                        React.createElement(
                                            'div',
                                            {
                                                className: 'bg-gray-700 rounded-lg p-4'
                                            },
                                            [
                                                // Files List con scroll
                                                React.createElement(
                                                    'div',
                                                    {
                                                        className: 'space-y-2 mb-4 max-h-48 overflow-y-auto pr-2',
                                                        key: 'files-list',
                                                        style: {
                                                            scrollbarWidth: 'thin',
                                                            scrollbarColor: '#4B5563 transparent'
                                                        }
                                                    },
                                                    cachedFiles.map(file =>
                                                        React.createElement(
                                                            'div',
                                                            {
                                                                key: file.name,
                                                                className: 'flex items-center justify-between bg-gray-600 rounded p-2'
                                                            },
                                                            [
                                                                React.createElement(
                                                                    'div',
                                                                    {
                                                                        className: 'flex items-center space-x-2 min-w-0 flex-1'
                                                                    },
                                                                    [
                                                                        React.createElement(
                                                                            'span',
                                                                            {
                                                                                className: 'text-white text-sm truncate flex-1',
                                                                                title: file.name
                                                                            },
                                                                            truncateText(file.name, 30)
                                                                        ),
                                                                        React.createElement(
                                                                            'span',
                                                                            {
                                                                                className: 'text-gray-400 text-xs whitespace-nowrap'
                                                                            },
                                                                            `(${(file.size / 1024).toFixed(1)} KB)`
                                                                        )
                                                                    ]
                                                                ),
                                                                React.createElement(
                                                                    'div',
                                                                    {
                                                                        className: 'flex items-center space-x-2 ml-2'
                                                                    },
                                                                    [
                                                                        React.createElement(
                                                                            'button',
                                                                            {
                                                                                onClick: () => viewFileContent(file),
                                                                                className: 'text-blue-400 hover:text-blue-300 px-2 py-1'
                                                                            },
                                                                            'View'
                                                                        ),
                                                                        React.createElement(
                                                                            'button',
                                                                            {
                                                                                onClick: () => removeFile(file.name),
                                                                                className: 'text-red-400 hover:text-red-300 px-2 py-1'
                                                                            },
                                                                            '×'
                                                                        )
                                                                    ]
                                                                )
                                                            ]
                                                        )
                                                    )
                                                ),

                                                // Upload Input (Acepta todos los tipos de archivo)
                                                React.createElement(
                                                    'input',
                                                    {
                                                        type: 'file',
                                                        ref: fileInputRef,
                                                        onChange: handleFileUpload,
                                                        className: 'hidden',
                                                        multiple: true,
                                                        key: 'file-input'
                                                    }
                                                ),

                                                // Upload Button con indicador de procesamiento
                                                React.createElement(
                                                    'button',
                                                    {
                                                        onClick: () => {
                                                            debug('Opening file selector');
                                                            fileInputRef.current?.click();
                                                        },
                                                        className: `bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm flex items-center justify-center ${isProcessing ? 'opacity-50' : ''}`,
                                                        disabled: isProcessing
                                                    },
                                                    isProcessing ? [
                                                        React.createElement(
                                                            'svg',
                                                            {
                                                                className: 'animate-spin -ml-1 mr-3 h-5 w-5 text-white',
                                                                xmlns: 'http://www.w3.org/2000/svg',
                                                                fill: 'none',
                                                                viewBox: '0 0 24 24'
                                                            },
                                                            React.createElement(
                                                                'circle',
                                                                {
                                                                    className: 'opacity-25',
                                                                    cx: '12',
                                                                    cy: '12',
                                                                    r: '10',
                                                                    stroke: 'currentColor',
                                                                    strokeWidth: '4'
                                                                }
                                                            ),
                                                            React.createElement(
                                                                'path',
                                                                {
                                                                    className: 'opacity-75',
                                                                    fill: 'currentColor',
                                                                    d: 'M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
                                                                }
                                                            )
                                                        ),
                                                        'Processing...'
                                                    ] : 'Add Files'
                                                )
                                            ]
                                        )
                                    ]
                                )
                            ]
                        ),

                        // Action Buttons
                        React.createElement(
                            'div',
                            {
                                className: 'flex justify-end space-x-4 mt-6',
                                key: 'actions'
                            },
                            [
                                React.createElement(
                                    'button',
                                    {
                                        onClick: () => {
                                            debug('Closing cache dialog');
                                            setIsVisible(false);
                                        },
                                        className: 'btn btn-secondary'
                                    },
                                    'Cancel'
                                ),
                                React.createElement(
                                    'button',
                                    {
                                        onClick: handleSave,
                                        className: 'btn btn-primary'
                                    },
                                    'Save Configuration'
                                )
                            ]
                        )
                    ]
                )
            ),

            // Modal de visualización de archivo
            activeFileView && React.createElement(FileViewerModal, {
                file: activeFileView,
                onClose: () => {
                    debug('Closing file viewer');
                    setActiveFileView(null);
                }
            })
        ]
    );
};