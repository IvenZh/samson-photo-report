// Local-only multi-valve prototype storage.
window.SamsonBatchStore = {
  _open() {
    return new Promise(function(resolve, reject) {
      var request = indexedDB.open('samson_multivalve_prototype', 1);
      request.onupgradeneeded = function() {
        if (!request.result.objectStoreNames.contains('batch')) request.result.createObjectStore('batch');
      };
      request.onsuccess = function() { resolve(request.result); };
      request.onerror = function() { reject(request.error); };
    });
  },

  async get(key) {
    var db = await this._open();
    return new Promise(function(resolve, reject) {
      var tx = db.transaction('batch', 'readonly');
      var request = tx.objectStore('batch').get(key);
      request.onsuccess = function() { resolve(request.result || null); };
      request.onerror = function() { reject(request.error); };
    });
  },

  async set(key, value) {
    var db = await this._open();
    return new Promise(function(resolve, reject) {
      var tx = db.transaction('batch', 'readwrite');
      tx.objectStore('batch').put(value, key);
      tx.oncomplete = function() { resolve(); };
      tx.onerror = function() { reject(tx.error); };
    });
  },

  async remove(key) {
    var db = await this._open();
    return new Promise(function(resolve, reject) {
      var tx = db.transaction('batch', 'readwrite');
      tx.objectStore('batch').delete(key);
      tx.oncomplete = function() { resolve(); };
      tx.onerror = function() { reject(tx.error); };
    });
  }
};
