const express = require('express');
const fs = require('fs');
const { readData, writeData } = require('./utils/dataHandler');
const { clearLogs } = require('./utils/logHandler');
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
        const tokenResponse = await axios.post('https://api.goto.com/oauth/v2/token', 
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
        const callEventsResponse = await axios.get(`https://api.goto.com/call-events/v1/conversation-spaces?accountKey=${accountId}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        const callEvents = callEventsResponse.data.items;
        
        const recordingIds = [];
        const transcriptIds = [];

        callEvents.forEach(event => {
            // Extract recordings from both state and participant levels
            if (event.state?.recordings) {
                event.state.recordings.forEach(recording => {
                    recordingIds.push(recording.id);
                    if (recording.transcriptEnabled) {
                        transcriptIds.push(recording.id);
                    }
                });
            }
            
            // if (event.state?.participants) {
            //     event.state.participants.forEach(participant => {
            //         if (participant.recordings) {
            //             participant.recordings.forEach(recording => {
            //                 recordingIds.push(recording.id);
            //                 if (recording.transcriptEnabled) {
            //                     transcriptIds.push(recording.id);
            //                 }
            //             });
            //         }
            //     });
            // }
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
        const callEventsResponse = await axios.get(`https://api.goto.com/call-events/v1/conversation-spaces?accountKey=${accountId}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        const callEvents = callEventsResponse.data.items;

        // Initialize recordings object if it doesn't exist
        if (!data.recordings) {
            data.recordings = {};
        }
        // Initialize recordings array for the account if it doesn't exist
        if (!data.recordings[accountId]) {
            data.recordings[accountId] = [];
        }

        callEvents.forEach(event => {
            // Extract recordings from both state and participant levels
            if (event.state?.recordings) {
                event.state.recordings.forEach(recording => {
                    const existingRecording = data.recordings[accountId].find(r => r.recording_id === recording.id);
                    if (!existingRecording) {
                        data.recordings[accountId].push({
                            recording_id: recording.id,
                            transcription_enabled: recording.transcriptEnabled || false,
                            start_timestamp: new Date(event.startTime).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\//g, '-')
                        });
                    }
                });
            }
            
            // if (event.state?.participants) {
            //     event.state.participants.forEach(participant => {
            //         if (participant.recordings) {
            //             participant.recordings.forEach(recording => {
            //                 const existingRecording = data.recordings[accountId].find(r => r.recording_id === recording.id);
            //                 if (!existingRecording) {
            //                     data.recordings[accountId].push({
            //                         recording_id: recording.id,
            //                         transcription_enabled: recording.transcriptEnabled || false,
            //                         start_timestamp: new Date(event.startTime).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\//g, '-')
            //                     });
            //                 }
            //             });
            //         }
            //     });
            // }
        });
        writeData(data);

        logApiCall(`/fetch-recordings/${accountId}`, 'GET', { message: 'Recordings fetched and stored successfully.', count: callEvents.length });
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


// Route to fetch a specific recording content
app.get('/recording/:accountId/:id', async (req, res) => {
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
        // Step 1: Get the token for the recording content
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
            responseType: 'arraybuffer' // Important for binary data like audio/video
        });

        // Store the recording URL in data.json
        const recordings = readData();
        if (recordings[accountId] && recordings[accountId][recordingId]) {
            recordings[accountId][recordingId].content_url = `https://api.goto.com/recording/v1/recordings/${recordingId}/content/${token}`;
            writeData(recordings);
        }

        // Set appropriate headers for the content type
        logApiCall(`/recording/${accountId}/${recordingId}`, 'GET', { message: 'Recording content fetched successfully', recordingId: recordingId });
        res.setHeader('Content-Type', recordingContentResponse.headers['content-type']);
        res.send(recordingContentResponse.data);

    } catch (error) {
        console.error(`Error fetching recording content for ${recordingId}:`, error.response ? error.response.data : error.message);
        res.status(500).json({ message: `Failed to fetch recording content for ${recordingId}.` });
    }
});

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

    // Simple hardcoded authentication for demonstration
    if (email === 'admin@excellenc3.com' && password === 'e3admin2k25') {
        req.session.isUser = true;
        res.redirect('/dashboard'); // Redirect to dashboard on successful login
    } else {
        res.send('Invalid credentials'); // Show error for failed login
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

// Admin Dashboard Route
app.get('/admin/dashboard', isAuthenticatedAdmin, (req, res) => {
    const dataContent = readData();
    const logsContent = readLogs();
    res.render('adminDashboard', { dataContent, logsContent });
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