// Handle downloads and message passing
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'download') {
        chrome.downloads.download(message.options);
    }
    return true;
}); 