// popup.js
document.addEventListener('DOMContentLoaded', () => {
    const extractBtn = document.getElementById('extract');
    const status = document.getElementById('status');

    extractBtn.addEventListener('click', async () => {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            chrome.tabs.sendMessage(tab.id, { type: 'extract' });
            status.textContent = 'Extraction started...';
        } catch (err) {
            status.textContent = 'Error: ' + err.message;
        }
    });
});