const express = require('express');
const fs = require('fs');
const { readData, writeData, deleteAccount } = require('./utils/dataHandler');
const { clearLogs } = require('./utils/logHandler');
const { readUsers, writeUsers, addUser, findUser, updateUser, deleteUser } = require('./utils/userHandler');
const axios = require('axios');
const { readLogs, writeLogs } = require('./utils/logHandler');
require('dotenv').config();

const app = express();
const bodyParser = require('body-parser');
const session = require('express-session');

// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

// Serve static files (CSS, JS, images)
app.use(express.static('public'));

// Use body-parser middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
}));
const PORT = process.env.PORT || 3000;

// Function to log API calls
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

// Function to refresh access token
async function refreshAccessToken(account) {
    const clientId = process.env.GOTO_CLIENT_ID;
    const clientSecret = process.env.GOTO_CLIENT_SECRET;
    const refreshToken = account.refreshToken;

    try {
        const tokenResponse = await axios.post('https://authentication.logmeininc.com/oauth/token',
            `grant_type=refresh_token&refresh_token=${refreshToken}`,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
                }
            }
        );

        const newAccessToken = tokenResponse.data.access_token;
        const newExpiresIn = tokenResponse.data.expires_in;
        const newExpiresAt = Date.now() / 1000 + newExpiresIn;

        const data = readData();
        const accountIndex = data.accounts.findIndex(acc => acc.id === account.id);
        if (accountIndex !== -1) {
            data.accounts[accountIndex].accessToken = newAccessToken;
            data.accounts[accountIndex].expiresIn = newExpiresIn;
            data.accounts[accountIndex].expiresAt = newExpiresAt;
            writeData(data);
        }
        logApiCall('/refreshAccessToken', 'POST', { message: 'Access token refreshed successfully', accountId: account.id });
        return newAccessToken;
    } catch (error) {
        console.error('Error refreshing access token:', error.response ? error.response.data : error.message);
        logApiCall('/refreshAccessToken', 'POST', { message: 'Access token refresh failed', accountId: account.id, error: error.message });
        throw new Error('Failed to refresh access token');
    }
}

