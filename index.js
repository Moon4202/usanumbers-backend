const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// Firebase REST API configuration
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY; // You need to add this to Versel env vars

// Helper function to get Firebase access token
async function getFirebaseAccessToken() {
  try {
    // This uses the service account to get an access token
    const { GoogleAuth } = require('google-auth-library');
    const auth = new GoogleAuth({
      credentials: {
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        project_id: process.env.FIREBASE_PROJECT_ID
      },
      scopes: ['https://www.googleapis.com/auth/datastore']
    });
    
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    return token.token;
  } catch (error) {
    console.error('Failed to get access token:', error.message);
    return null;
  }
}

// Health check (simplified)
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Backend is running',
    mode: 'REST API Mode',
    firebaseProject: FIREBASE_PROJECT_ID || 'Not set',
    timestamp: new Date().toISOString()
  });
});

// Get numbers via REST API
app.get('/api/numbers', async (req, res) => {
  try {
    // For now, return mock data while we fix Firebase
    const mockNumbers = [
      {
        id: 'temp-1',
        displayNumber: '+1 (618) XXX-XXXX',
        fullNumber: '+16189401793',
        price: 0.30,
        type: 'SMS & Call',
        status: 'available'
      },
      {
        id: 'temp-2',
        displayNumber: '+1 (325) XXX-XXXX',
        fullNumber: '+13252387176',
        price: 0.30,
        type: 'SMS & Call',
        status: 'available'
      }
    ];
    
    res.json({
      success: true,
      data: mockNumbers,
      count: mockNumbers.length,
      note: 'Using temporary data. Firebase integration in progress.',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Purchase endpoint (temporary)
app.post('/api/purchase', async (req, res) => {
  const { userId, numberId } = req.body;
  
  res.json({
    success: true,
    message: 'Purchase simulation successful',
    data: {
      number: '+1 (XXX) XXX-XXXX',
      apiUrl: 'https://sms.usa.com/api/number?token=purchase_simulated',
      price: 0.30,
      purchaseId: 'temp-' + Date.now()
    },
    note: 'This is a simulation. Real Firebase integration coming soon.',
    userId,
    numberId
  });
});

// Test Firebase REST connection
app.get('/api/firebase-test', async (req, res) => {
  try {
    const accessToken = await getFirebaseAccessToken();
    
    if (!accessToken) {
      return res.json({
        success: false,
        message: 'Could not get Firebase access token',
        suggestion: 'Check service account permissions in Google Cloud Console'
      });
    }
    
    res.json({
      success: true,
      message: 'Firebase access token obtained',
      tokenAvailable: true,
      projectId: FIREBASE_PROJECT_ID
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      details: 'Service account permissions issue. Please enable Firestore API.'
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ USANumbers Backend running on port ${PORT}`);
  console.log('Mode: Temporary mock data');
  console.log('Firebase Project:', FIREBASE_PROJECT_ID || 'Not configured');
  console.log('');
  console.log('⚠️ IMPORTANT: Firebase permissions need to be fixed in Google Cloud Console');
  console.log('1. Enable Firestore API');
  console.log('2. Grant "Cloud Datastore User" role to service account');
  console.log('3. Check project billing is enabled');
});
