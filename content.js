// content.js
console.log('Claude Chat Extractor loading...');

// First add our content handlers at the top
const contentHandlers = {
    // Embedded content (attachments & artifacts)
    embedded: {
        'application/json': (content) => ({
            extension: '.json',
            content: JSON.stringify(content, null, 2)
        }),
        'application/vnd.ant.code': (content, meta) => ({
            extension: `.${meta.language || 'txt'}`,
            content: content
        }),
        'default': (content) => ({
            extension: '.txt',
            content: typeof content === 'string' ? content : JSON.stringify(content)
        })
    },

    // File references
    files: {
        'image': (file) => ({
            extension: getExtFromName(file.file_name),
            url: file.preview_url,
            needsDownload: true
        }),
        'default': (file) => ({
            extension: getExtFromName(file.file_name),
            url: file.preview_url,
            needsDownload: true
        })
    }
};

// Helper function
function getExtFromName(filename) {
    return filename.includes('.') ? filename.substring(filename.lastIndexOf('.')) : '';
}

// Inject the findMessages script
function injectFindMessages() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected.js');
    script.onload = function() {
        this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
}

// Listen for messages from injected script
window.addEventListener('message', async event => {
    if (event.data.type === 'FOUND_MESSAGES') {
        const messages = event.data.messages;
        if (messages && messages.length > 0) {
            console.log(`Processing ${messages.length} messages for download...`);
            
            // Track unique files
            const uniqueFiles = new Map();
            
            // Collect all unique files
            messages.forEach(msg => {
                // Handle files and files_v2 (which contain images)
                [...(msg.files || []), 
                 ...(msg.files_v2 || [])]
                .forEach(file => {
                    const fileName = file.file_name || file.name;
                    if (!uniqueFiles.has(fileName) && file.preview_url) {
                        uniqueFiles.set(fileName, {
                            url: 'https://claude.ai' + file.preview_url,
                            name: fileName,
                            // Use file_kind to determine type
                            type: file.file_kind === 'image' ? 'image/png' : 'application/octet-stream'
                        });
                    }
                });

                // Handle attachments separately (non-image files)
                (msg.attachments || []).forEach(att => {
                    const fileName = att.file_name || att.name;
                    if (!uniqueFiles.has(fileName) && att.preview_url) {
                        uniqueFiles.set(fileName, {
                            url: 'https://claude.ai' + att.preview_url,
                            name: fileName,
                            type: 'application/octet-stream'
                        });
                    }
                });
            });

            console.log(`Found ${uniqueFiles.size} unique files to download`);

            // Create ZIP bundle
            const zip = new JSZip();
            
            // Add chat JSON
            zip.file('chat.json', JSON.stringify(messages, null, 2));
            
            // Process all messages
            for (const msg of messages) {
                await processMessageContent(msg, zip);
            }
            
            // Create folders
            const filesFolder = zip.folder('files');
            const imagesFolder = filesFolder.folder('images');
            const attachmentsFolder = filesFolder.folder('attachments');

            // Download all files first
            const downloadPromises = Array.from(uniqueFiles.values()).map(async file => {
                try {
                    console.log(`Downloading ${file.name} from ${file.url}`);
                    const response = await fetch(file.url);
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                    const blob = await response.blob();
                    
                    // Determine folder based on file type
                    const folder = file.type.startsWith('image/') ? imagesFolder : attachmentsFolder;
                    folder.file(file.name, blob);
                    
                    chrome.runtime.sendMessage({
                        type: 'status',
                        text: `Downloaded ${file.name}...`,
                        state: 'progress'
                    });

                    return true;
                } catch (error) {
                    console.error(`Failed to download ${file.name}:`, error);
                    return false;
                }
            });

            // Wait for all downloads to complete before creating ZIP
            Promise.all(downloadPromises).then(async results => {
                console.log('All downloads completed, generating ZIP...');
                const blob = await zip.generateAsync({type: 'blob'});
                const url = URL.createObjectURL(blob);
                
                chrome.runtime.sendMessage({
                    type: 'download',
                    options: {
                        url: url,
                        filename: `claude-chat-${Date.now()}.zip`,
                        saveAs: true
                    }
                });
                
                chrome.runtime.sendMessage({
                    type: 'status',
                    text: `Download complete! (${results.filter(Boolean).length} files included)`,
                    state: 'success'
                });
            }).catch(error => {
                console.error('Error creating ZIP:', error);
                chrome.runtime.sendMessage({
                    type: 'status',
                    text: 'Error creating ZIP file',
                    state: 'error'
                });
            });
        } else {
            console.log('No messages found');
            chrome.runtime.sendMessage({
                type: 'status',
                text: 'No messages found',
                state: 'error'
            });
        }
    } else if (event.data.type === 'DEBUG_DATA') {
        console.log('Debug data received');
        
        // Create JSON file
        const blob = new Blob([JSON.stringify(event.data.data, null, 2)], 
            { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        // Download via background script
        chrome.runtime.sendMessage({
            type: 'download',
            options: {
                url: url,
                filename: `claude-debug-${Date.now()}.json`,
                saveAs: true
            }
        });
    } else if (event.data.type === 'DEBUG_INFO') {
        console.log('Debug information received:', event.data.info);
    }
});

// Listen for extract command from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'extract') {
        console.log('Starting extraction...');
        injectFindMessages();
    }
    return true;
});

// Process message content
async function processMessageContent(msg, zip) {
    // Handle embedded content (attachments)
    if (msg.attachments?.length > 0) {
        for (const att of msg.attachments) {
            if (att.file_type && att.extracted_content) {  // Only process if we have both type and content
                const handler = contentHandlers.embedded[att.file_type] || 
                              contentHandlers.embedded.default;
                const result = handler(att.extracted_content);
                zip.file(`files/attachments/${att.file_name}`, result.content);
            }
        }
    }

    // Handle artifacts
    for (const item of msg.content || []) {
        if (item.type === 'tool_use' && 
            item.name === 'artifacts' && 
            item.input?.type && 
            item.input?.content) {  // Only process valid artifacts
                
            const handler = contentHandlers.embedded[item.input.type] || 
                          contentHandlers.embedded.default;
            const result = handler(item.input.content, {
                language: item.input.language
            });
            
            // Only create file if we have a title
            if (item.input.title) {
                zip.file(`files/artifacts/${item.input.title}${result.extension}`, 
                         result.content);
            }
        }
    }

    // Handle files
    const files = [...(msg.files || []), ...(msg.files_v2 || [])];
    for (const file of files) {
        if (file.file_kind && file.preview_url) {  // Only process valid files
            const handler = contentHandlers.files[file.file_kind] || 
                           contentHandlers.files.default;
            const result = handler(file);
            if (result.needsDownload) {
                try {
                    const response = await fetch('https://claude.ai' + result.url);
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                    const blob = await response.blob();
                    const folder = file.file_kind === 'image' ? 'images' : 'other';
                    zip.file(`files/${folder}/${file.file_name}`, blob);
                    
                    chrome.runtime.sendMessage({
                        type: 'status',
                        text: `Processed ${file.file_name}`,
                        state: 'progress'
                    });
                } catch (error) {
                    console.error(`Failed to process ${file.file_name}:`, error);
                }
            }
        }
    }
}

console.log('Chat extractor ready - click the extension icon to start extraction');