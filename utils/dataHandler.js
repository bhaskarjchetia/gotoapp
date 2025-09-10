const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data.json');
const USER_FILE = path.join(__dirname, '..', 'user.json');

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

function readUsers() {
    try {
        const users = fs.readFileSync(USER_FILE, 'utf8');
        return JSON.parse(users);
    } catch (error) {
        console.error('Error reading user file:', error);
        return []; // Return an empty array if file doesn't exist or is empty
    }
}

function writeUsers(users) {
    try {
        fs.writeFileSync(USER_FILE, JSON.stringify(users, null, 4), 'utf8');
    } catch (error) {
        console.error('Error writing user file:', error);
    }
}

module.exports = { readData, writeData, readUsers, writeUsers };