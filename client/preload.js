const { contextBridge, ipcRenderer } = require('electron');

// Store mapping between original functions and their wrappers
const listeners = new Map();

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: (channel, data) => ipcRenderer.send(channel, data),
    sendSync: (channel, data) => ipcRenderer.sendSync(channel, data),
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    on: (channel, func) => {
      // Create a wrapper that properly passes event and args
      const subscription = (event, ...args) => func(event, ...args);

      // Store the mapping so we can remove it later
      if (!listeners.has(channel)) {
        listeners.set(channel, new Map());
      }
      listeners.get(channel).set(func, subscription);

      ipcRenderer.on(channel, subscription);

      // Return unsubscription function for convenience
      return () => {
        const channelListeners = listeners.get(channel);
        if (channelListeners) {
          const sub = channelListeners.get(func);
          if (sub) {
            ipcRenderer.removeListener(channel, sub);
            channelListeners.delete(func);
          }
        }
      };
    },
    removeListener: (channel, func) => {
      const channelListeners = listeners.get(channel);
      if (channelListeners) {
        const subscription = channelListeners.get(func);
        if (subscription) {
          ipcRenderer.removeListener(channel, subscription);
          channelListeners.delete(func);
        }
      }
    }
  }
});
