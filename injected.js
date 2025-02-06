async function findMessages() {
    console.log('Starting DOM snapshot...');
    const startTime = performance.now();

    // First get a clean DOM snapshot
    async function snapshot(node, depth = 0) {
        if (!node || depth > 100) return null;
        
        const result = {
            props: {},
            children: []
        };

        try {
            // Get all properties
            const props = Object.getOwnPropertyNames(node);
            for (const prop of props) {
                try {
                    const value = node[prop];
                    if (value && typeof value === 'object') {
                        result.props[prop] = value;
                    }
                } catch (e) {
                    continue;
                }
            }

            // Get children if any
            if (node.hasChildNodes && node.hasChildNodes()) {
                for (const child of Array.from(node.childNodes)) {
                    const childResult = await snapshot(child, depth + 1);
                    if (childResult) {
                        result.children.push(childResult);
                    }
                }
            }
        } catch (e) {
            // Skip errors
        }

        return result;
    }

    // Get the snapshot
    const domSnapshot = await snapshot(document.documentElement);
    
    // Now search for messages in the clean snapshot
    const messages = new Map();
    
    function isMessage(obj) {
        return obj && 
               typeof obj === 'object' &&
               obj.uuid &&
               obj.content &&
               Array.isArray(obj.content) &&
               obj.sender;
    }

    function searchMessages(obj) {
        if (!obj || typeof obj !== 'object') return;
        
        if (isMessage(obj)) {
            messages.set(obj.uuid, obj);
            return;
        }

        // Search in object properties
        if (obj.props) {
            Object.values(obj.props).forEach(value => {
                if (value && typeof value === 'object') {
                    searchMessages(value);
                }
            });
        }

        // Search in children
        if (Array.isArray(obj.children)) {
            obj.children.forEach(child => searchMessages(child));
        }
    }

    // Search the snapshot
    searchMessages(domSnapshot);

    const results = Array.from(messages.values())
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const endTime = performance.now();
    console.log(`Found ${results.length} messages in ${(endTime - startTime).toFixed(2)}ms`);

    // Add this: Send results back to content script
    window.postMessage({
        type: 'FOUND_MESSAGES',
        messages: results
    }, '*');

    return results;
}

// Run immediately
findMessages(); 