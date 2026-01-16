const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

// Firebase Admin initialize - yeh secure hai
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: process.env.FIREBASE_PROJECT_ID
});

const db = admin.firestore();

// API 1: Get available numbers
app.get('/api/numbers', async (req, res) => {
  try {
    const snapshot = await db.collection('numbers')
      .where('status', '==', 'available')
      .limit(20)
      .get();
    
    const numbers = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      // API link hide karo
      numbers.push({
        id: doc.id,
        phoneNumber: maskNumber(data.phoneNumber),
        price: data.price,
        type: data.type,
        status: data.status
      });
    });
    
    res.json({ success: true, numbers });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API 2: Purchase number
app.post('/api/purchase', async (req, res) => {
  try {
    const { userId, numberId } = req.body;
    
    // Validate user authentication
    // Add purchase logic
    // Deduct credits
    // Mark number as sold
    
    res.json({ success: true, message: 'Purchase successful' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper function
function maskNumber(phoneNumber) {
  const digits = phoneNumber.replace(/\D/g, '');
  if (digits.length >= 3) {
    return `+1 (${digits.substring(0,3)}) XXX-XXXX`;
  }
  return phoneNumber;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
