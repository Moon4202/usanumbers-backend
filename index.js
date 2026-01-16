const express = require('express');
const cors = require('cors');
const { Firestore } = require('@google-cloud/firestore');

const app = express();
app.use(cors());
app.use(express.json());

// Simple Firestore connection - NO Firebase Admin
let db = null;
try {
  console.log("Initializing Firestore directly...");
  
  // Direct Firestore initialization
  db = new Firestore({
    projectId: process.env.FIREBASE_PROJECT_ID,
    credentials: {
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    }
  });
  
  console.log("✅ Firestore connected directly");
} catch (error) {
  console.error("❌ Firestore error:", error.message);
  db = null;
}

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'USANumbers Backend API',
    status: 'Active',
    firestore: db ? 'Connected' : 'Not Connected',
    mode: 'Direct Firestore Connection',
    time: new Date().toISOString()
  });
});

// TEST ROUTE - Simple query
app.get('/api/test', async (req, res) => {
  try {
    if (!db) {
      return res.json({ 
        success: false, 
        message: 'Firestore not connected',
        suggestion: 'Check service account permissions in Google Cloud Console'
      });
    }
    
    // Try a simple query
    const querySnapshot = await db.collection('users').limit(1).get();
    
    res.json({ 
      success: true, 
      message: 'Firestore connected successfully!',
      test: {
        collectionsTested: 'users',
        documentsFound: querySnapshot.size
      }
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      code: error.code,
      suggestion: 'Enable Firestore API in Google Cloud Console'
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
});
