// popup.js
document.addEventListener('DOMContentLoaded', function() {
    // Check if we're on Claude
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        const isClaudePage = tabs[0].url.startsWith('https://claude.ai');
        const content = document.querySelector('.content');

        if (isClaudePage) {
            content.innerHTML = `
                <button id="extract">
                    <span>Download Chat</span>
                </button>
                <div id="status"></div>
            `;
            
            const extractBtn = document.getElementById('extract');
            extractBtn.addEventListener('click', function() {
                this.disabled = true;
                // Add loading animation
                this.innerHTML = `
                    <span class="loading-icon"></span>
                    <span>Processing...</span>
                `;
                
                const status = document.getElementById('status');
                status.textContent = 'Starting extraction...';
                status.className = 'progress';

                chrome.tabs.sendMessage(tabs[0].id, {type: 'extract'}, function(response) {
                    if (chrome.runtime.lastError) {
                        status.textContent = 'Error: ' + chrome.runtime.lastError.message;
                        status.className = 'error';
                        extractBtn.disabled = false;
                        extractBtn.innerHTML = '<span>Download Chat</span>';
                    }
                });
            });
        } else {
            content.innerHTML = `
                <div class="not-claude">
                    <p>This extension only works on <a href="https://claude.ai" target="_blank">claude.ai</a></p>
                    <p style="font-size: 12px; margin-top: 8px;">Visit Claude to start a conversation and download your chat history.</p>
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
                
                if (request.state === 'success' || request.state === 'error') {
                    extractBtn.disabled = false;
                    extractBtn.innerHTML = '<span>Download Chat</span>';
                }
            }
        }
    });
});