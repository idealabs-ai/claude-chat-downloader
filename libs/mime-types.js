// Load the complete mime database
fetch(chrome.runtime.getURL('libs/mime-db.json'))
  .then(response => response.json())
  .then(db => {
    // Create extension to mime type mapping
    const extMap = {};
    Object.entries(db).forEach(([mimeType, data]) => {
      if (data.extensions) {
        data.extensions.forEach(ext => {
          extMap[ext] = mimeType;
        });
      }
    });

    // Create global mime object
    window.mime = {
      getType: (path) => {
        if (!path) return null;
        const ext = path.toLowerCase().split('.').pop();
        return extMap[ext] || null;
      },
      getExtension: (type) => {
        if (!type) return null;
        const mimeData = db[type];
        return mimeData && mimeData.extensions ? mimeData.extensions[0] : null;
      }
    };
  }); 