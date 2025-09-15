const cron = require('node-cron');
const axios = require('axios');
const { readData, writeData } = require('./utils/dataHandler');
const { logApiCall } = require('./utils/logHandler');

let isProcessing = false; // Flag to track if a scheduler run is in progress

async function runSchedulerLogic() {
    if (isProcessing) {
        console.log('Skipping scheduler run: Previous run is still in progress.');
        return;
    }

    try {
        isProcessing = true;
        console.log('Running scheduled recording download check...');
        const data = readData();
        
        for (const account of data.accounts) {
            try {
                let accessToken = account.accessToken;
                // Check if the current token is expired or about to expire (e.g., within 5 minutes)
                if (!account.expiresAt || (account.expiresAt - Date.now() / 1000 < 300)) { // 300 seconds = 5 minutes
                    accessToken = await refreshAccessToken(account);
                    if (!accessToken) {
                        console.error(`Failed to refresh token for account ${account.id}`);
                        continue;
                    }
                }
                
                const accountRecordings = data.recordings[account.id] || [];
                const pendingRecordings = accountRecordings.filter(rec => !rec.recording_downloaded);

                if (pendingRecordings.length === 0) {
                    console.log(`No pending recordings for account ${account.id}`);
                    continue;
                }

                console.log(`Found ${pendingRecordings.length} pending recordings for account ${account.id}`);
                
                // Download recordings in batches of 5 to manage memory
                const batchSize = 5;
                for (let i = 0; i < pendingRecordings.length; i += batchSize) {
                    const batch = pendingRecordings.slice(i, i + batchSize);
                    await Promise.all(batch.map(recording => 
                        downloadRecordingContent(account.id, recording.recording_id, accessToken)
                    ));
                    console.log(`Completed batch ${i / batchSize + 1} of ${Math.ceil(pendingRecordings.length / batchSize)}`);
                }
            } catch (error) {
                console.error(`Error processing account ${account.id}:`, error);
            }
        }
    } finally {
        isProcessing = false;
    }
}

// Function to refresh access token (copied from index.js)
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

// Function to download recording content (copied from index.js)
async function downloadRecordingContent(accountId, recordingId, accessToken) {
    try {
        // Step 1: Get the recording content token
        const tokenResponse = await axios.get(`https://api.goto.com/recording/v1/recordings/${recordingId}/content`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        const token = tokenResponse.data.token.token;
        console.log(`Recording content token for ${recordingId}:`, token);

        // Step 2: Fetch the recording content using the token
        const recordingContentResponse = await axios.get(`https://api.goto.com/recording/v1/recordings/${recordingId}/content/${token}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            },
            responseType: 'arraybuffer' // Important for binary data
        });

        const recordingFilePath = `/storage/recordings/${recordingId}.mp3`; // Store relative path
        require('fs').writeFileSync(`public${recordingFilePath}`, recordingContentResponse.data);

        // Update data.json with the local file path and downloaded flag
        const allData = readData();
        if (allData.recordings[accountId]) {
            const recordingIndex = allData.recordings[accountId].findIndex(r => r.recording_id === recordingId);
            if (recordingIndex !== -1) {
                allData.recordings[accountId][recordingIndex].content_url = recordingFilePath;
                allData.recordings[accountId][recordingIndex].recording_downloaded = true;
                writeData(allData);
            }
        }
        console.log(`Recording ${recordingId} downloaded and saved.`);
    } catch (error) {
        console.error(`Error downloading recording content for ${recordingId}:`, error.response ? error.response.data : error.message);
    }
}

// Main scheduler function
exports.startRecordingScheduler = function() {
    // Schedule to run every hour
    cron.schedule('0 * * * *', runSchedulerLogic);
    console.log('Recording download scheduler started. Will run hourly.');
};

exports.triggerSchedulerRun = function() {
    runSchedulerLogic();
};