// OAuth 2.0 Authorization Code Flow
app.get('/oauth/authorize', (req, res) => {
    const clientId = process.env.GOTO_CLIENT_ID;
    const redirectUri = process.env.GOTO_REDIRECT_URI;
    const scope = 'identity: call-history.v1.notifications.manage voice-admin.v1.read fax.v1.notifications.manage call-events.v1.events.read messaging.v1.read queue-caller.v1.read voicemail.v1.voicemails.read presence.v1.notifications.manage recording.v1.notifications.manage voicemail.v1.notifications.manage fax.v1.read webrtc.v1.read contacts.v1.read recording.v1.read call-events.v1.notifications.manage presence.v1.read cr.v1.read users.v1.lines.read users.v1.read';
    const authorizationUrl = `https://authentication.logmeininc.com/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;
    res.redirect(authorizationUrl);
});

app.get('/oauth/callback', async (req, res) => {
    const code = req.query.code;
    const clientId = process.env.GOTO_CLIENT_ID;
    const clientSecret = process.env.GOTO_CLIENT_SECRET;
    const redirectUri = process.env.GOTO_REDIRECT_URI;

    try {
        const tokenResponse = await axios.post('https://authentication.logmeininc.com/oauth/token', 
            `grant_type=authorization_code&code=${code}&redirect_uri=${redirectUri}`, 
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
                }
            }
        );

        const accessToken = tokenResponse.data.access_token;
        const refreshToken = tokenResponse.data.refresh_token;
        const expiresIn = tokenResponse.data.expires_in;
        const expiresAt = Date.now() / 1000 + expiresIn; // Calculate expiration timestamp
        const userEmail = tokenResponse.data.principal;

        // Fetch accountKey using the access token
        const accountInfoResponse = await axios.get('https://api.goto.com/users/v1/me', {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        const accountKey = accountInfoResponse.data.items[0].accountKey;

        const data = readData();
        const newAccount = {
            id: accountKey, // Use accountKey as the unique ID
            name: 'GoTo Account ' + (data.accounts.length + 1) + ' - ' + userEmail, // You might want to fetch a more descriptive name
            accessToken: accessToken,
            refreshToken: refreshToken,
            expiresIn: expiresIn,
            expiresAt: expiresAt,
            userEmail: userEmail
        };

        // Check if account already exists to prevent duplicates
        const existingAccount = data.accounts.find(acc => acc.id === accountKey);
        if (!existingAccount) {
            data.accounts.push(newAccount);
            writeData(data);
        } else {
            console.log(`Account with ID ${accountKey} already exists. Updating tokens.`);
            existingAccount.accessToken = accessToken;
            existingAccount.refreshToken = refreshToken;
            existingAccount.expiresIn = expiresIn;
            existingAccount.expiresAt = expiresAt;
            writeData(data);
        }

        logApiCall('/oauth/callback', 'GET', { message: 'Authentication successful', accountKey: accountKey, userEmail: userEmail });
        res.redirect('/dashboard');

    } catch (error) {
        console.error('Error during OAuth callback:', error.response ? error.response.data : error.message);
        res.status(500).send('Authentication failed');
    }
});

// Route to fetch call events
app.get('/call-events/:accountId', async (req, res) => {
    const accountId = req.params.accountId;
    const data = readData();
    const account = data.accounts.find(acc => acc.id === accountId);

    let accessToken = account.accessToken;
    const expiresAt = account.expiresAt;

    // Check if token is expired (e.g., within 5 minutes of expiration)
    if (expiresAt && (Date.now() / 1000) > (expiresAt - 300)) { // 300 seconds = 5 minutes
        try {
            accessToken = await refreshAccessToken(account);
        } catch (refreshError) {
            return res.status(401).send('Failed to refresh access token: ' + refreshError.message);
        }
    }

    if (!accessToken) {
        return res.status(401).send('Access token is missing or could not be refreshed.');
    }

    try {
        let apiUrl = `https://api.goto.com/call-events-report/v1/report-summaries?accountKey=${accountId}`;

        if (req.query.userKey) apiUrl += `&userKey=${req.query.userKey}`;
        if (req.query.phoneNumberId) apiUrl += `&phoneNumberId=${req.query.phoneNumberId}`;
        if (req.query.lineId) apiUrl += `&lineId=${req.query.lineId}`;
        if (req.query.virtualParticipantId) apiUrl += `&virtualParticipantId=${req.query.virtualParticipantId}`;
        if (req.query.startTime) apiUrl += `&startTime=${req.query.startTime}`;
        if (req.query.endTime) apiUrl += `&endTime=${req.query.endTime}`;
        if (req.query.conversationScope) apiUrl += `&conversationScope=${req.query.conversationScope}`;
        if (req.query.conversationCallerOutcome) apiUrl += `&conversationCallerOutcome=${req.query.conversationCallerOutcome}`;
        if (req.query.pageSize) apiUrl += `&pageSize=${req.query.pageSize}`;
        if (req.query.pageMarker) apiUrl += `&pageMarker=${req.query.pageMarker}`;

        const callEventsResponse = await axios.get(apiUrl, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        const callEvents = callEventsResponse.data.items;
        
        const recordingIds = [];
        const transcriptIds = [];

        callEvents.forEach(event => {
            // Extract recordings from caller
            if (event.caller?.recordingId) {
                recordingIds.push(event.caller.recordingId);
            }
            
            // Extract recordings from participants
            if (event.participants) {
                event.participants.forEach(participant => {
                    if (participant.recordingId) {
                        recordingIds.push(participant.recordingId);
                    }
                });
            }
        });

        logApiCall(`/call-events/${accountId}`, 'GET', { message: 'Call events fetched successfully', count: callEvents.length });
        res.json({ callEvents, recordingIds, transcriptIds });
    } catch (error) {
        console.error('Error fetching call events:', error.response ? error.response.data : error.message);
        res.status(500).send('Failed to fetch call events.');
    }
});

