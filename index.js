const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Firebase Admin initialize (FIXED VERSION)
try {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    })
  });
  console.log("✅ Firebase Admin initialized successfully");
} catch (error) {
  console.error("❌ Firebase Admin error:", error);
}

const db = admin.firestore();

// ✅ Root route add karo
app.get('/', (req, res) => {
  res.json({ 
    message: 'USANumbers Backend API',
    status: 'running',
    endpoints: ['/api/numbers', '/api/purchase']
  });
});

// API 1: Get available numbers
app.get('/api/numbers', async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({ error: 'Database not initialized' });
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
        price: data.price,
        type: data.type,
        status: data.status
      });
    });
    
    res.json({ success: true, numbers, count: numbers.length });
  } catch (error) {
    console.error("API Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// API 2: Purchase number
app.post('/api/purchase', async (req, res) => {
  try {
    const { userId, numberId } = req.body;
    
    res.json({ 
      success: true, 
      message: 'Purchase endpoint ready',
      userId,
      numberId
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
