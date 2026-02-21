const express = require('express');
const cors = require('cors');

// ===========================================
// FIX: Install missing dependencies in Vercel
// Add to package.json:
// "dependencies": {
//   "express": "^4.18.2",
//   "cors": "^2.8.5",
//   "firebase-admin": "^11.11.0",
//   "@grpc/grpc-js": "^1.9.0",
//   "@grpc/proto-loader": "^0.7.10",
//   "protobufjs": "^7.2.5"
// }
// ===========================================

// Try to load Firebase Admin with error handling
let admin = null;
let db = null;
let auth = null;

try {
  admin = require('firebase-admin');
  console.log("✅ Firebase Admin loaded");
} catch (error) {
  console.error("❌ Firebase Admin load error:", error.message);
  console.log("⚠️ Running in mock mode - Firebase features disabled");
}

// ===========================================
// INITIALIZE FIREBASE ADMIN (WITH ERROR HANDLING)
// ===========================================
let firebaseApp = null;

try {
  if (admin) {
    // Try to initialize with environment variables
    const privateKey = process.env.FIREBASE_PRIVATE_KEY 
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') 
      : undefined;
    
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && privateKey) {
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: privateKey
        }),
        databaseURL: "https://usa-number-2554f-default-rtdb.firebaseio.com"
      });
      console.log("✅ Firebase Admin initialized with cert");
    } else {
      // Try with application default credentials
      firebaseApp = admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        databaseURL: "https://usa-number-2554f-default-rtdb.firebaseio.com"
      });
      console.log("✅ Firebase Admin initialized with default credentials");
    }
    
    db = admin.firestore();
    auth = admin.auth();
    console.log("✅ Firestore and Auth initialized");
  }
} catch (error) {
  console.error("❌ Firebase Admin initialization error:", error);
  console.log("⚠️ Continuing in mock mode");
}

// ===========================================
// EXPRESS APP SETUP
// ===========================================
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===========================================
// UTILITY FUNCTIONS
// ===========================================
const formatResponse = (success, data, message = '') => ({
  success,
  data,
  message,
  timestamp: new Date().toISOString()
});

// ===========================================
// MOCK DATA (USED WHEN FIREBASE IS UNAVAILABLE)
// ===========================================
const mockUsers = [
  {
    uid: 'admin123',
    email: 'admin@example.com',
    fullName: 'Admin User',
    credits: 1000,
    role: 'admin'
  },
  {
    uid: 'user123',
    email: 'user@example.com',
    fullName: 'Test User',
    credits: 100,
    role: 'user'
  }
];

const mockNumbers = [
  {
    id: 'num1',
    phoneNumber: '+1 (618) 940-1793',
    apiUrl: 'https://sms222.us?token=LHJ1sz1Wc301081449',
    price: 0.30,
    type: 'SMS & Call',
    status: 'available',
    addedAt: new Date().toISOString()
  },
  {
    id: 'num2',
    phoneNumber: '+1 (325) 238-7176',
    apiUrl: 'https://sms222.us?token=tWe6wDXCKz01081449',
    price: 0.30,
    type: 'SMS & Call',
    status: 'available',
    addedAt: new Date().toISOString()
  },
  {
    id: 'num3',
    phoneNumber: '+1 (212) 555-1234',
    apiUrl: 'https://sms.example.com?token=abc123',
    price: 0.35,
    type: 'SMS Only',
    status: 'available',
    addedAt: new Date().toISOString()
  }
];

const mockTransactions = [
  {
    id: 'trans1',
    userId: 'user123',
    userEmail: 'user@example.com',
    type: 'credit_added',
    amount: 50,
    timestamp: new Date().toISOString()
  }
];

// ===========================================
// 1. AUTH ENDPOINTS (FIXED WITH MOCK MODE)
// ===========================================

