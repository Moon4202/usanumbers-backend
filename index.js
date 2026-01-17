const express = require('express');
const cors = require('cors');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Firebase
let db = null;
try {
  console.log('Initializing Firebase Admin...');
  
  const serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  };
  
  console.log('Service Account Details:');
  console.log('- Project ID:', serviceAccount.projectId);
  console.log('- Client Email:', serviceAccount.clientEmail);
  console.log('- Private Key Length:', serviceAccount.privateKey.length);
  
  // Initialize Firebase Admin
  initializeApp({
    credential: cert(serviceAccount)
  });
  
  // Get Firestore instance
  db = getFirestore();
  
  console.log('✅ Firebase Admin initialized successfully');
  console.log('✅ Firestore connected');
  
} catch (error) {
  console.error('❌ Firebase initialization error:', error.message);
  console.error('Error stack:', error.stack);
  db = null;
}

// Health check
app.get('/api/health', async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({
        success: false,
        message: 'Firestore not connected',
        error: 'Database initialization failed'
      });
    }
    
    // Test Firestore connection by getting a simple count
    const numbersSnapshot = await db.collection('numbers')
      .limit(1)
      .get();
    
    const usersSnapshot = await db.collection('users')
      .limit(1)
      .get();
    
    res.json({
      success: true,
      message: 'Backend is healthy',
      firestore: {
        connected: true,
        numbersCollection: numbersSnapshot.size >= 0,
        usersCollection: usersSnapshot.size >= 0
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Health check failed',
      error: error.message,
      code: error.code
    });
  }
});

// Get available numbers (REAL DATA)
app.get('/api/numbers', async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Database not connected. Please try again later.'
      });
    }
    
    const { limit = 20, page = 1 } = req.query;
    const pageSize = parseInt(limit);
    const pageNum = parseInt(page);
    
    // Get available numbers
    const numbersSnapshot = await db.collection('numbers')
      .where('status', '==', 'available')
      .limit(pageSize)
      .get();
    
    const numbers = [];
    numbersSnapshot.forEach(doc => {
      const data = doc.data();
      numbers.push({
        id: doc.id,
        displayNumber: maskPhoneNumber(data.phoneNumber),
        fullNumber: data.phoneNumber, // For backend reference only
        price: data.price || 0.30,
        type: data.type || 'SMS & Call',
        status: data.status || 'available',
        addedAt: data.addedAt || null
      });
    });
    
    // Get total count
    const totalSnapshot = await db.collection('numbers')
      .where('status', '==', 'available')
      .get();
    
    res.json({
      success: true,
      data: numbers,
      pagination: {
        page: pageNum,
        limit: pageSize,
        total: totalSnapshot.size,
        hasMore: totalSnapshot.size > (pageNum * pageSize)
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Get numbers error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code
    });
  }
});

// Purchase a number
app.post('/api/purchase', async (req, res) => {
  try {
    const { userId, numberId, userEmail } = req.body;
    
    if (!userId || !numberId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId and numberId'
      });
    }
    
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Database not connected'
      });
    }
    
    // Start a transaction
    const result = await db.runTransaction(async (transaction) => {
      // Get the number
      const numberRef = db.collection('numbers').doc(numberId);
      const numberDoc = await transaction.get(numberRef);
      
      if (!numberDoc.exists) {
        throw new Error('Number not found');
      }
      
      const numberData = numberDoc.data();
      
      if (numberData.status !== 'available') {
        throw new Error('Number is no longer available');
      }
      
      // Get user data
      const userRef = db.collection('users').doc(userId);
      const userDoc = await transaction.get(userRef);
      
      if (!userDoc.exists) {
        throw new Error('User not found');
      }
      
      const userData = userDoc.data();
      const numberPrice = numberData.price || 0.30;
      
      // Check user balance
      if (userData.credits < numberPrice) {
        throw new Error('Insufficient credits');
      }
      
      // Update number status
      transaction.update(numberRef, {
        status: 'sold',
        soldTo: userId,
        soldToEmail: userEmail || userData.email,
        soldAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      
      // Update user credits
      transaction.update(userRef, {
        credits: userData.credits - numberPrice,
        purchasedNumbers: [...(userData.purchasedNumbers || []), numberData.phoneNumber],
        updatedAt: new Date().toISOString()
      });
      
      // Create transaction record
      const transactionRef = db.collection('transactions').doc();
      transaction.set(transactionRef, {
        userId: userId,
        userEmail: userEmail || userData.email,
        type: 'purchase',
        amount: numberPrice,
        number: numberData.phoneNumber,
        apiUrl: numberData.apiUrl,
        timestamp: new Date().toISOString(),
        status: 'completed'
      });
      
      return {
        success: true,
        number: numberData.phoneNumber,
        apiUrl: numberData.apiUrl,
        price: numberPrice,
        remainingCredits: userData.credits - numberPrice
      };
    });
    
    res.json({
      success: true,
      message: 'Purchase successful!',
      data: result
    });
    
  } catch (error) {
    console.error('Purchase error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: 'PURCHASE_FAILED'
    });
  }
});

// Admin: Get all numbers
app.get('/api/admin/numbers', async (req, res) => {
  try {
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Database not connected'
      });
    }
    
    const { status, limit = 50 } = req.query;
    
    let query = db.collection('numbers');
    
    if (status && status !== 'all') {
      query = query.where('status', '==', status);
    }
    
    const snapshot = await query
      .orderBy('addedAt', 'desc')
      .limit(parseInt(limit))
      .get();
    
    const numbers = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      numbers.push({
        id: doc.id,
        phoneNumber: data.phoneNumber,
        apiUrl: data.apiUrl,
        price: data.price,
        type: data.type,
        status: data.status,
        addedAt: data.addedAt,
        soldTo: data.soldTo,
        soldAt: data.soldAt
      });
    });
    
    res.json({
      success: true,
      data: numbers,
      count: numbers.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Helper function to mask phone number
function maskPhoneNumber(phoneNumber) {
  if (!phoneNumber) return 'N/A';
  
  const digits = phoneNumber.toString().replace(/\D/g, '');
  
  if (digits.length === 10) {
    const areaCode = digits.substring(0, 3);
    return `+1 (${areaCode}) XXX-XXXX`;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    const areaCode = digits.substring(1, 4);
    return `+1 (${areaCode}) XXX-XXXX`;
  }
  
  return phoneNumber;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 USANumbers Backend running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/api/health`);
  console.log(`📞 Numbers API: http://localhost:${PORT}/api/numbers`);
});
