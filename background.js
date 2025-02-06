// Handle downloads and message passing
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'download') {
        chrome.downloads.download(message.options);
    }
    else if (message.type === 'status') {
        // Forward status to popup
        chrome.runtime.sendMessage(message);
    }
    return true;
}); 