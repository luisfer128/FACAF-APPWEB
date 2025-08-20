export function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("FACAF-DB", 1);
      request.onupgradeneeded = function (event) {
        const db = event.target.result;
        if (!db.objectStoreNames.contains("data")) {
          db.createObjectStore("data");
        }
      };
      request.onsuccess = function (event) {
        resolve(event.target.result);
      };
      request.onerror = function (event) {
        reject(event.target.error);
      };
    });
  }
  
  export async function saveData(key, value) {
    const db = await openDB();
    const tx = db.transaction("data", "readwrite");
    const store = tx.objectStore("data");
    store.put(value, key);
    return tx.complete;
  }
  
  export async function loadData(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("data", "readonly");
      const store = tx.objectStore("data");
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  
  export async function removeData(key) {
    const db = await openDB();
    const tx = db.transaction("data", "readwrite");
    const store = tx.objectStore("data");
    store.delete(key);
    return tx.complete;
  }
  