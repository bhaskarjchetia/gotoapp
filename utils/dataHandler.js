const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data.json');

function readData() {
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading data file:', error);
        return { accounts: [], recordings: [], transcriptions: [] };
    }
}

function writeData(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 4), 'utf8');
    } catch (error) {
        console.error('Error writing data file:', error);
    }
}

module.exports = { readData, writeData };