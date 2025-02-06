// popup.js
document.addEventListener('DOMContentLoaded', () => {
    const extractBtn = document.getElementById('extract');
    const status = document.getElementById('status');
    const bundleFiles = document.getElementById('bundleFiles');
    const includeAttachments = document.getElementById('includeAttachments');

    extractBtn.addEventListener('click', async () => {
        try {
            extractBtn.disabled = true;
            status.className = '';
            status.textContent = 'Starting extraction...';

            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            // Send options to content script
            chrome.tabs.sendMessage(tab.id, { 
                type: 'extract',
                options: {
                    bundleFiles: bundleFiles.checked,
                    includeAttachments: includeAttachments.checked
                }
            });

            // Listen for status updates
            chrome.runtime.onMessage.addListener((message) => {
                if (message.type === 'status') {
                    status.textContent = message.text;
                    if (message.state === 'success') {
                        status.className = 'success';
                        extractBtn.disabled = false;
                    } else if (message.state === 'error') {
                        status.className = 'error';
                        extractBtn.disabled = false;
                    }
                }
            });

        } catch (err) {
            status.textContent = 'Error: ' + err.message;
            status.className = 'error';
            extractBtn.disabled = false;
        }
    });
});