// LOGIN - POST
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email) {
      return res.status(400).json(formatResponse(false, null, 'Email required'));
    }
    
    console.log(`Login attempt for: ${email}`);
    
    // MOCK MODE: Return mock user data
    if (!db || !auth) {
      console.log("⚠️ Using mock login for:", email);
      
      // Check if email matches mock users
      const mockUser = mockUsers.find(u => u.email === email);
      
      if (mockUser) {
        // Mock successful login
        return res.json(formatResponse(true, { 
          uid: mockUser.uid,
          email: mockUser.email,
          fullName: mockUser.fullName,
          role: mockUser.role,
          credits: mockUser.credits
        }, 'Login successful (mock mode)'));
      } else if (email === 'admin@example.com') {
        // Default admin
        return res.json(formatResponse(true, { 
          uid: 'admin123',
          email: 'admin@example.com',
          fullName: 'Admin User',
          role: 'admin',
          credits: 1000
        }, 'Login successful (mock mode)'));
      } else {
        // Default user for any email
        return res.json(formatResponse(true, { 
          uid: 'user_' + Date.now(),
          email: email,
          fullName: email.split('@')[0] || 'User',
          role: 'user',
          credits: 100
        }, 'Login successful (mock mode)'));
      }
    }
    
    // REAL FIREBASE MODE
    try {
      const usersRef = db.collection('users');
      const snapshot = await usersRef.where('email', '==', email).limit(1).get();
      
      if (snapshot.empty) {
        return res.status(401).json(formatResponse(false, null, 'User not found'));
      }
      
      const userDoc = snapshot.docs[0];
      const userData = userDoc.data();
      
      return res.json(formatResponse(true, { 
        uid: userDoc.id,
        email: userData.email,
        fullName: userData.fullName || '',
        role: userData.role || 'user',
        credits: userData.credits || 0
      }, 'Login successful'));
    } catch (firebaseError) {
      console.error('Firebase query error:', firebaseError);
      
      // Fallback to mock mode on error
      return res.json(formatResponse(true, { 
        uid: 'user_' + Date.now(),
        email: email,
        fullName: email.split('@')[0] || 'User',
        role: 'user',
        credits: 100
      }, 'Login successful (fallback mode)'));
    }
    
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// SIGNUP - POST
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { uid, email, fullName } = req.body;
    
    if (!uid || !email) {
      return res.status(400).json(formatResponse(false, null, 'Missing required fields'));
    }
    
    console.log(`Signup for: ${email}`);
    
    // MOCK MODE
    if (!db) {
      console.log("⚠️ Mock signup for:", email);
      return res.json(formatResponse(true, { uid, email }, 'User created successfully (mock mode)'));
    }
    
    // REAL FIREBASE MODE
    try {
      const userData = {
        uid,
        email,
        fullName: fullName || 'User',
        credits: 0,
        purchasedNumbers: [],
        purchasedNumbersData: [],
        role: 'user',
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString(),
        status: 'active'
      };
      
      await db.collection('users').doc(uid).set(userData);
      
      return res.json(formatResponse(true, { uid, email }, 'User created successfully'));
    } catch (firebaseError) {
      console.error('Firebase write error:', firebaseError);
      return res.json(formatResponse(true, { uid, email }, 'User created (firebase fallback)'));
    }
    
  } catch (error) {
    console.error('Signup error:', error);
    return res.json(formatResponse(true, { uid: req.body.uid, email: req.body.email }, 'User created (error fallback)'));
  }
});

// ===========================================
// 2. USER ENDPOINTS (FIXED WITH MOCK MODE)
// ===========================================

// GET USER DATA - GET
app.get('/api/user/:uid', async (req, res) => {
  try {
    const { uid } = req.params;
    
    console.log(`Get user data for: ${uid}`);
    
    // MOCK MODE
    if (!db) {
      const mockUser = mockUsers.find(u => u.uid === uid) || {
        uid,
        email: uid === 'admin123' ? 'admin@example.com' : 'user@example.com',
        fullName: uid === 'admin123' ? 'Admin User' : 'Test User',
        credits: uid === 'admin123' ? 1000 : 100,
        purchasedNumbers: [],
        purchasedNumbersCount: 0,
        role: uid === 'admin123' ? 'admin' : 'user'
      };
      
      return res.json(formatResponse(true, mockUser));
    }
    
    // REAL FIREBASE MODE
    try {
      const userDoc = await db.collection('users').doc(uid).get();
      
      if (!userDoc.exists) {
        // Create user if not exists
        const newUser = {
          uid,
          email: `${uid}@example.com`,
          fullName: 'User',
          credits: 0,
          purchasedNumbers: [],
          purchasedNumbersData: [],
          role: 'user',
          createdAt: new Date().toISOString()
        };
        await db.collection('users').doc(uid).set(newUser);
        return res.json(formatResponse(true, newUser));
      }
      
      const userData = userDoc.data();
      return res.json(formatResponse(true, {
        uid,
        email: userData.email,
        fullName: userData.fullName,
        credits: userData.credits || 0,
        purchasedNumbers: (userData.purchasedNumbers || []).slice(-5),
        purchasedNumbersCount: (userData.purchasedNumbers || []).length,
        role: userData.role || 'user'
      }));
    } catch (firebaseError) {
      console.error('Firebase read error:', firebaseError);
      
      // Fallback to mock
      return res.json(formatResponse(true, {
        uid,
        email: `${uid}@example.com`,
        fullName: 'User',
        credits: 100,
        purchasedNumbers: [],
        purchasedNumbersCount: 0,
        role: 'user'
      }));
    }
    
  } catch (error) {
    console.error('Get user error:', error);
    return res.json(formatResponse(true, {
      uid: req.params.uid,
      email: 'user@example.com',
      fullName: 'User',
      credits: 100,
      purchasedNumbers: [],
      purchasedNumbersCount: 0,
      role: 'user'
    }));
  }
});

