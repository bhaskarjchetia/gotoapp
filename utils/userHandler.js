const fs = require('fs');
const path = require('path');
const { ensureDirectoryExists } = require('./fileUtils');

const USERS_FILE = path.join(__dirname, '..', 'public', 'storage', 'user.json');

// Ensure the user.json file exists
function initializeUsersFile() {
    ensureDirectoryExists(path.dirname(USERS_FILE));
    if (!fs.existsSync(USERS_FILE)) {
        fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2), 'utf8');
    }
}

const readUsers = () => {
    initializeUsersFile();
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data);
};

const writeUsers = (users) => {
    ensureDirectoryExists(path.dirname(USERS_FILE));
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
};

const addUser = (email, password) => {
    const data = readUsers();
    const newUser = { id: Date.now().toString(), email, password };
    data.users.push(newUser);
    writeUsers(data);
    return newUser;
};

const findUser = (email, password) => {
    const data = readUsers();
    return data.users.find(user => user.email === email && user.password === password);
};

const updateUser = (id, newEmail, newPassword) => {
    const data = readUsers();
    const userIndex = data.users.findIndex(user => user.id === id);
    if (userIndex !== -1) {
        data.users[userIndex].email = newEmail;
        data.users[userIndex].password = newPassword;
        writeUsers(data);
        return data.users[userIndex];
    }
    return null;
};

const deleteUser = (id) => {
    const data = readUsers();
    const initialLength = data.users.length;
    data.users = data.users.filter(user => user.id !== id);
    writeUsers(data);
    return data.users.length < initialLength;
};

module.exports = {
    readUsers,
    writeUsers,
    addUser,
    findUser,
    updateUser,
    deleteUser
};