// Route to fetch all recordings for a specific account
app.get('/fetch-recordings/:accountId', async (req, res) => {
    const accountId = req.params.accountId;
    const data = readData();
    const account = data.accounts.find(acc => acc.id === accountId);

    if (!account) {
        return res.status(404).json({ message: 'Account not found.' });
    }

    let accessToken = account.accessToken;
    const expiresAt = account.expiresAt;

    // Check if token is expired (e.g., within 5 minutes of expiration)
    if (expiresAt && (Date.now() / 1000) > (expiresAt - 300)) { // 300 seconds = 5 minutes
        try {
            accessToken = await refreshAccessToken(account);
        } catch (refreshError) {
            return res.status(401).json({ message: 'Failed to refresh access token: ' + refreshError.message });
        }
    }
    if (!accessToken) {
        return res.status(401).json({ message: 'Access token is missing.' });
    }

    try {
        let allCallEvents = [];
        let pageMarker = req.query.pageMarker || null;
        
        // Calculate default startTime (30 days ago) and endTime (current time)
        const now = new Date();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(now.getDate() - 30);

        const defaultStartTime = thirtyDaysAgo.toISOString().slice(0, -5) + 'Z';
        const defaultEndTime = now.toISOString().slice(0, -5) + 'Z';

        let startTime = req.query.startTime || account.latest_callCreated_timestamp || defaultStartTime;
        let endTime = req.query.endTime || defaultEndTime;

        do {
            let apiUrl = `https://api.goto.com/call-events-report/v1/report-summaries?accountKey=${accountId}`;

            if (req.query.userKey) apiUrl += `&userKey=${req.query.userKey}`;
            if (req.query.phoneNumberId) apiUrl += `&phoneNumberId=${req.query.phoneNumberId}`;
            if (req.query.lineId) apiUrl += `&lineId=${req.query.lineId}`;
            if (req.query.virtualParticipantId) apiUrl += `&virtualParticipantId=${req.query.virtualParticipantId}`;
            apiUrl += `&startTime=${startTime}`;
            apiUrl += `&endTime=${endTime}`;
            if (req.query.conversationScope) apiUrl += `&conversationScope=${req.query.conversationScope}`;
            if (req.query.conversationCallerOutcome) apiUrl += `&conversationCallerOutcome=${req.query.conversationCallerOutcome}`;
            apiUrl += `&pageSize=${req.query.pageSize || 100}`;
            if (pageMarker) apiUrl += `&pageMarker=${pageMarker}`;

            const callEventsResponse = await axios.get(apiUrl, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });
            const callEvents = callEventsResponse.data.items;
            allCallEvents = allCallEvents.concat(callEvents);
            pageMarker = callEventsResponse.data.nextPageMarker || null;

        } while (pageMarker);

        const finalCallEvents = allCallEvents;

        // Update latest_callCreated_timestamp for the account
        if (finalCallEvents.length > 0) {
            const mostRecentCallCreated = finalCallEvents.reduce((maxDate, event) => {
                return (new Date(event.callCreated) > new Date(maxDate)) ? event.callCreated : maxDate;
            }, account.latest_callCreated_timestamp || "1970-01-01T00:00:00Z"); // Default to epoch if no previous timestamp
            account.latest_callCreated_timestamp = mostRecentCallCreated;
            writeData(data); // Persist the updated account data
        }

        // Initialize recordings object if it doesn't exist
        if (!data.recordings) {
            data.recordings = {};
        }
        // Initialize recordings array for the account if it doesn't exist
        if (!data.recordings[accountId]) {
            data.recordings[accountId] = [];
        }

        finalCallEvents.forEach(event => {
            // Extract recordings from caller
            if (event.caller?.recordingId) {
                const recordingId = event.caller.recordingId;
                const existingRecording = data.recordings[accountId].find(r => r.recording_id === recordingId);
                if (!existingRecording) {
                    data.recordings[accountId].push({
                        recording_id: recordingId,
                        start_timestamp: new Date(event.callCreated).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\//g, '-'),
                        recording_downloaded: false // Initialize as not downloaded
                    });
                }
            }
            
            // Extract recordings from participants
            if (event.participants) {
                event.participants.forEach(participant => {
                    if (participant.recordingId) {
                        const recordingId = participant.recordingId;
                        const existingRecording = data.recordings[accountId].find(r => r.recording_id === recordingId);
                        if (!existingRecording) {
                            data.recordings[accountId].push({
                                recording_id: recordingId,
                                start_timestamp: new Date(event.callCreated).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\//g, '-'),
                                recording_downloaded: false // Initialize as not downloaded
                            });
                        }
                    }
                });
            }
        });
        writeData(data);

        // After fetching all recording IDs, initiate downloads for new recordings
        if (accessToken) {
            const newRecordingsToDownload = data.recordings[accountId].filter(rec => !rec.recording_downloaded);
            for (const recording of newRecordingsToDownload) {
                downloadRecordingContent(accountId, recording.recording_id, accessToken);
            }
        }

        logApiCall(`/fetch-recordings/${accountId}`, 'GET', { message: 'Recordings fetched and stored successfully.', count: finalCallEvents.length });
        res.status(200).json({ message: 'Recordings fetched and stored successfully.' });

    } catch (error) {
        console.error(`Error fetching all recordings for account ${accountId}:`, error.response ? error.response.data : error.message);
        res.status(500).json({ message: `Failed to fetch recordings for account ${accountId}.` });
    }
});