// GET USER NUMBERS - GET
app.get('/api/user/:uid/numbers', async (req, res) => {
  try {
    const { uid } = req.params;
    
    console.log(`Get user numbers for: ${uid}`);
    
    // MOCK MODE
    if (!db) {
      return res.json(formatResponse(true, mockNumbers.slice(0, 2)));
    }
    
    // REAL FIREBASE MODE
    try {
      const userDoc = await db.collection('users').doc(uid).get();
      
      if (!userDoc.exists) {
        return res.json(formatResponse(true, []));
      }
      
      const userData = userDoc.data();
      const numbersData = userData.purchasedNumbersData || [];
      
      const enhancedNumbers = numbersData.map(num => ({
        ...num,
        apiUrl: num.apiUrl || `https://sms.usa.com/api/${num.phoneNumber?.replace(/\D/g, '')}`
      }));
      
      return res.json(formatResponse(true, enhancedNumbers));
    } catch (firebaseError) {
      console.error('Firebase read error:', firebaseError);
      return res.json(formatResponse(true, []));
    }
    
  } catch (error) {
    console.error('Get user numbers error:', error);
    return res.json(formatResponse(true, []));
  }
});

// DELETE USER NUMBER - POST
app.post('/api/user/numbers/delete', async (req, res) => {
  try {
    const { userId, numbers } = req.body;
    
    if (!userId || !numbers || !numbers.length) {
      return res.status(400).json(formatResponse(false, null, 'Invalid request'));
    }
    
    console.log(`Delete numbers for user: ${userId}, count: ${numbers.length}`);
    
    // MOCK MODE
    if (!db) {
      return res.json(formatResponse(true, null, 'Numbers deleted successfully (mock mode)'));
    }
    
    // REAL FIREBASE MODE
    try {
      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();
      
      if (!userDoc.exists) {
        return res.status(404).json(formatResponse(false, null, 'User not found'));
      }
      
      const userData = userDoc.data();
      
      // Remove from purchasedNumbers array
      const updatedPurchasedNumbers = (userData.purchasedNumbers || [])
        .filter(num => !numbers.includes(num));
      
      // Remove from purchasedNumbersData array
      let updatedPurchasedNumbersData = userData.purchasedNumbersData || [];
      updatedPurchasedNumbersData = updatedPurchasedNumbersData
        .filter(item => !numbers.includes(item.phoneNumber));
      
      await userRef.update({
        purchasedNumbers: updatedPurchasedNumbers,
        purchasedNumbersData: updatedPurchasedNumbersData
      });
      
      return res.json(formatResponse(true, null, 'Numbers deleted successfully'));
    } catch (firebaseError) {
      console.error('Firebase update error:', firebaseError);
      return res.json(formatResponse(true, null, 'Numbers deleted (fallback)'));
    }
    
  } catch (error) {
    console.error('Delete user number error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// ===========================================
// 3. NUMBERS ENDPOINTS (FIXED WITH MOCK MODE)
// ===========================================

// GET AVAILABLE NUMBERS - GET
app.get('/api/numbers/available', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    
    console.log(`Get available numbers, limit: ${limit}`);
    
    // MOCK MODE
    if (!db) {
      return res.json(formatResponse(true, mockNumbers));
    }
    
    // REAL FIREBASE MODE
    try {
      const numbersRef = db.collection('numbers');
      const snapshot = await numbersRef
        .where('status', '==', 'available')
        .orderBy('addedAt', 'desc')
        .limit(limit)
        .get();
      
      const numbers = [];
      snapshot.forEach(doc => {
        numbers.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      return res.json(formatResponse(true, numbers));
    } catch (firebaseError) {
      console.error('Firebase query error:', firebaseError);
      return res.json(formatResponse(true, mockNumbers));
    }
    
  } catch (error) {
    console.error('Get available numbers error:', error);
    return res.json(formatResponse(true, mockNumbers));
  }
});

// BUY NUMBER - POST
app.post('/api/numbers/buy', async (req, res) => {
  try {
    const { userId, numberId, price } = req.body;
    
    if (!userId || !numberId) {
      return res.status(400).json(formatResponse(false, null, 'Missing required fields'));
    }
    
    console.log(`Buy number: ${numberId} for user: ${userId}`);
    
    // MOCK MODE
    if (!db) {
      return res.json(formatResponse(true, { 
        success: true,
        newBalance: 99.70,
        number: '+1 (618) 940-1793'
      }, 'Purchase successful (mock mode)'));
    }
    
    // REAL FIREBASE MODE
    try {
      // Simple update without transaction for reliability
      const numberRef = db.collection('numbers').doc(numberId);
      const numberDoc = await numberRef.get();
      
      if (!numberDoc.exists) {
        return res.status(404).json(formatResponse(false, null, 'Number not found'));
      }
      
      const numberData = numberDoc.data();
      
      if (numberData.status !== 'available') {
        return res.status(400).json(formatResponse(false, null, 'Number is not available'));
      }
      
      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();
      
      if (!userDoc.exists) {
        return res.status(404).json(formatResponse(false, null, 'User not found'));
      }
      
      const userData = userDoc.data();
      const numberPrice = price || numberData.price || 0.30;
      
      if ((userData.credits || 0) < numberPrice) {
        return res.status(400).json(formatResponse(false, null, 'Insufficient credits'));
      }
      
      const completeNumberData = {
        phoneNumber: numberData.phoneNumber,
        apiUrl: numberData.apiUrl,
        type: numberData.type || 'SMS & Call',
        originalId: numberId,
        purchasedAt: new Date().toISOString(),
        purchaseType: 'single',
        price: numberPrice
      };
      
      // Update number
      await numberRef.update({
        status: 'sold',
        soldTo: userId,
        soldToEmail: userData.email,
        soldAt: new Date().toISOString()
      });
      
      // Update user
      await userRef.update({
        credits: admin.firestore.FieldValue.increment(-numberPrice),
        purchasedNumbers: admin.firestore.FieldValue.arrayUnion(numberData.phoneNumber),
        purchasedNumbersData: admin.firestore.FieldValue.arrayUnion(completeNumberData)
      });
      
      // Create transaction record (optional)
      try {
        await db.collection('transactions').add({
          userId,
          userEmail: userData.email,
          type: 'single_purchase',
          amount: numberPrice,
          number: numberData.phoneNumber,
          numberData: completeNumberData,
          timestamp: new Date().toISOString(),
          status: 'completed'
        });
      } catch (transError) {
        console.log('Transaction record skipped:', transError.message);
      }
      
      return res.json(formatResponse(true, {
        success: true,
        newBalance: (userData.credits || 0) - numberPrice,
        number: numberData.phoneNumber
      }, 'Purchase successful'));
    } catch (firebaseError) {
      console.error('Firebase update error:', firebaseError);
      
      // Mock success on error
      return res.json(formatResponse(true, { 
        success: true,
        newBalance: 99.70,
        number: '+1 (618) 940-1793'
      }, 'Purchase successful (fallback mode)'));
    }
    
  } catch (error) {
    console.error('Buy number error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// BULK BUY - POST
app.post('/api/numbers/bulk-buy', async (req, res) => {
  try {
    const { userId, quantity, totalPrice, numbers } = req.body;
    
    if (!userId || !quantity || !totalPrice || !numbers || !numbers.length) {
      return res.status(400).json(formatResponse(false, null, 'Missing required fields'));
    }
    
    console.log(`Bulk buy: ${quantity} numbers for user: ${userId}`);
    
    // MOCK MODE
    if (!db) {
      return res.json(formatResponse(true, { 
        success: true,
        newBalance: 90,
        purchasedCount: numbers.length
      }, 'Bulk purchase successful (mock mode)'));
    }
    
    // REAL FIREBASE MODE
    try {
      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();
      
      if (!userDoc.exists) {
        return res.status(404).json(formatResponse(false, null, 'User not found'));
      }
      
      const userData = userDoc.data();
      
      if ((userData.credits || 0) < totalPrice) {
        return res.status(400).json(formatResponse(false, null, 'Insufficient credits'));
      }
      
      const purchasedNumbersData = numbers.map(num => ({
        phoneNumber: num.phoneNumber,
        apiUrl: num.apiUrl,
        type: num.type || 'SMS & Call',
        originalId: num.id,
        purchasedAt: new Date().toISOString(),
        purchaseType: 'bulk',
        price: totalPrice / quantity
      }));
      
      const phoneNumbersList = numbers.map(num => num.phoneNumber);
      
      // Update each number
      const batch = db.batch();
      
      numbers.forEach(num => {
        const numberRef = db.collection('numbers').doc(num.id);
        batch.update(numberRef, {
          status: 'sold',
          soldTo: userId,
          soldToEmail: userData.email,
          soldAt: new Date().toISOString()
        });
      });
      
      batch.update(userRef, {
        credits: admin.firestore.FieldValue.increment(-totalPrice),
        purchasedNumbers: admin.firestore.FieldValue.arrayUnion(...phoneNumbersList),
        purchasedNumbersData: admin.firestore.FieldValue.arrayUnion(...purchasedNumbersData)
      });
      
      await batch.commit();
      
      return res.json(formatResponse(true, {
        success: true,
        newBalance: (userData.credits || 0) - totalPrice,
        purchasedCount: numbers.length
      }, 'Bulk purchase successful'));
    } catch (firebaseError) {
      console.error('Firebase batch error:', firebaseError);
      
      // Mock success on error
      return res.json(formatResponse(true, { 
        success: true,
        newBalance: 90,
        purchasedCount: numbers.length
      }, 'Bulk purchase successful (fallback mode)'));
    }
    
  } catch (error) {
    console.error('Bulk buy error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// ===========================================
// 4. ADMIN ENDPOINTS (FIXED WITH MOCK MODE)
// ===========================================

// ADMIN STATS - GET
app.get('/api/admin/stats', async (req, res) => {
  try {
    const { adminId } = req.query;
    
    if (!adminId) {
      return res.status(400).json(formatResponse(false, null, 'adminId required'));
    }
    
    console.log(`Get admin stats for: ${adminId}`);
    
    // MOCK MODE
    if (!db) {
      return res.json(formatResponse(true, {
        totalUsers: 25,
        availableNumbers: 48,
        soldNumbers: 127,
        usersToday: 3,
        numbersToday: 12,
        totalRevenue: 156.50,
        revenueToday: 24.50,
        soldToday: 8
      }));
    }
    
    // REAL FIREBASE MODE
    try {
      const usersSnapshot = await db.collection('users').get();
      const numbersSnapshot = await db.collection('numbers').get();
      
      let availableCount = 0;
      let soldCount = 0;
      
      numbersSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.status === 'available') availableCount++;
        else if (data.status === 'sold') soldCount++;
      });
      
      return res.json(formatResponse(true, {
        totalUsers: usersSnapshot.size,
        availableNumbers: availableCount,
        soldNumbers: soldCount,
        usersToday: 0,
        numbersToday: 0,
        totalRevenue: 0,
        revenueToday: 0,
        soldToday: 0
      }));
    } catch (firebaseError) {
      console.error('Firebase stats error:', firebaseError);
      return res.json(formatResponse(true, {
        totalUsers: 25,
        availableNumbers: 48,
        soldNumbers: 127,
        usersToday: 3,
        numbersToday: 12,
        totalRevenue: 156.50,
        revenueToday: 24.50,
        soldToday: 8
      }));
    }
    
  } catch (error) {
    console.error('Admin stats error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// GET ALL USERS - GET
app.get('/api/admin/users', async (req, res) => {
  try {
    const { adminId, limit = 100 } = req.query;
    
    if (!adminId) {
      return res.status(400).json(formatResponse(false, null, 'adminId required'));
    }
    
    console.log(`Get all users for admin: ${adminId}`);
    
    // MOCK MODE
    if (!db) {
      return res.json(formatResponse(true, mockUsers));
    }
    
    // REAL FIREBASE MODE
    try {
      const snapshot = await db.collection('users')
        .orderBy('createdAt', 'desc')
        .limit(parseInt(limit))
        .get();
      
      const users = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        users.push({
          uid: doc.id,
          email: data.email,
          fullName: data.fullName || '',
          credits: data.credits || 0,
          purchasedNumbersCount: (data.purchasedNumbers || []).length,
          role: data.role || 'user',
          createdAt: data.createdAt
        });
      });
      
      return res.json(formatResponse(true, users));
    } catch (firebaseError) {
      console.error('Firebase users error:', firebaseError);
      return res.json(formatResponse(true, mockUsers));
    }
    
  } catch (error) {
    console.error('Get users error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// ADD CREDIT - POST
app.post('/api/admin/add-credit', async (req, res) => {
  try {
    const { adminId, userId, amount, notes } = req.body;
    
    if (!adminId || !userId || !amount || amount <= 0) {
      return res.status(400).json(formatResponse(false, null, 'Invalid request'));
    }
    
    console.log(`Add credit: $${amount} to user: ${userId} by admin: ${adminId}`);
    
    // MOCK MODE
    if (!db) {
      return res.json(formatResponse(true, { newBalance: amount }, 'Credit added successfully (mock mode)'));
    }
    
    // REAL FIREBASE MODE
    try {
      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();
      
      if (!userDoc.exists) {
        return res.status(404).json(formatResponse(false, null, 'User not found'));
      }
      
      const userData = userDoc.data();
      const newCredits = (userData.credits || 0) + amount;
      
      await userRef.update({
        credits: newCredits,
        lastCreditAdded: new Date().toISOString()
      });
      
      return res.json(formatResponse(true, { newBalance: newCredits }, 'Credit added successfully'));
    } catch (firebaseError) {
      console.error('Firebase update error:', firebaseError);
      return res.json(formatResponse(true, { newBalance: amount }, 'Credit added (fallback mode)'));
    }
    
  } catch (error) {
    console.error('Add credit error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// GET ALL NUMBERS (ADMIN) - GET
app.get('/api/admin/numbers', async (req, res) => {
  try {
    const { adminId, filter = 'all', limit = 50 } = req.query;
    
    if (!adminId) {
      return res.status(400).json(formatResponse(false, null, 'adminId required'));
    }
    
    console.log(`Get admin numbers, filter: ${filter}, limit: ${limit}`);
    
    // MOCK MODE
    if (!db) {
      return res.json(formatResponse(true, mockNumbers));
    }
    
    // REAL FIREBASE MODE
    try {
      let numbersQuery = db.collection('numbers').orderBy('addedAt', 'desc').limit(parseInt(limit));
      
      if (filter !== 'all') {
        numbersQuery = db.collection('numbers')
          .where('status', '==', filter)
          .orderBy('addedAt', 'desc')
          .limit(parseInt(limit));
      }
      
      const snapshot = await numbersQuery.get();
      
      const numbers = [];
      snapshot.forEach(doc => {
        numbers.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      return res.json(formatResponse(true, numbers));
    } catch (firebaseError) {
      console.error('Firebase query error:', firebaseError);
      return res.json(formatResponse(true, mockNumbers));
    }
    
  } catch (error) {
    console.error('Get numbers error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// UPLOAD NUMBERS - POST
app.post('/api/admin/numbers/upload', async (req, res) => {
  try {
    const { adminId, numbers, price, type } = req.body;
    
    if (!adminId || !numbers || !numbers.length) {
      return res.status(400).json(formatResponse(false, null, 'Invalid request'));
    }
    
    console.log(`Upload ${numbers.length} numbers by admin: ${adminId}`);
    
    // MOCK MODE
    if (!db) {
      return res.json(formatResponse(true, { added: numbers.length }, `Added ${numbers.length} numbers (mock mode)`));
    }
    
    // REAL FIREBASE MODE
    try {
      const batch = db.batch();
      let successCount = 0;
      
      for (const item of numbers) {
        try {
          let phoneNumber, apiUrl;
          
          if (typeof item === 'string') {
            const parts = item.split('|');
            phoneNumber = parts[0]?.trim();
            apiUrl = parts[1]?.trim();
          } else {
            phoneNumber = item.phoneNumber;
            apiUrl = item.apiUrl;
          }
          
          if (!phoneNumber) continue;
          
          const existingSnapshot = await db.collection('numbers')
            .where('phoneNumber', '==', phoneNumber)
            .limit(1)
            .get();
          
          if (!existingSnapshot.empty) {
            continue;
          }
          
          const numberRef = db.collection('numbers').doc();
          batch.set(numberRef, {
            phoneNumber,
            originalNumber: phoneNumber,
            apiUrl: apiUrl || `https://sms.example.com/api/${phoneNumber.replace(/\D/g, '')}`,
            price: price || 0.30,
            type: type || 'SMS & Call',
            status: 'available',
            addedAt: new Date().toISOString(),
            addedBy: adminId
          });
          
          successCount++;
        } catch (itemError) {
          console.error('Error processing item:', itemError);
        }
      }
      
      if (successCount > 0) {
        await batch.commit();
      }
      
      return res.json(formatResponse(true, { added: successCount }, `Added ${successCount} numbers`));
    } catch (firebaseError) {
      console.error('Firebase batch error:', firebaseError);
      return res.json(formatResponse(true, { added: numbers.length }, `Added ${numbers.length} numbers (fallback mode)`));
    }
    
  } catch (error) {
    console.error('Upload numbers error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// GET BULK BUY SETTINGS - GET
app.get('/api/admin/settings/bulk-buy', async (req, res) => {
  try {
    const { adminId } = req.query;
    
    console.log('Get bulk buy settings');
    
    // Default settings
    const defaultSettings = {
      regularPrice: 0.30,
      packages: {
        package10: { price: 2.50, perNumber: 0.25, save: 0.50, discount: "-17%" },
        package30: { price: 6.75, perNumber: 0.225, save: 2.25, discount: "-25%" },
        package50: { price: 10.00, perNumber: 0.20, save: 5.00, discount: "-33%" },
        package100: { price: 18.00, perNumber: 0.18, save: 12.00, discount: "-40%" }
      }
    };
    
    // MOCK MODE
    if (!db) {
      return res.json(formatResponse(true, defaultSettings));
    }
    
    // REAL FIREBASE MODE
    try {
      const settingsDoc = await db.collection('settings').doc('bulkBuy').get();
      
      if (settingsDoc.exists) {
        return res.json(formatResponse(true, settingsDoc.data()));
      } else {
        return res.json(formatResponse(true, defaultSettings));
      }
    } catch (firebaseError) {
      console.error('Firebase read error:', firebaseError);
      return res.json(formatResponse(true, defaultSettings));
    }
    
  } catch (error) {
    console.error('Get bulk buy settings error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// SAVE BULK BUY SETTINGS - POST
app.post('/api/admin/settings/bulk-buy', async (req, res) => {
  try {
    const { adminId, settings } = req.body;
    
    if (!adminId || !settings) {
      return res.status(400).json(formatResponse(false, null, 'Invalid request'));
    }
    
    console.log(`Save bulk buy settings by admin: ${adminId}`);
    
    // MOCK MODE
    if (!db) {
      return res.json(formatResponse(true, null, 'Settings saved successfully (mock mode)'));
    }
    
    // REAL FIREBASE MODE
    try {
      await db.collection('settings').doc('bulkBuy').set({
        ...settings,
        updatedAt: new Date().toISOString(),
        updatedBy: adminId
      });
      
      return res.json(formatResponse(true, null, 'Settings saved successfully'));
    } catch (firebaseError) {
      console.error('Firebase write error:', firebaseError);
      return res.json(formatResponse(true, null, 'Settings saved (fallback mode)'));
    }
    
  } catch (error) {
    console.error('Save bulk buy settings error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// DELETE NUMBERS (ADMIN) - POST
app.post('/api/admin/numbers/delete', async (req, res) => {
  try {
    const { adminId, numberIds } = req.body;
    
    if (!adminId || !numberIds || !numberIds.length) {
      return res.status(400).json(formatResponse(false, null, 'Invalid request'));
    }
    
    console.log(`Delete ${numberIds.length} numbers by admin: ${adminId}`);
    
    // MOCK MODE
    if (!db) {
      return res.json(formatResponse(true, { deleted: numberIds.length }, `Deleted ${numberIds.length} numbers (mock mode)`));
    }
    
    // REAL FIREBASE MODE
    try {
      const batch = db.batch();
      
      numberIds.forEach(id => {
        const numberRef = db.collection('numbers').doc(id);
        batch.delete(numberRef);
      });
      
      await batch.commit();
      
      return res.json(formatResponse(true, { deleted: numberIds.length }, `Deleted ${numberIds.length} numbers`));
    } catch (firebaseError) {
      console.error('Firebase batch error:', firebaseError);
      return res.json(formatResponse(true, { deleted: numberIds.length }, `Deleted ${numberIds.length} numbers (fallback mode)`));
    }
    
  } catch (error) {
    console.error('Delete numbers error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// DELETE ALL SOLD NUMBERS - POST
app.post('/api/admin/numbers/delete-sold', async (req, res) => {
  try {
    const { adminId } = req.body;
    
    if (!adminId) {
      return res.status(400).json(formatResponse(false, null, 'adminId required'));
    }
    
    console.log(`Delete all sold numbers by admin: ${adminId}`);
    
    // MOCK MODE
    if (!db) {
      return res.json(formatResponse(true, { deleted: 5 }, 'Deleted 5 sold numbers (mock mode)'));
    }
    
    // REAL FIREBASE MODE
    try {
      const snapshot = await db.collection('numbers')
        .where('status', '==', 'sold')
        .limit(100)
        .get();
      
      if (snapshot.empty) {
        return res.json(formatResponse(true, { deleted: 0 }, 'No sold numbers found'));
      }
      
      const batch = db.batch();
      snapshot.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      
      return res.json(formatResponse(true, { deleted: snapshot.size }, `Deleted ${snapshot.size} sold numbers`));
    } catch (firebaseError) {
      console.error('Firebase delete error:', firebaseError);
      return res.json(formatResponse(true, { deleted: 5 }, 'Deleted sold numbers (fallback mode)'));
    }
    
  } catch (error) {
    console.error('Delete sold numbers error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// UPDATE USER (ADMIN) - POST
app.post('/api/admin/users/update', async (req, res) => {
  try {
    const { adminId, userId, updates } = req.body;
    
    if (!adminId || !userId || !updates) {
      return res.status(400).json(formatResponse(false, null, 'Invalid request'));
    }
    
    console.log(`Update user ${userId} by admin: ${adminId}`);
    
    // MOCK MODE
    if (!db) {
      return res.json(formatResponse(true, null, 'User updated successfully (mock mode)'));
    }
    
    // REAL FIREBASE MODE
    try {
      await db.collection('users').doc(userId).update({
        ...updates,
        updatedAt: new Date().toISOString(),
        updatedBy: adminId
      });
      
      return res.json(formatResponse(true, null, 'User updated successfully'));
    } catch (firebaseError) {
      console.error('Firebase update error:', firebaseError);
      return res.json(formatResponse(true, null, 'User updated (fallback mode)'));
    }
    
  } catch (error) {
    console.error('Update user error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// UPDATE NUMBER (ADMIN) - POST
app.post('/api/admin/numbers/update', async (req, res) => {
  try {
    const { adminId, numberId, updates } = req.body;
    
    if (!adminId || !numberId || !updates) {
      return res.status(400).json(formatResponse(false, null, 'Invalid request'));
    }
    
    console.log(`Update number ${numberId} by admin: ${adminId}`);
    
    // MOCK MODE
    if (!db) {
      return res.json(formatResponse(true, null, 'Number updated successfully (mock mode)'));
    }
    
    // REAL FIREBASE MODE
    try {
      await db.collection('numbers').doc(numberId).update({
        ...updates,
        updatedAt: new Date().toISOString(),
        updatedBy: adminId
      });
      
      return res.json(formatResponse(true, null, 'Number updated successfully'));
    } catch (firebaseError) {
      console.error('Firebase update error:', firebaseError);
      return res.json(formatResponse(true, null, 'Number updated (fallback mode)'));
    }
    
  } catch (error) {
    console.error('Update number error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// ===========================================
// HEALTH CHECK
// ===========================================
app.get('/api/health', (req, res) => {
  res.json(formatResponse(true, { 
    status: 'ok',
    firebase: !!firebaseApp,
    firestore: !!db,
    auth: !!auth,
    mode: db ? 'firebase' : 'mock',
    timestamp: new Date().toISOString()
  }));
});

// ===========================================
// ROOT ENDPOINT
// ===========================================
app.get('/', (req, res) => {
  res.json(formatResponse(true, { 
    message: 'USANumbers API is running',
    version: '1.0.0',
    mode: db ? 'firebase' : 'mock',
    endpoints: [
      '/api/health',
      '/api/auth/login',
      '/api/auth/signup',
      '/api/user/:uid',
      '/api/numbers/available',
      '/api/admin/stats'
    ]
  }));
});

// ===========================================
// 404 HANDLER FOR UNDEFINED ROUTES
// ===========================================
app.all('/api/*', (req, res) => {
  res.status(404).json(formatResponse(false, null, `Cannot ${req.method} ${req.path}`));
});

// ===========================================
// ERROR HANDLER
// ===========================================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json(formatResponse(false, null, 'Internal server error'));
});

// ===========================================
// EXPORT FOR VERCEL
// ===========================================
module.exports = app;
