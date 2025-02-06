// content.js
console.log('Claude Chat Extractor loading...');

// Inject the findMessages script
function injectFindMessages() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected.js');
    script.onload = function() {
        this.remove(); // Remove script after loading
    };
    (document.head || document.documentElement).appendChild(script);
}

// Listen for messages from injected script
window.addEventListener('message', event => {
    if (event.data.type === 'FOUND_MESSAGES') {
        const messages = event.data.messages;
        if (messages && messages.length > 0) {
            console.log(`Processing ${messages.length} messages for download...`);
            
            // Create JSON file
            const blob = new Blob([JSON.stringify(messages, null, 2)], 
                { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            // Download chat JSON
            chrome.runtime.sendMessage({
                type: 'download',
                options: {
                    url: url,
                    filename: `claude-chat-${Date.now()}.json`,
                    saveAs: true
                }
            });

            // Download all files from messages
            messages.forEach(msg => {
                // Handle attachments
                if (msg.attachments?.length > 0) {
                    msg.attachments.forEach(att => {
                        if (att.preview_url) {
                            chrome.runtime.sendMessage({
                                type: 'download',
                                options: {
                                    url: 'https://claude.ai' + att.preview_url,
                                    filename: att.file_name
                                }
                            });
                        }
                    });
                }

                // Handle files
                if (msg.files?.length > 0) {
                    msg.files.forEach(file => {
                        if (file.preview_url) {
                            chrome.runtime.sendMessage({
                                type: 'download',
                                options: {
                                    url: 'https://claude.ai' + file.preview_url,
                                    filename: file.file_name || file.name
                                }
                            });
                        }
                    });
                }

                // Handle files_v2 if they exist
                if (msg.files_v2?.length > 0) {
                    msg.files_v2.forEach(file => {
                        if (file.preview_url) {
                            chrome.runtime.sendMessage({
                                type: 'download',
                                options: {
                                    url: 'https://claude.ai' + file.preview_url,
                                    filename: file.file_name || file.name
                                }
                            });
                        }
                    });
                }
            });
        } else {
            console.log('No messages found');
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