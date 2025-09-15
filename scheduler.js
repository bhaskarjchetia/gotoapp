const cron = require('node-cron');
const axios = require('axios');
const { readData, writeData } = require('./utils/dataHandler');

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
                const accessToken = await refreshAccessToken(account);
                if (!accessToken) {
                    console.error(`Failed to refresh token for account ${account.id}`);
                    continue;
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
    try {
        const response = await axios.post('https://api.goto.com/oauth/v2/token', {
            grant_type: 'refresh_token',
            refresh_token: account.refreshToken,
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET
        });

        account.accessToken = response.data.access_token;
        account.expiresAt = Math.floor(Date.now() / 1000) + response.data.expires_in;
        writeData(readData()); // Persist the updated account data
        return account.accessToken;
    } catch (error) {
        console.error('Error refreshing access token:', error.response ? error.response.data : error.message);
        return null;
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