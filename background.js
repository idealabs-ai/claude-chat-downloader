// Keep track of popup status
let popupOpen = false;

// Listen for popup connections
chrome.runtime.onConnect.addListener(port => {
    if (port.name === 'popup') {
        popupOpen = true;
        port.onDisconnect.addListener(() => {
            popupOpen = false;
        });
    }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'download') {
        // Handle download requests
        chrome.downloads.download(message.options, (downloadId) => {
            // Listen for the download to start (user clicks Save)
            chrome.downloads.onChanged.addListener(function onChanged({id, state}) {
                if (id === downloadId && state?.current === 'in_progress') {
                    // User clicked Save, now notify content script
                    chrome.tabs.sendMessage(sender.tab.id, {
                        type: 'download_started',
                        downloadId: downloadId
                    });
                    // Remove the listener
                    chrome.downloads.onChanged.removeListener(onChanged);
                }
            });
            sendResponse({ success: true, downloadId });
        });
        return true; // Keep the message channel open for the response
    }
    
    if (message.type === 'status' && !popupOpen) {
        // If popup is closed, acknowledge message without forwarding
        sendResponse({received: true});
        return false;
    }
    // Forward message to popup if it's open
    return true;
}); 