// Route to display recordings for a specific account
app.get('/recordings/:accountId', (req, res) => {
    const accountId = req.params.accountId;
    const data = readData();
    const accountRecordings = data.recordings?.[accountId] || [];
    res.render('recordings', { accountId: accountId, recordings: accountRecordings });
});


// Route to fetch a single recording's content and save it locally
app.get('/recording/:accountId/:recordingId', async (req, res) => {
    const { accountId, recordingId } = req.params;
    const data = readData();
    const account = data.accounts.find(acc => acc.id === accountId);

    if (!account) {
        return res.status(404).json({ message: 'Account not found.' });
    }

    try {
        // Step 1: Get the access token
        const accessToken = await refreshAccessToken(account);
        if (!accessToken) {
            return res.status(401).json({ message: 'Failed to refresh access token.' });
        }

        // Step 2: Get the recording content token
        const tokenResponse = await axios.get(`https://api.goto.com/recording/v1/recordings/${recordingId}/content`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        const token = tokenResponse.data.token;

        // Step 3: Fetch the recording content using the token
        const recordingContentResponse = await axios.get(`https://api.goto.com/recording/v1/recordings/${recordingId}/content/${token}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            },
            responseType: 'arraybuffer' // Important for binary data
        });

        const recordingFilePath = `/recordings/${recordingId}.mp3`; // Store relative path
        fs.writeFileSync(`public${recordingFilePath}`, recordingContentResponse.data);

        // Update data.json with the local file path and downloaded flag
        const allData = readData();
        if (allData.recordings[accountId] && allData.recordings[accountId][recordingId]) {
            allData.recordings[accountId][recordingId].content_url = recordingFilePath; // Store local file path
            allData.recordings[accountId][recordingId].recording_downloaded = true; // Add flag
            writeData(allData);
        }

        logApiCall(`/recording/${accountId}/${recordingId}`, 'GET', { message: 'Recording content fetched and saved successfully', recordingId: recordingId });
        res.status(200).json({ message: 'Recording content fetched and saved successfully.' });

    } catch (error) {
        console.error(`Error fetching recording content for ${recordingId}:`, error.response ? error.response.data : error.message);
        res.status(500).json({ message: `Failed to fetch recording content for ${recordingId}.` });
    }
});

// New function to download recording content
async function downloadRecordingContent(accountId, recordingId, accessToken) {
    try {
        // Step 1: Get the recording content token
        const tokenResponse = await axios.get(`https://api.goto.com/recording/v1/recordings/${recordingId}/content`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        const token = tokenResponse.data.token;

        // Step 2: Fetch the recording content using the token
        const recordingContentResponse = await axios.get(`https://api.goto.com/recording/v1/recordings/${recordingId}/content/${token}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            },
            responseType: 'arraybuffer' // Important for binary data
        });

        const recordingFilePath = `/recordings/${recordingId}.mp3`; // Store relative path
        fs.writeFileSync(`public${recordingFilePath}`, recordingContentResponse.data);

        // Update data.json with the local file path and downloaded flag
        const allData = readData();
        if (allData.recordings[accountId]) {
            const recordingIndex = allData.recordings[accountId].findIndex(r => r.recording_id === recordingId);
            if (recordingIndex !== -1) {
                allData.recordings[accountId][recordingIndex].content_url = recordingFilePath; // Store local file path
                allData.recordings[accountId][recordingIndex].recording_downloaded = true; // Add flag
                writeData(allData);
            }
        }
        console.log(`Recording ${recordingId} downloaded and saved.`);
    } catch (error) {
        console.error(`Error downloading recording content for ${recordingId}:`, error.response ? error.response.data : error.message);
    }
}

// Route to fetch a specific transcript content
app.get('/transcript/:accountId/:id', async (req, res) => {
    const accountId = req.params.accountId;
    const recordingId = req.params.id;
    const data = readData();
    const account = data.accounts.find(acc => acc.id === accountId);

    if (!account) {
        return res.status(404).json({ message: 'Account not found.' });
    }

    const accessToken = account.accessToken;
    if (!accessToken) {
        return res.status(401).json({ message: 'Access token is missing.' });
    }

    try {
        const transcriptContentResponse = await axios.get(`https://api.goto.com/recording/v1/transcripts/${recordingId}/content`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        logApiCall(`/transcript/${accountId}/${recordingId}`, 'GET', { message: 'Transcription content fetched successfully', recordingId: recordingId });
        res.setHeader('Content-Type', 'text/plain'); // Transcripts are usually plain text
        res.send(transcriptContentResponse.data);

    } catch (error) {
        console.error(`Error fetching transcript content for ${recordingId}:`, error.response ? error.response.data : error.message);
        res.status(500).json({ message: `Failed to fetch transcript content for ${recordingId}.` });
    }
});


// Login route
app.post('/login', (req, res) => {
    const { email, password } = req.body;
    const user = findUser(email, password);

    if (user) {
        req.session.isUser = true;
        req.session.userId = user.id; // Store user ID in session
        res.json({ success: true, redirect: '/dashboard' });
    } else {
        res.json({ success: false, message: 'Invalid credentials' });
    }
});



app.post('/disconnect-account', (req, res) => {
    const { accountId } = req.body;
    if (accountId) {
        deleteAccount(accountId);
        res.json({ success: true, message: 'Account disconnected successfully.' });
    } else {
        res.status(400).json({ success: false, message: 'Account ID is required.' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

app.get('/dashboard', isAuthenticatedUser, async (req, res) => {
    const data = readData();
    res.render('dashboard', { accounts: data.accounts });
});

app.get('/', (req, res) => {
    res.render('login'); // Render the login page
});

// Admin Login Route
app.get('/admin/login', (req, res) => {
    res.render('adminLogin', { message: null });
});

// Admin Login POST Route
app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'Admin' && password === 'E3GoToAdmin') {
        req.session.isAdmin = true;
        res.redirect('/admin/dashboard');
    } else {
        res.render('adminLogin', { message: 'Invalid username or password' });
    }
});

// Middleware to check if user is authenticated
function isAuthenticatedUser(req, res, next) {
    if (req.session.isUser) {
        next();
    } else {
        res.redirect('/');
    }
}

// Middleware to check if admin is authenticated
function isAuthenticatedAdmin(req, res, next) {
    if (req.session.isAdmin) {
        next();
    } else {
        res.redirect('/admin/login');
    }
}

// Admin Routes
app.post('/admin/clear-logs', (req, res) => {
    clearLogs();
    res.redirect('/admin/dashboard');
});

// Admin User Management Routes
app.get('/admin/users', isAuthenticatedAdmin, (req, res) => {
    const users = readUsers();
    res.render('adminDashboard', { dataContent: readData(), logsContent: readLogs(), users: users, activeTab: 'users' });
});

app.post('/admin/users/add', isAuthenticatedAdmin, (req, res) => {
    const { email, password } = req.body;
    addUser(email, password);
    res.redirect('/admin/users');
});

app.post('/admin/users/update', isAuthenticatedAdmin, (req, res) => {
    const { id, email, password } = req.body;
    updateUser(id, email, password);
    res.json({ success: true, message: 'User updated successfully!' });
});

app.post('/admin/users/delete', isAuthenticatedAdmin, (req, res) => {
    const { id } = req.body;
    deleteUser(id);
    res.redirect('/admin/users');
});

// Admin Dashboard Route
app.get('/admin/dashboard', isAuthenticatedAdmin, (req, res) => {
    const dataContent = readData();
    const logsContent = readLogs();
    const users = readUsers(); // Fetch users for the dashboard
    res.render('adminDashboard', { dataContent, logsContent, users, activeTab: 'dashboard' });
});

// Admin Logout Route
app.get('/admin/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/admin/login');
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});