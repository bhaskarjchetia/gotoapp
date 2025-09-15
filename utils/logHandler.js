const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'public', 'storage', 'logs.json');

function readLogs() {
    try {
        if (fs.existsSync(LOG_FILE)) {
            const data = fs.readFileSync(LOG_FILE, 'utf8');
            return JSON.parse(data);
        } else {
            return [];
        }
    } catch (error) {
        console.error('Error reading logs.json:', error);
        return [];
    }
}

function writeLogs(logs) {
    try {
        fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), 'utf8');
    } catch (error) {
        console.error('Error writing logs.json:', error);
    }
}

function clearLogs() {
    try {
        fs.writeFileSync(LOG_FILE, JSON.stringify([], null, 2), 'utf8');
        console.log('logs.json cleared.');
    } catch (error) {
        console.error('Error clearing logs.json:', error);
    }
}

function logApiCall(endpoint, method, responseData) {
    const logs = readLogs();
    logs.push({
        timestamp: new Date().toISOString(),
        endpoint: endpoint,
        method: method,
        responseData: responseData
    });
    writeLogs(logs);
}

module.exports = { readLogs, writeLogs, clearLogs, logApiCall };