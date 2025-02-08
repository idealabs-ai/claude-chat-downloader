// Keep service worker alive, but only after receiving first message
let isInitialized = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isInitialized) {
        isInitialized = true;
        // Only setup connection after first message
        chrome.runtime.connect({name: 'keepAlive'});
    }

    if (message.type === 'download') {
        chrome.downloads.download(message.options);
    }
    else if (message.type === 'status') {
        // Forward status to popup
        chrome.runtime.sendMessage(message);
    }
    return true;
}); 