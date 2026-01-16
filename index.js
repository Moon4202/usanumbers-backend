const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

// Firebase Admin initialize
try {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY || '';
  console.log("Firebase Initializing...");
  
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey.replace(/\\n/g, '\n')
    })
  });
  console.log("✅ Firebase Admin initialized");
} catch (error) {
  console.error("❌ Firebase Admin error:", error.message);
}

const db = admin.firestore();

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'USANumbers Backend API',
    status: 'Active',
    time: new Date().toISOString(),
    firebase: db ? 'Connected' : 'Not Connected'
  });
});

// TEST ROUTE - Firebase connection check
app.get('/api/test', async (req, res) => {
  try {
    if (!db) {
      return res.json({ 
        success: false, 
        message: 'Firestore not connected',
        envCheck: {
          hasProjectId: !!process.env.FIREBASE_PROJECT_ID,
          hasClientEmail: !!process.env.FIREBASE_CLIENT_EMAIL,
          hasPrivateKey: !!process.env.FIREBASE_PRIVATE_KEY ? 'Yes' : 'No'
        }
      });
    }
    
    // Try to get numbers count
    const numbersSnapshot = await db.collection('numbers')
      .where('status', '==', 'available')
      .limit(1)
      .get();
    
    res.json({ 
      success: true, 
      message: 'Firebase connection successful!',
      firestore: 'Connected',
      availableNumbers: numbersSnapshot.size,
      test: 'Backend API is working'
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      code: error.code
    });
  }
});

// Main API: Get available numbers
app.get('/api/numbers', async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: 'Database not connected' });
    }
    
    const snapshot = await db.collection('numbers')
      .where('status', '==', 'available')
      .limit(20)
      .get();
    
    const numbers = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      // Hide sensitive data
      numbers.push({
        id: doc.id,
        phoneNumber: maskNumber(data.phoneNumber),
        price: data.price || 0.30,
        type: data.type || 'SMS & Call',
        status: data.status
      });
    });
    
    res.json({ 
      success: true, 
      numbers, 
      count: numbers.length 
    });
  } catch (error) {
    console.error("API Error:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Helper function
function maskNumber(phoneNumber) {
  const digits = phoneNumber.toString().replace(/\D/g, '');
  if (digits.length >= 3) {
    return `+1 (${digits.substring(0,3)}) XXX-XXXX`;
  }
  return phoneNumber;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
});
