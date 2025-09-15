const fs = require('fs');
const path = require('path');

const ensureDirectoryExists = (directoryPath) => {
    if (!fs.existsSync(directoryPath)) {
        fs.mkdirSync(directoryPath, { recursive: true });
    }
};

module.exports = { ensureDirectoryExists };