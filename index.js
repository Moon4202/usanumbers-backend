const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

// Firebase Admin initialize - FIXED VERSION
let db = null;
try {
  console.log("Initializing Firebase...");
  
  // Check if environment variables exist
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  
  if (!privateKey || !clientEmail || !projectId) {
    console.error("Missing Firebase environment variables");
    console.log("Project ID:", projectId ? "Set" : "Missing");
    console.log("Client Email:", clientEmail ? "Set" : "Missing");
    console.log("Private Key:", privateKey ? "Set" : "Missing");
  } else {
    console.log("All Firebase variables found, initializing...");
    
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: projectId,
        clientEmail: clientEmail,
        privateKey: privateKey.replace(/\\n/g, '\n')
      })
    });
    
    db = admin.firestore();
    console.log("✅ Firebase Admin initialized successfully");
  }
} catch (error) {
  console.error("❌ Firebase initialization error:", error.message);
  console.error("Error details:", error);
}

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'USANumbers Backend API',
    status: 'Active',
    firebase: db ? 'Connected' : 'Not Connected',
    time: new Date().toISOString()
  });
});

// TEST ROUTE - Check Firebase connection
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
    
    // Test query
    const numbersCount = await db.collection('numbers')
      .where('status', '==', 'available')
      .limit(1)
      .get()
      .then(snap => snap.size);
    
    const usersCount = await db.collection('users')
      .limit(1)
      .get()
      .then(snap => snap.size);
    
    res.json({ 
      success: true, 
      message: 'Firebase connection successful!',
      firestore: 'Connected',
      testQuery: {
        availableNumbers: numbersCount,
        totalUsers: usersCount
      },
      backend: 'Ready for production'
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      code: error.code,
      note: 'Check Firebase service account permissions'
    });
  }
});

// MAIN API: Get available numbers (REAL DATA)
app.get('/api/numbers', async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ 
        success: false, 
        error: 'Database not connected' 
      });
    }
    
    const snapshot = await db.collection('numbers')
      .where('status', '==', 'available')
      .limit(20)
      .get();
    
    const numbers = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      numbers.push({
        id: doc.id,
        phoneNumber: maskNumber(data.phoneNumber),
        fullNumber: data.phoneNumber, // For purchase reference
        price: data.price || 0.30,
        type: data.type || 'SMS & Call',
        status: data.status,
        apiUrl: data.apiUrl ? 'Hidden in backend' : null
      });
    });
    
    res.json({ 
      success: true, 
      numbers, 
      count: numbers.length,
      note: 'API links hidden for security'
    });
  } catch (error) {
    console.error("API Error:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Purchase API (REAL)
app.post('/api/purchase', async (req, res) => {
  try {
    const { userId, numberId } = req.body;
    
    if (!db) {
      return res.status(500).json({ 
        success: false, 
        error: 'Database not connected' 
      });
    }
    
    // Add real purchase logic here
    // 1. Check user credits
    // 2. Mark number as sold
    // 3. Deduct credits
    // 4. Return API link
    
    res.json({ 
      success: true, 
      message: 'Purchase endpoint ready',
      note: 'Real purchase logic pending',
      userId,
      numberId
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Helper function
function maskNumber(phoneNumber) {
  if (!phoneNumber) return 'N/A';
  const digits = phoneNumber.toString().replace(/\D/g, '');
  if (digits.length >= 3) {
    return `+1 (${digits.substring(0,3)}) XXX-XXXX`;
  }
  return phoneNumber;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
  console.log('Firebase Status:', db ? 'Connected' : 'Not Connected');
});
