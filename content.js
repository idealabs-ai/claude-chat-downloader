// content.js
if (!window.location.hostname.includes('claude.ai')) {
    console.log('Claude Chat Extractor: This extension only works on claude.ai');
} else {
    console.log('Claude Chat Extractor loading...');
    
    let port = null;
    
    // Only setup connection when needed
    function setupConnection() {
        if (!port) {
            try {
                port = chrome.runtime.connect({name: 'content'});
                port.onDisconnect.addListener(() => {
                    console.log('Port disconnected');
                    port = null;
                });
            } catch (error) {
                console.error('Connection failed:', error);
                port = null;
            }
        }
    }

    // Update status message sender to connect only when sending
    function sendStatusMessage(text, state) {
        try {
            chrome.runtime.sendMessage({
                type: 'status',
                text: text,
                state: state
            });
        } catch (error) {
            console.error('Failed to send status:', error);
        }
    }

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
                const zip = new JSZip();
                
                // Add chat JSON
                zip.file('chat.json', JSON.stringify(messages, null, 2));

                // Initialize formatted content
                let htmlContent = formatters.html.start();
                let mdContent = formatters.markdown.start();
                
                // Process each message
                for (const msg of messages) {
                    await processMessageContent(msg, zip, messages);
                    htmlContent += formatters.html.message(msg);
                    mdContent += formatters.markdown.message(msg);
                }

                // Add endings
                htmlContent += formatters.html.end();
                mdContent += formatters.markdown.end();
                
                // Save HTML and MD
                zip.file('chat.html', htmlContent);
                zip.file('chat.md', mdContent);

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
                                type: file.file_kind === 'image' ? 'image/png' : 'application/octet-stream'
                            });
                        }
                    });
                });

                console.log(`Found ${uniqueFiles.size} unique files to download`);

                // Create folders
                const filesFolder = zip.folder('files');
                const imagesFolder = filesFolder.folder('images');
                const attachmentsFolder = filesFolder.folder('attachments');

                // Create download promises array
                const downloadPromises = [
                    // Existing file downloads
                    ...Array.from(uniqueFiles.values()).map(async file => {
                        try {
                            console.log(`Downloading ${file.name} from ${file.url}`);
                            const response = await fetch(file.url);
                            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                            const blob = await response.blob();
                            
                            const folder = file.type.startsWith('image/') ? imagesFolder : attachmentsFolder;
                            folder.file(file.name, blob);
                            
                            sendStatusMessage(`Downloaded ${file.name}...`, 'progress');

                            return true;
                        } catch (error) {
                            console.error(`Failed to download ${file.name}:`, error);
                            return false;
                        }
                    })
                ];

                // Get chat name from page title or URL with timestamp
                let chatName = document.title.replace(/[^a-z0-9]/gi, '-').toLowerCase();
                if (chatName === 'claude' || chatName === '') {
                    chatName = 'claude-chat';
                }
                // Add timestamp to all downloads
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5); // Format: YYYY-MM-DDTHHMM
                const zipFileName = `${chatName}-${timestamp}.zip`;

                // Wait for ALL operations to complete
                Promise.all(downloadPromises)
                    .then(async results => {
                        console.log('All downloads completed, creating ZIP...');
                        const blob = await zip.generateAsync({type: 'blob'});
                        const url = URL.createObjectURL(blob);
                        
                        // Add this back - send to background script for download
                        chrome.runtime.sendMessage({
                            type: 'download',
                            options: {
                                url: url,
                                filename: zipFileName,
                                saveAs: true
                            }
                        });

                        sendStatusMessage(`Download complete! (${results.filter(Boolean).length} files included)`, 'success');
                    })
                    .catch(error => {
                        console.error('Error in download process:', error);
                        sendStatusMessage('Error creating download package', 'error');
                    });
            } else {
                console.log('No messages found');
                sendStatusMessage('No messages found', 'error');
            }
        } else if (event.data.type === 'DEBUG_DATA') {
            console.log('Debug data received');
            
            // Create JSON file
            const blob = new Blob([JSON.stringify(event.data.data, null, 2)], 
                { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            // Download via background script
            sendStatusMessage(`Downloading debug data...`, 'progress');
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
            sendResponse({status: 'started'});
            return false; // Don't keep the message channel open
        }
    });

    // Add these content formatters at the top
    const formatters = {
        html: {
            start: () => `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            max-width: 900px;
            margin: 0 auto;
            padding: 2rem;
            background: #f8f9fa;
        }
        .message { 
            margin: 1.5rem 0;
            padding: 1.5rem;
            border-radius: 8px;
            background: white;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .message-header {
            font-weight: 600;
            margin-bottom: 1rem;
            color: #495057;
        }
        .human { 
            border-left: 4px solid #6c757d;
        }
        .human .message-header {
            color: #6c757d;
        }
        .assistant { 
            border-left: 4px solid #0d6efd;
        }
        .assistant .message-header {
            color: #0d6efd;
        }
        .file-attachment {
            display: flex;
            align-items: center;
            margin: 1rem 0;
            padding: 0.75rem;
            background: #f8f9fa;
            border-radius: 6px;
            border: 1px solid #dee2e6;
        }
        .file-icon {
            margin-right: 0.75rem;
            color: #6c757d;
        }
        .file-info {
            flex-grow: 1;
        }
        .file-name {
            font-weight: 500;
            color: #0d6efd;
            text-decoration: none;
        }
        .file-name:hover {
            text-decoration: underline;
        }
        .file-type {
            font-size: 0.875rem;
            color: #6c757d;
        }
        img {
            max-width: 100%;
            height: auto;
            border-radius: 4px;
        }
        pre {
            background: #f8f9fa;
            padding: 1rem;
            border-radius: 4px;
            overflow-x: auto;
        }
        code {
            font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
        }
    </style>
</head>
<body>
<h1>Claude Chat Export</h1>`,
            end: () => `</body></html>`,
            message: (msg) => {
                const content = msg.content.map(item => {
                    if (item.type === 'text') {
                        return `<p>${item.text.replace(/\n/g, '<br>')}</p>`;
                    }
                    if (item.type === 'tool_use' && item.name === 'artifacts') {
                        const timestamp = new Date(item.stop_timestamp).getTime();
                        const filename = `files/artifacts/${item.input.id}_${timestamp}${item.input.language ? '.' + item.input.language : ''}`;
                        return `<pre><code class="language-${item.input.language || 'text'}">${item.input.content}</code></pre>
                                <div class="file-attachment">
                                    <div class="file-icon">📄</div>
                                    <div class="file-info">
                                        <a href="${filename}" class="file-name">${item.input.title}</a>
                                        <div class="file-type">Artifact</div>
                                    </div>
                                </div>`;
                    }
                    return '';
                }).join('\n');

                // Track which files we've handled to avoid duplicates
                const handledFiles = new Set();

                // Handle all types of files
                const files = [
                    // Handle attachments
                    ...(msg.attachments || []).map(att => `
                        <div class="file-attachment">
                            <div class="file-icon">📎</div>
                            <div class="file-info">
                                <a href="files/attachments/${att.file_name.replace(/\.[^/.]+$/, '')}_${att.id}${getExtFromName(att.file_name)}" class="file-name">${att.file_name}</a>
                                <div class="file-type">Attachment</div>
                            </div>
                        </div>
                    `),
                    // Handle files and files_v2
                    ...((msg.files || []).concat(msg.files_v2 || [])).map(file => {
                        if (handledFiles.has(file.file_name)) return ''; // Skip if already handled
                        handledFiles.add(file.file_name);

                        if (file.file_kind === 'image') {
                            return `
                                <div class="file-attachment">
                                    <a href="files/images/${file.file_name}" target="_blank">
                                        <img src="files/images/${file.file_name}" alt="${file.file_name}">
                                    </a>
                                    <div class="file-info">
                                        <span class="file-name">${file.file_name}</span>
                                        <div class="file-type">Image - Click to open</div>
                                    </div>
                                </div>`;
                        } else {
                            const folder = file.file_kind === 'document' ? 'other' : 'other';
                            return `
                                <div class="file-attachment">
                                    <div class="file-icon">📄</div>
                                    <div class="file-info">
                                        <a href="files/${folder}/${file.file_name}" class="file-name">${file.file_name}</a>
                                        <div class="file-type">${file.file_kind || 'File'}</div>
                                    </div>
                                </div>`;
                        }
                    })
                ].filter(Boolean).join('\n'); // Filter out empty strings

                return `
                    <div class="message ${msg.sender}">
                        <div class="message-header">
                            ${msg.sender === 'human' ? '👤 Human' : '🤖 Claude'}
                        </div>
                        ${content}
                        ${files}
                    </div>`;
            }
        },
        markdown: {
            start: () => `# Claude Chat Export\n\n`,
            end: () => ``,
            message: (msg) => {
                const sender = msg.sender === 'human' ? '👤 **Human:**' : '🤖 **Claude:**';
                
                const content = msg.content.map(item => {
                    if (item.type === 'text') {
                        return item.text;
                    }
                    if (item.type === 'tool_use' && item.name === 'artifacts') {
                        const timestamp = new Date(item.stop_timestamp).getTime();
                        const filename = `files/artifacts/${item.input.id}_${timestamp}${item.input.language ? '.' + item.input.language : ''}`;
                        return `\`\`\`${item.input.language || ''}\n${item.input.content}\n\`\`\`\n📄 [${item.input.title}](${filename})`;
                    }
                    return '';
                }).join('\n\n');

                // Track which files we've handled to avoid duplicates
                const handledFiles = new Set();

                // Handle all types of files
                const files = [
                    // Handle attachments
                    ...(msg.attachments || []).map(att => 
                        `📎 [${att.file_name}](files/attachments/${att.file_name.replace(/\.[^/.]+$/, '')}_${att.id}${getExtFromName(att.file_name)})`
                    ),
                    // Handle files and files_v2
                    ...((msg.files || []).concat(msg.files_v2 || [])).map(file => {
                        if (handledFiles.has(file.file_name)) return ''; // Skip if already handled
                        handledFiles.add(file.file_name);

                        if (file.file_kind === 'image') {
                            return `![${file.file_name}](files/images/${file.file_name})`;
                        } else {
                            const folder = file.file_kind === 'document' ? 'other' : 'other';
                            return `📄 [${file.file_name}](files/${folder}/${file.file_name})`;
                        }
                    })
                ].filter(Boolean).join('\n');

                return `${sender}\n\n${content}\n\n${files}\n\n---\n`;
            }
        },
        pdf: {
            start: () => `<!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            @page { margin: 1cm; }
            body { font-family: Arial, sans-serif; line-height: 1.6; }
            .message { margin: 1em 0; padding: 1em; border: 1px solid #ddd; page-break-inside: avoid; }
            .human { background: #f5f5f5; }
            .assistant { background: #f0f7ff; }
            img { max-width: 100%; }
            pre { background: #f0f0f0; padding: 1em; overflow-x: auto; white-space: pre-wrap; }
            @media print {
                .message { break-inside: avoid; }
                pre { white-space: pre-wrap; }
            }
        </style>
    </head>
    <body>`,
            end: () => `</body></html>`,
            message: (msg) => {
                const content = msg.content.map(item => {
                    if (item.type === 'text') {
                        return `<p>${item.text.replace(/\n/g, '<br>')}</p>`;
                    }
                    if (item.type === 'tool_use' && item.name === 'artifacts') {
                        const filename = `files/artifacts/${item.input.title}${item.input.language ? '.' + item.input.language : ''}`;
                        return `<pre><code class="language-${item.input.language || 'text'}">${item.input.content}</code></pre>
                                <p><a href="${filename}">Download ${item.input.title}</a></p>`;
                    }
                    return '';
                }).join('\n');

                // Handle attachments and files
                const files = [
                    ...(msg.attachments || []).map(att => 
                        `<p>Attachment: <a href="files/attachments/${att.file_name}">${att.file_name}</a></p>`
                    ),
                    ...(msg.files || []).map(file => {
                        if (file.file_kind === 'image') {
                            return `<p><img src="files/images/${file.file_name}" alt="${file.file_name}"></p>`;
                        }
                        return `<p>File: <a href="files/other/${file.file_name}">${file.file_name}</a></p>`;
                    })
                ].join('\n');

                return `<div class="message ${msg.sender}">
                    ${content}
                    ${files}
                </div>`;
            }
        }
    };

    // At the top level, add a state object to track artifacts
    let artifactVersions = new Map();

    // Process message content
    async function processMessageContent(msg, zip, messages) {
        // Handle embedded content (attachments)
        if (msg.attachments?.length > 0) {
            for (const att of msg.attachments) {
                console.log('Processing attachment:', {
                    id: att.id,
                    name: att.file_name,
                    type: att.file_type || 'unknown',
                    hasContent: !!att.extracted_content,
                    hasPreview: !!att.preview_url
                });

                // Handle extracted content
                if (att.extracted_content) {
                    const handler = (att.file_type && contentHandlers.embedded[att.file_type]) || 
                                  contentHandlers.embedded.default;
                    const result = handler(att.extracted_content);
                    
                    const fileExt = getExtFromName(att.file_name) || result.extension;
                    const fileName = `${att.file_name.replace(/\.[^/.]+$/, '')}_${att.id}${fileExt}`;
                    
                    console.log('Saving attachment content:', fileName);
                    zip.file(`files/attachments/${fileName}`, result.content);
                }
                
                // Handle preview URL if available
                if (att.preview_url) {
                    try {
                        console.log(`Downloading attachment: ${att.file_name} from ${att.preview_url}`);
                        const response = await fetch('https://claude.ai' + att.preview_url);
                        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                        const blob = await response.blob();
                        
                        const fileName = att.file_name;
                        console.log('Saving attachment file:', fileName);
                        zip.file(`files/attachments/${fileName}`, blob);
                    } catch (error) {
                        console.error(`Failed to download attachment ${att.file_name}:`, error);
                    }
                }
            }
        }

        // Handle artifacts
        for (const item of msg.content || []) {
            if (item.type === 'tool_use' && 
                item.name === 'artifacts' && 
                item.input?.id) {
                
                console.log('Processing artifact:', {
                    id: item.input.id,
                    command: item.input.command,
                    type: item.input.type,
                    hasOldStr: !!item.input.old_str,
                    hasNewStr: !!item.input.new_str,
                    stop_time: item.stop_timestamp
                });

                // For create command, we need type and content
                if (item.input.command === 'create' && item.input.type && item.input.content) {
                    const handler = contentHandlers.embedded[item.input.type] || 
                                  contentHandlers.embedded.default;
                    const result = handler(item.input.content, {
                        language: item.input.language
                    });

                    const timestamp = new Date(item.stop_timestamp).getTime();
                    const fileName = `${item.input.id}_${timestamp}${result.extension}`;
                    const artifactPath = `files/artifacts/${fileName}`;

                    console.log('Creating new artifact:', fileName);
                    zip.file(artifactPath, result.content);
                    artifactVersions.set(item.input.id, {
                        path: artifactPath,
                        timestamp,
                        content: result.content,
                        extension: result.extension,
                        language: item.input.language
                    });
                }
                // For update command, we need old_str and new_str
                else if (item.input.command === 'update' && 
                        item.input.old_str && 
                        item.input.new_str) {
                    
                    const lastVersion = artifactVersions.get(item.input.id);
                    if (lastVersion) {
                        console.log('Updating artifact:', {
                            id: item.input.id,
                            from: lastVersion.path
                        });

                        const timestamp = new Date(item.stop_timestamp).getTime();
                        const fileName = `${item.input.id}_${timestamp}${lastVersion.extension}`;
                        const artifactPath = `files/artifacts/${fileName}`;

                        try {
                            const existingContent = await zip.file(lastVersion.path).async('string');
                            const updatedContent = existingContent.replace(
                                new RegExp(escapeRegExp(item.input.old_str), 'g'),
                                item.input.new_str
                            );
                            
                            console.log('Content updated:', {
                                before: existingContent.substring(0, 100),
                                after: updatedContent.substring(0, 100)
                            });

                            zip.file(artifactPath, updatedContent);
                            artifactVersions.set(item.input.id, {
                                path: artifactPath,
                                timestamp,
                                content: updatedContent,
                                extension: lastVersion.extension,
                                language: lastVersion.language
                            });
                        } catch (error) {
                            console.error('Failed to update artifact:', error);
                        }
                    } else {
                        console.warn('No previous version found for update:', item.input.id);
                    }
                }
            }
        }

        // Handle files
        const files = [...(msg.files || []), ...(msg.files_v2 || [])];
        for (const file of files) {
            // Get the best available URL for the file
            const fileUrl = file.document_asset?.url ||  // For PDFs and documents
                           file.preview_url ||           // For images and other previews
                           file.thumbnail_url;           // Fallback to thumbnail if nothing else

            if (fileUrl) {
                try {
                    console.log('Processing file:', {
                        name: file.file_name,
                        kind: file.file_kind || 'unknown',
                        url: fileUrl
                    });

                    const response = await fetch('https://claude.ai' + fileUrl);
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                    const blob = await response.blob();

                    // Put images in images folder, everything else in other
                    const folder = file.file_kind === 'image' ? 'images' : 'other';
                    zip.file(`files/${folder}/${file.file_name}`, blob);
                    
                    console.log(`Saved file: ${file.file_name} to ${folder}/`);
                    sendStatusMessage(`Processed ${file.file_name}`, 'progress');
                } catch (error) {
                    console.error(`Failed to process ${file.file_name}:`, error);
                }
            } else {
                console.warn(`No URL found for file: ${file.file_name}`);
            }
        }
    }

    // Add helper function at the top
    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
    }

    console.log('Chat extractor ready - click the extension icon to start extraction');
}