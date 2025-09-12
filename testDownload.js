const { readData, writeData } = require('./utils/dataHandler');
const axios = require('axios');
require('dotenv').config();

// Function to refresh access token (copied from index.js for self-containment)
async function refreshAccessToken(account) {
    const clientId = process.env.GOTO_CLIENT_ID;
    const clientSecret = process.env.GOTO_CLIENT_SECRET;
    const refreshToken = account.refreshToken;

    try {
        const response = await axios.post('https://api.goto.com/oauth/v2/token', new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken
        }), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        account.accessToken = response.data.access_token;
        account.refreshToken = response.data.refresh_token; // Refresh token might also be updated
        writeData(readData()); // Persist updated tokens
        return account.accessToken;
    } catch (error) {
        console.error('Error refreshing access token:', error.response ? error.response.data : error.message);
        return null;
    }
}

// Function to download recording content (copied from index.js for self-containment)
async function downloadRecordingContent(accountId, recordingId, accessToken) {
    const fs = require('fs'); // fs needs to be imported here for this standalone script
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
        if (allData.recordings[accountId] && allData.recordings[accountId][recordingId]) {
            allData.recordings[accountId][recordingId].content_url = recordingFilePath; // Store local file path
            allData.recordings[accountId][recordingId].local_file_path = recordingFilePath; // Add local file path
            allData.recordings[accountId][recordingId].recording_downloaded = true; // Add flag
            writeData(allData);
        }
        console.log(`Recording ${recordingId} downloaded and saved.`);
    } catch (error) {
        console.error(`Error downloading recording content for ${recordingId}:`, error.response ? error.response.data : error.message);
    }
}

async function fetchRecordingIds(accountId, accessToken) {
    try {
        const response = await axios.get(`https://api.goto.com/recording/v1/accounts/${accountId}/recordings`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        const allData = readData();
        if (!allData.recordings) {
            allData.recordings = {};
        }
        if (!allData.recordings[accountId]) {
            allData.recordings[accountId] = {};
        }

        response.data.forEach(recording => {
            if (!allData.recordings[accountId][recording.recordingId]) {
                allData.recordings[accountId][recording.recordingId] = {
                    recording_id: recording.recordingId,
                    content_url: null, // Initialize content_url
                    local_file_path: null, // Initialize local_file_path
                    recording_downloaded: false // Initialize as not downloaded
                };
            }
        });
        writeData(allData);
        console.log(`Fetched and updated recording IDs for account ${accountId}.`);
    } catch (error) {
        console.error(`Error fetching recording IDs for account ${accountId}:`, error.response ? error.response.data : error.message);
    }
}

async function testDownloadFirstFiveRecordings() {
    const data = readData();
    const accounts = data.accounts;

    if (!accounts || accounts.length === 0) {
        console.log('No accounts found in data.json.');
        return;
    }

    for (const account of accounts) {
        console.log(`Processing account: ${account.id}`);
        const accessToken = await refreshAccessToken(account);
        if (!accessToken) {
            console.error(`Failed to get access token for account ${account.id}. Skipping downloads for this account.`);
            continue;
        }

        let accountRecordings = data.recordings[account.id] || {};
        let recordingsToDownload = Object.values(accountRecordings).filter(rec => !rec.recording_downloaded).slice(0, 5);

        if (recordingsToDownload.length === 0) {
            console.log(`No new recordings found for account ${account.id}. Attempting to fetch new recording IDs.`);
            if (accessToken) { // Add this check
                await fetchRecordingIds(account.id, accessToken);
            } else {
                console.error(`Cannot fetch new recording IDs for account ${account.id} because access token is invalid.`);
                continue; // Skip to the next account if token is invalid
            }
            // Re-read data after fetching new IDs
            const updatedData = readData();
            accountRecordings = updatedData.recordings[account.id] || {};
            recordingsToDownload = Object.values(accountRecordings).filter(rec => !rec.recording_downloaded).slice(0, 5);

            if (recordingsToDownload.length === 0) {
                console.log(`Still no new recordings to download for account ${account.id} after fetching IDs.`);
                continue;
            }
        }

        console.log(`Attempting to download ${recordingsToDownload.length} new recordings for account ${account.id}...`);
        for (const recording of recordingsToDownload) {
            await downloadRecordingContent(account.id, recording.recording_id, accessToken);
        }
        console.log(`Finished attempting to download recordings for account ${account.id}.`);
    }
    console.log('Test download script finished.');
}

testDownloadFirstFiveRecordings();