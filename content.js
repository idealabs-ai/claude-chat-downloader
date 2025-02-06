// content.js
console.log('Claude Chat Extractor loading...');

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
window.addEventListener('message', event => {
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

console.log('Chat extractor ready - click the extension icon to start extraction');