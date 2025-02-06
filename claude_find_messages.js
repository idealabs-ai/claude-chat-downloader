async function findMessages() {
    console.log('Starting DOM snapshot...');
    const startTime = performance.now();

    // First get a clean DOM snapshot
    async function snapshot(node, depth = 0) {
        if (!node || depth > 100) return null;
        
        const result = {
            props: {},
            children: []
        };

        try {
            // Get all properties
            const props = Object.getOwnPropertyNames(node);
            for (const prop of props) {
                try {
                    const value = node[prop];
                    if (value && typeof value === 'object') {
                        result.props[prop] = value;
                    }
                } catch (e) {
                    continue;
                }
            }

            // Get children if any
            if (node.hasChildNodes && node.hasChildNodes()) {
                for (const child of Array.from(node.childNodes)) {
                    const childResult = await snapshot(child, depth + 1);
                    if (childResult) {
                        result.children.push(childResult);
                    }
                }
            }
        } catch (e) {
            // Skip errors
        }

        return result;
    }

    // Get the snapshot
    const domSnapshot = await snapshot(document.documentElement);
    
    // Now search for messages in the clean snapshot
    const messages = new Map();
    
    function isMessage(obj) {
        return obj && 
               typeof obj === 'object' &&
               obj.uuid &&
               obj.content &&
               Array.isArray(obj.content) &&
               obj.sender;
    }

    function searchMessages(obj) {
        if (!obj || typeof obj !== 'object') return;
        
        if (isMessage(obj)) {
            messages.set(obj.uuid, obj);
            return;
        }

        // Search in object properties
        if (obj.props) {
            Object.values(obj.props).forEach(value => {
                if (value && typeof value === 'object') {
                    searchMessages(value);
                }
            });
        }

        // Search in children
        if (Array.isArray(obj.children)) {
            obj.children.forEach(child => searchMessages(child));
        }
    }

    // Process individual message
    function processMessage(msg) {
        const result = {
            uuid: msg.uuid,
            sender: msg.sender,
            time: new Date(msg.created_at).toLocaleString(),
            parent_uuid: msg.parent_message_uuid,
            text: msg.content.find(c => c.type === 'text')?.text,
            content: msg.content,
            attachments: [],
            files: [],
            files_v2: []
        };

        // Process attachments
        if (msg.attachments && Array.isArray(msg.attachments)) {
            result.attachments = msg.attachments.map(att => ({
                id: att.id,
                name: att.file_name,
                type: att.file_type,
                created: new Date(att.created_at).toLocaleString(),
                content: att.extracted_content,
                downloadUrl: att.preview_url ? 'https://claude.ai' + att.preview_url : null
            }));
        }

        // Process files
        if (msg.files && Array.isArray(msg.files)) {
            result.files = msg.files.map(file => ({
                kind: file.file_kind,
                uuid: file.file_uuid,
                name: file.file_name,
                created: new Date(file.created_at).toLocaleString(),
                preview: file.preview_url ? 'https://claude.ai' + file.preview_url : null,
                thumbnail: file.thumbnail_url ? 'https://claude.ai' + file.thumbnail_url : null,
                rawPreviewUrl: file.preview_url,
                rawThumbnailUrl: file.thumbnail_url
            }));
        }

        // Process files_v2
        if (msg.files_v2 && Array.isArray(msg.files_v2)) {
            result.files_v2 = msg.files_v2.map(file => ({
                kind: file.file_kind,
                uuid: file.file_uuid,
                name: file.file_name,
                created: new Date(file.created_at).toLocaleString(),
                preview: file.preview_url ? 'https://claude.ai' + file.preview_url : null,
                thumbnail: file.thumbnail_url ? 'https://claude.ai' + file.thumbnail_url : null,
                rawPreviewUrl: file.preview_url,
                rawThumbnailUrl: file.thumbnail_url
            }));
        }

        return result;
    }

    // Search the snapshot
    searchMessages(domSnapshot);

    const results = Array.from(messages.values())
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .map(processMessage);

    const endTime = performance.now();
    console.log(`Found ${results.length} messages in ${(endTime - startTime).toFixed(2)}ms`);

    return results;
}

// Helper function to download a file
async function downloadFile(url, filename) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const blob = await response.blob();
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
        
        console.log(`Downloaded: ${filename}`);
    } catch (e) {
        console.error(`Failed to download ${filename}:`, e);
    }
}

// Display function with details
function showMessages() {
    return findMessages().then(messages => {
        console.log(`Found ${messages.length} messages`);
        
        messages.forEach((msg, index) => {
            console.group(`Message ${index + 1}: ${msg.sender} at ${msg.time}`);
            console.log('UUID:', msg.uuid);
            console.log('Parent UUID:', msg.parent_uuid);
            console.log('Text:', msg.text);
            
            // Show all content items
            if (msg.content && msg.content.length > 0) {
                console.group('Content Items:');
                msg.content.forEach(item => {
                    console.log(item);
                });
                console.groupEnd();
            }
            
            if (msg.attachments.length > 0) {
                console.group('Attachments:');
                msg.attachments.forEach(att => {
                    console.log(`- ${att.name} (${att.type})`);
                    if (att.downloadUrl) {
                        console.log(`  Download URL: ${att.downloadUrl}`);
                    }
                    if (att.content) {
                        console.log('  Has extracted content');
                    }
                });
                console.groupEnd();
            }

            if (msg.files.length > 0) {
                console.group('Files:');
                msg.files.forEach(file => {
                    console.log(`- ${file.name} (${file.kind})`);
                    if (file.preview) console.log(`  Preview: ${file.preview}`);
                    if (file.thumbnail) console.log(`  Thumbnail: ${file.thumbnail}`);
                });
                console.groupEnd();
            }

            console.groupEnd();
        });

        return messages;
    });
}

// Download helper
async function downloadAllFiles(messageUuid) {
    const messages = await findMessages();
    const message = messages.find(m => m.uuid === messageUuid);
    if (!message) {
        console.error('Message not found');
        return;
    }

    // Download attachments
    for (const att of message.attachments) {
        if (att.downloadUrl) {
            await downloadFile(att.downloadUrl, att.name);
        }
    }

    // Download files
    for (const file of message.files) {
        if (file.preview) {
            await downloadFile(file.preview, file.name);
        }
    }
}

// Export as JSON file
function exportChat() {
    return findMessages().then(messages => {
        const blob = new Blob([JSON.stringify(messages, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `chat-export-${Date.now()}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    });
}

// Use like:
// showMessages();
// downloadAllFiles('message-uuid-here');
// exportChat();