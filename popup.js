// popup.js
let isClosing = false;
let port;

document.addEventListener('DOMContentLoaded', function() {
    port = chrome.runtime.connect({name: 'popup'});
    
    function handleError(error) {
        const status = document.getElementById('status');
        if (status) {
            status.textContent = 'Connection error. Please refresh the page.';
            status.className = 'error';
        }
        console.error('Connection error:', error);
    }

    function checkContentScript(tabId) {
        return new Promise((resolve) => {
            chrome.tabs.sendMessage(tabId, { type: 'ping' }, response => {
                resolve(!chrome.runtime.lastError && response === 'pong');
            });
        });
    }

    async function injectContentScript(tabId) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                files: ['content.js']
            });
            return true;
        } catch (error) {
            console.error('Failed to inject content script:', error);
            return false;
        }
    }

    chrome.tabs.query({active: true, currentWindow: true}, async function(tabs) {
        const isClaudePage = tabs[0].url.startsWith('https://claude.ai');
        const downloadContainer = document.querySelector('.download-container');
        const extractBtn = document.getElementById('extract');
        const status = document.getElementById('status');

        if (isClaudePage) {
            extractBtn.style.display = 'flex';
            status.style.display = 'block';
            status.textContent = 'Ready to download your chat';
            status.className = 'default';
            
            extractBtn.addEventListener('click', async function() {
                const button = this;
                button.classList.add('processing');
                
                try {
                    // Check if content script is loaded
                    const isContentScriptLoaded = await checkContentScript(tabs[0].id);
                    if (!isContentScriptLoaded) {
                        // Inject content script if not loaded
                        const injected = await injectContentScript(tabs[0].id);
                        if (!injected) {
                            throw new Error('Failed to inject content script');
                        }
                    }

                    // Now send the extract message
                    chrome.tabs.sendMessage(tabs[0].id, {type: 'extract'}, function(response) {
                        if (chrome.runtime.lastError && !isClosing) {
                            console.error('Error:', chrome.runtime.lastError);
                            button.classList.remove('processing');
                            return;
                        }
                        console.log('Extraction started:', response);
                    });
                } catch (error) {
                    console.error('Failed to start extraction:', error);
                    button.classList.remove('processing');
                    status.textContent = 'Failed to start extraction. Please refresh the page.';
                    status.className = 'error';
                }
            });
        } else {
            downloadContainer.innerHTML = `
                <div class="default-message">
                    Please visit <a href="https://claude.ai" target="_blank">claude.ai</a> to download chat history
                </div>
            `;
        }
    });

    // Listen for status updates
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === 'status') {
            const status = document.getElementById('status');
            const extractBtn = document.getElementById('extract');
            
            if (status) {
                status.textContent = request.text;
                status.className = request.state;
                
                if (request.state === 'success') {
                    // Don't close yet, just update UI
                    extractBtn.classList.remove('processing');
                } else if (request.state === 'error') {
                    // Close on error after cleanup
                    extractBtn.classList.remove('processing');
                    cleanupAndClose();
                } else if (request.state === 'downloaded') {
                    // Clean up and close after actual download
                    cleanupAndClose();
                }
            }
            // Send response to acknowledge receipt
            sendResponse({received: true});
            return true; // Keep message channel open until response is sent
        }
    });

    // Add cleanup function
    function cleanupAndClose() {
        // Disconnect port
        if (port) {
            port.disconnect();
            port = null;
        }
        // Set closing flag
        isClosing = true;
        // Give a small delay for cleanup
        setTimeout(() => {
            window.close();
        }, 100);
    }

    // Update window close handler
    window.addEventListener('beforeunload', () => {
        isClosing = true;
    });
});