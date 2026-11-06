// Simplified MetabolismNode class for clean position lookups
class MetabolismNode {
    static nodes = new Map(); // "nodeName-methodName-system" -> {x, y, globalCol, globalRow, col, row}
    
    static set(key, position) {
        this.nodes.set(key, position);
    }
    
    static get(key) {
        return this.nodes.get(key);
    }
    
    static clear() {
        this.nodes.clear();
    }
    
    static has(key) {
        return this.nodes.has(key);
    }
    
    static entries() {
        return this.nodes.entries();
    }
    
    static values() {
        return this.nodes.values();
    }
    
    static keys() {
        return this.nodes.keys();
    }
    
    static size() {
        return this.nodes.size;
    }
}

// Make it available globally if needed
if (typeof window !== 'undefined') {
    window.MetabolismNode = MetabolismNode;
}