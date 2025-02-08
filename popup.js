// popup.js
document.addEventListener('DOMContentLoaded', function() {
    let port = chrome.runtime.connect({name: 'popup'});
    
    function handleError(error) {
        const status = document.getElementById('status');
        if (status) {
            status.textContent = 'Connection error. Please refresh the page.';
            status.className = 'error';
        }
        console.error('Connection error:', error);
    }

    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        const isClaudePage = tabs[0].url.startsWith('https://claude.ai');
        const downloadContainer = document.querySelector('.download-container');
        const extractBtn = document.getElementById('extract');
        const status = document.getElementById('status');

        if (isClaudePage) {
            extractBtn.style.display = 'flex';
            status.style.display = 'block';
            status.textContent = ' Ready to download your chat';
            status.className = 'default'; // Add default class for initial state
            
            extractBtn.addEventListener('click', function() {
                this.classList.add('processing');
                
                // Query for the active tab
                chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                    if (tabs[0]) {
                        // Send message and wait for response
                        chrome.tabs.sendMessage(tabs[0].id, {type: 'extract'}, function(response) {
                            if (chrome.runtime.lastError) {
                                console.error('Error:', chrome.runtime.lastError);
                                return;
                            }
                            console.log('Extraction started:', response);
                        });
                    }
                });
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
                
                if (request.state === 'success' || request.state === 'error') {
                    extractBtn.disabled = false;
                    extractBtn.classList.remove('processing');
                    extractBtn.querySelector('.button-text').textContent = 'Download Chat';
                }
            }
        }
    });
});