const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data.json');

function readData() {
    if (!fs.existsSync(DATA_FILE)) {
        // If file doesn't exist, create it with an empty JSON object
        fs.writeFileSync(DATA_FILE, JSON.stringify({ accounts: [], recordings: {} }, null, 2), 'utf8');
        return { accounts: [], recordings: {} };
    }
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading data file:', error.message);
        return { accounts: [], recordings: {} }; // Return default structure if file is invalid
    }
}

function writeData(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 4), 'utf8');
    } catch (error) {
        console.error('Error writing data file:', error);
    }
}

function addAccount(account) {
    const data = readData();
    data.accounts.push(account);
    writeData(data);
}

function updateAccount(updatedAccount) {
    const data = readData();
    const index = data.accounts.findIndex(acc => acc.id === updatedAccount.id);
    if (index !== -1) {
        data.accounts[index] = updatedAccount;
        writeData(data);
    }
}

function deleteAccount(accountId) {
    const data = readData();
    data.accounts = data.accounts.filter(acc => acc.id !== accountId);
    writeData(data);
}

function findAccountById(accountId) {
    const data = readData();
    return data.accounts.find(acc => acc.id === accountId);
}

function addRecordings(newRecordings) {
    const data = readData();
    data.recordings.push(...newRecordings);
    writeData(data);
}

function addTranscriptions(newTranscriptions) {
    const data = readData();
    data.transcriptions.push(...newTranscriptions);
    writeData(data);
}

module.exports = {
    readData,
    writeData,
    addAccount,
    updateAccount,
    deleteAccount,
    findAccountById,
    addRecordings,
    addTranscriptions
};