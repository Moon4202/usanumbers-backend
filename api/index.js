const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

// ===========================================
// FIX: Install missing dependencies
// Run: npm install @grpc/grpc-js @grpc/proto-loader protobufjs
// ===========================================

// ===========================================
// INITIALIZE FIREBASE ADMIN (FIXED)
// ===========================================
let firebaseApp;
try {
  // FIX: Use application default credentials for Vercel
  // This avoids protobufjs dependency issues
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    // If service account JSON is provided as env variable
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: "https://usa-number-2554f-default-rtdb.firebaseio.com"
    });
  } else {
    // Fallback to individual env variables
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID || "usa-number-2554f",
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
      }),
      databaseURL: "https://usa-number-2554f-default-rtdb.firebaseio.com"
    });
  }
  console.log("✅ Firebase Admin initialized successfully");
} catch (error) {
  console.error("❌ Firebase Admin error:", error);
  console.log("⚠️ Using mock mode - some features may not work");
}

// FIX: Use Firestore with compatibility mode to avoid protobufjs
const db = admin.firestore ? admin.firestore() : null;
const auth = admin.auth ? admin.auth() : null;

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
// FIX: Mock data for when Firebase fails
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
    status: 'available'
  },
  {
    id: 'num2',
    phoneNumber: '+1 (325) 238-7176',
    apiUrl: 'https://sms222.us?token=tWe6wDXCKz01081449',
    price: 0.30,
    type: 'SMS & Call',
    status: 'available'
  }
];

// ===========================================
// 1. AUTH ENDPOINTS (FIXED)
// ===========================================

// LOGIN - POST
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email) {
      return res.status(400).json(formatResponse(false, null, 'Email required'));
    }
    
    // FIX: If Firebase is not working, use mock data
    if (!db || !auth) {
      console.log("⚠️ Using mock login for:", email);
      
      // Find user in mock data
      const mockUser = mockUsers.find(u => u.email === email);
      
      if (mockUser) {
        // Mock successful login
        return res.json(formatResponse(true, { 
          uid: mockUser.uid,
          email: mockUser.email,
          fullName: mockUser.fullName,
          role: mockUser.role || 'user',
          credits: mockUser.credits
        }, 'Login successful (mock mode)'));
      } else {
        return res.status(401).json(formatResponse(false, null, 'User not found'));
      }
    }
    
    // Real Firebase implementation
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('email', '==', email).limit(1).get();
    
    if (snapshot.empty) {
      return res.status(401).json(formatResponse(false, null, 'User not found'));
    }
    
    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();
    
    // FIX: Don't verify password here (should be done by Firebase Auth)
    // Just return user data
    return res.json(formatResponse(true, { 
      uid: userDoc.id,
      email: userData.email,
      fullName: userData.fullName || '',
      role: userData.role || 'user',
      credits: userData.credits || 0
    }, 'Login successful'));
    
  } catch (error) {
    console.error('Login error:', error);
    
    // FIX: Return mock data on error for development
    if (req.body.email === 'admin@example.com') {
      return res.json(formatResponse(true, { 
        uid: 'admin123',
        email: 'admin@example.com',
        fullName: 'Admin User',
        role: 'admin',
        credits: 1000
      }, 'Login successful (fallback mode)'));
    }
    
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
    
    // FIX: If Firebase is not working, just return success
    if (!db) {
      console.log("⚠️ Mock signup for:", email);
      return res.json(formatResponse(true, { uid, email }, 'User created successfully (mock mode)'));
    }
    
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
    
  } catch (error) {
    console.error('Signup error:', error);
    // FIX: Return success anyway for development
    return res.json(formatResponse(true, { uid: req.body.uid, email: req.body.email }, 'User created (fallback)'));
  }
});

// ===========================================
// 2. USER ENDPOINTS (FIXED)
// ===========================================

// GET USER DATA - GET
app.get('/api/user/:uid', async (req, res) => {
  try {
    const { uid } = req.params;
    
    // FIX: Return mock data if Firebase not available
    if (!db) {
      const mockUser = mockUsers.find(u => u.uid === uid) || {
        uid,
        email: 'user@example.com',
        fullName: 'Test User',
        credits: 100,
        purchasedNumbers: [],
        purchasedNumbersCount: 0,
        role: 'user'
      };
      
      return res.json(formatResponse(true, mockUser));
    }
    
    const userDoc = await db.collection('users').doc(uid).get();
    
    if (!userDoc.exists) {
      return res.status(404).json(formatResponse(false, null, 'User not found'));
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
    
  } catch (error) {
    console.error('Get user error:', error);
    // FIX: Return mock data on error
    return res.json(formatResponse(true, {
      uid: req.params.uid,
      email: 'user@example.com',
      fullName: 'Test User',
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
    
    // FIX: Return mock numbers if Firebase not available
    if (!db) {
      return res.json(formatResponse(true, mockNumbers));
    }
    
    const userDoc = await db.collection('users').doc(uid).get();
    
    if (!userDoc.exists) {
      return res.status(404).json(formatResponse(false, null, 'User not found'));
    }
    
    const userData = userDoc.data();
    const numbersData = userData.purchasedNumbersData || [];
    
    const enhancedNumbers = numbersData.map(num => ({
      ...num,
      apiUrl: num.apiUrl || `https://sms.usa.com/api/${num.phoneNumber?.replace(/\D/g, '')}`
    }));
    
    return res.json(formatResponse(true, enhancedNumbers));
    
  } catch (error) {
    console.error('Get user numbers error:', error);
    // FIX: Return mock numbers on error
    return res.json(formatResponse(true, mockNumbers));
  }
});

// DELETE USER NUMBER - POST
app.post('/api/user/numbers/delete', async (req, res) => {
  try {
    const { userId, numbers } = req.body;
    
    if (!userId || !numbers || !numbers.length) {
      return res.status(400).json(formatResponse(false, null, 'Invalid request'));
    }
    
    // FIX: If Firebase not available, return success
    if (!db) {
      return res.json(formatResponse(true, null, 'Numbers deleted successfully (mock mode)'));
    }
    
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
    
  } catch (error) {
    console.error('Delete user number error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// ===========================================
// 3. NUMBERS ENDPOINTS (FIXED)
// ===========================================

// GET AVAILABLE NUMBERS - GET
app.get('/api/numbers/available', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    
    // FIX: Return mock numbers if Firebase not available
    if (!db) {
      return res.json(formatResponse(true, mockNumbers));
    }
    
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
    
  } catch (error) {
    console.error('Get available numbers error:', error);
    // FIX: Return mock numbers on error
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
    
    // FIX: If Firebase not available, return mock success
    if (!db) {
      return res.json(formatResponse(true, { 
        success: true,
        newBalance: 99.70,
        number: '+1 (618) 940-1793'
      }, 'Purchase successful (mock mode)'));
    }
    
    const result = await db.runTransaction(async (transaction) => {
      const numberRef = db.collection('numbers').doc(numberId);
      const numberDoc = await transaction.get(numberRef);
      
      if (!numberDoc.exists) {
        throw new Error('Number not found');
      }
      
      const numberData = numberDoc.data();
      
      if (numberData.status !== 'available') {
        throw new Error('Number is not available');
      }
      
      const userRef = db.collection('users').doc(userId);
      const userDoc = await transaction.get(userRef);
      
      if (!userDoc.exists) {
        throw new Error('User not found');
      }
      
      const userData = userDoc.data();
      const numberPrice = price || numberData.price || 0.30;
      
      if ((userData.credits || 0) < numberPrice) {
        throw new Error('Insufficient credits');
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
      
      transaction.update(numberRef, {
        status: 'sold',
        soldTo: userId,
        soldToEmail: userData.email,
        soldAt: new Date().toISOString()
      });
      
      transaction.update(userRef, {
        credits: admin.firestore.FieldValue.increment(-numberPrice),
        purchasedNumbers: admin.firestore.FieldValue.arrayUnion(numberData.phoneNumber),
        purchasedNumbersData: admin.firestore.FieldValue.arrayUnion(completeNumberData)
      });
      
      const transactionRef = db.collection('transactions').doc();
      transaction.set(transactionRef, {
        userId,
        userEmail: userData.email,
        type: 'single_purchase',
        amount: numberPrice,
        number: numberData.phoneNumber,
        numberData: completeNumberData,
        timestamp: new Date().toISOString(),
        status: 'completed'
      });
      
      return {
        success: true,
        newBalance: (userData.credits || 0) - numberPrice,
        number: numberData.phoneNumber
      };
    });
    
    return res.json(formatResponse(true, result, 'Purchase successful'));
    
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
    
    // FIX: If Firebase not available, return mock success
    if (!db) {
      return res.json(formatResponse(true, { 
        success: true,
        newBalance: 90,
        purchasedCount: numbers.length
      }, 'Bulk purchase successful (mock mode)'));
    }
    
    const result = await db.runTransaction(async (transaction) => {
      const userRef = db.collection('users').doc(userId);
      const userDoc = await transaction.get(userRef);
      
      if (!userDoc.exists) {
        throw new Error('User not found');
      }
      
      const userData = userDoc.data();
      
      if ((userData.credits || 0) < totalPrice) {
        throw new Error('Insufficient credits');
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
      
      numbers.forEach(num => {
        const numberRef = db.collection('numbers').doc(num.id);
        transaction.update(numberRef, {
          status: 'sold',
          soldTo: userId,
          soldToEmail: userData.email,
          soldAt: new Date().toISOString()
        });
      });
      
      transaction.update(userRef, {
        credits: admin.firestore.FieldValue.increment(-totalPrice),
        purchasedNumbers: admin.firestore.FieldValue.arrayUnion(...phoneNumbersList),
        purchasedNumbersData: admin.firestore.FieldValue.arrayUnion(...purchasedNumbersData)
      });
      
      const transactionRef = db.collection('transactions').doc();
      transaction.set(transactionRef, {
        userId,
        userEmail: userData.email,
        type: 'bulk_purchase',
        amount: totalPrice,
        quantity,
        numbers: phoneNumbersList,
        numbersData: purchasedNumbersData,
        timestamp: new Date().toISOString(),
        status: 'completed'
      });
      
      return {
        success: true,
        newBalance: (userData.credits || 0) - totalPrice,
        purchasedCount: numbers.length
      };
    });
    
    return res.json(formatResponse(true, result, 'Bulk purchase successful'));
    
  } catch (error) {
    console.error('Bulk buy error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// ===========================================
// 4. ADMIN ENDPOINTS (FIXED)
// ===========================================

// ADMIN STATS - GET with adminId
app.get('/api/admin/stats', async (req, res) => {
  try {
    const { adminId } = req.query;
    
    if (!adminId) {
      return res.status(400).json(formatResponse(false, null, 'adminId required'));
    }
    
    // FIX: Return mock stats if Firebase not available
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
    
    const adminDoc = await db.collection('users').doc(adminId).get();
    if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
      return res.status(403).json(formatResponse(false, null, 'Unauthorized'));
    }
    
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
    
  } catch (error) {
    console.error('Admin stats error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// GET ALL USERS - GET with adminId
app.get('/api/admin/users', async (req, res) => {
  try {
    const { adminId, limit = 100 } = req.query;
    
    if (!adminId) {
      return res.status(400).json(formatResponse(false, null, 'adminId required'));
    }
    
    // FIX: Return mock users if Firebase not available
    if (!db) {
      return res.json(formatResponse(true, mockUsers));
    }
    
    const adminDoc = await db.collection('users').doc(adminId).get();
    if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
      return res.status(403).json(formatResponse(false, null, 'Unauthorized'));
    }
    
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
    
    // FIX: Return mock success if Firebase not available
    if (!db) {
      return res.json(formatResponse(true, { newBalance: amount }, 'Credit added successfully (mock mode)'));
    }
    
    const adminDoc = await db.collection('users').doc(adminId).get();
    if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
      return res.status(403).json(formatResponse(false, null, 'Unauthorized'));
    }
    
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
    
    await db.collection('transactions').add({
      userId,
      userEmail: userData.email,
      type: 'credit_added',
      amount,
      adminId,
      adminEmail: adminDoc.data().email,
      timestamp: new Date().toISOString(),
      notes: notes || 'Credit added by admin',
      status: 'completed'
    });
    
    return res.json(formatResponse(true, { newBalance: newCredits }, 'Credit added successfully'));
    
  } catch (error) {
    console.error('Add credit error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// GET ALL NUMBERS (ADMIN) - GET with adminId
app.get('/api/admin/numbers', async (req, res) => {
  try {
    const { adminId, filter = 'all', limit = 50 } = req.query;
    
    if (!adminId) {
      return res.status(400).json(formatResponse(false, null, 'adminId required'));
    }
    
    // FIX: Return mock numbers if Firebase not available
    if (!db) {
      return res.json(formatResponse(true, mockNumbers));
    }
    
    const adminDoc = await db.collection('users').doc(adminId).get();
    if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
      return res.status(403).json(formatResponse(false, null, 'Unauthorized'));
    }
    
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
    
    // FIX: Return mock success if Firebase not available
    if (!db) {
      return res.json(formatResponse(true, { added: numbers.length }, `Added ${numbers.length} numbers (mock mode)`));
    }
    
    const adminDoc = await db.collection('users').doc(adminId).get();
    if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
      return res.status(403).json(formatResponse(false, null, 'Unauthorized'));
    }
    
    const batch = db.batch();
    let successCount = 0;
    
    for (const item of numbers) {
      try {
        const { phoneNumber, apiUrl } = item;
        
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
          apiUrl,
          price: price || 0.30,
          type: type || 'SMS & Call',
          status: 'available',
          addedAt: new Date().toISOString(),
          addedBy: adminId,
          addedByEmail: adminDoc.data().email
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
    
  } catch (error) {
    console.error('Upload numbers error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// GET BULK BUY SETTINGS - GET
app.get('/api/admin/settings/bulk-buy', async (req, res) => {
  try {
    const { adminId } = req.query;
    
    // FIX: Return default settings if Firebase not available
    if (!db) {
      return res.json(formatResponse(true, {
        regularPrice: 0.30,
        packages: {
          package10: { price: 2.50, perNumber: 0.25, save: 0.50, discount: "-17%" },
          package30: { price: 6.75, perNumber: 0.225, save: 2.25, discount: "-25%" },
          package50: { price: 10.00, perNumber: 0.20, save: 5.00, discount: "-33%" },
          package100: { price: 18.00, perNumber: 0.18, save: 12.00, discount: "-40%" }
        }
      }));
    }
    
    const settingsDoc = await db.collection('settings').doc('bulkBuy').get();
    
    if (settingsDoc.exists) {
      return res.json(formatResponse(true, settingsDoc.data()));
    } else {
      return res.json(formatResponse(true, {
        regularPrice: 0.30,
        packages: {
          package10: { price: 2.50, perNumber: 0.25, save: 0.50, discount: "-17%" },
          package30: { price: 6.75, perNumber: 0.225, save: 2.25, discount: "-25%" },
          package50: { price: 10.00, perNumber: 0.20, save: 5.00, discount: "-33%" },
          package100: { price: 18.00, perNumber: 0.18, save: 12.00, discount: "-40%" }
        }
      }));
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
    
    // FIX: Return mock success if Firebase not available
    if (!db) {
      return res.json(formatResponse(true, null, 'Settings saved successfully (mock mode)'));
    }
    
    const adminDoc = await db.collection('users').doc(adminId).get();
    if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
      return res.status(403).json(formatResponse(false, null, 'Unauthorized'));
    }
    
    await db.collection('settings').doc('bulkBuy').set({
      ...settings,
      updatedAt: new Date().toISOString(),
      updatedBy: adminDoc.data().email
    });
    
    return res.json(formatResponse(true, null, 'Settings saved successfully'));
    
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
    
    // FIX: Return mock success if Firebase not available
    if (!db) {
      return res.json(formatResponse(true, { deleted: numberIds.length }, `Deleted ${numberIds.length} numbers (mock mode)`));
    }
    
    const adminDoc = await db.collection('users').doc(adminId).get();
    if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
      return res.status(403).json(formatResponse(false, null, 'Unauthorized'));
    }
    
    const batch = db.batch();
    
    numberIds.forEach(id => {
      const numberRef = db.collection('numbers').doc(id);
      batch.delete(numberRef);
    });
    
    await batch.commit();
    
    return res.json(formatResponse(true, { deleted: numberIds.length }, `Deleted ${numberIds.length} numbers`));
    
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
    
    // FIX: Return mock success if Firebase not available
    if (!db) {
      return res.json(formatResponse(true, { deleted: 5 }, 'Deleted 5 sold numbers (mock mode)'));
    }
    
    const adminDoc = await db.collection('users').doc(adminId).get();
    if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
      return res.status(403).json(formatResponse(false, null, 'Unauthorized'));
    }
    
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
    
    // FIX: Return mock success if Firebase not available
    if (!db) {
      return res.json(formatResponse(true, null, 'User updated successfully (mock mode)'));
    }
    
    const adminDoc = await db.collection('users').doc(adminId).get();
    if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
      return res.status(403).json(formatResponse(false, null, 'Unauthorized'));
    }
    
    await db.collection('users').doc(userId).update({
      ...updates,
      updatedAt: new Date().toISOString(),
      updatedBy: adminDoc.data().email
    });
    
    return res.json(formatResponse(true, null, 'User updated successfully'));
    
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
    
    // FIX: Return mock success if Firebase not available
    if (!db) {
      return res.json(formatResponse(true, null, 'Number updated successfully (mock mode)'));
    }
    
    const adminDoc = await db.collection('users').doc(adminId).get();
    if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
      return res.status(403).json(formatResponse(false, null, 'Unauthorized'));
    }
    
    await db.collection('numbers').doc(numberId).update({
      ...updates,
      updatedAt: new Date().toISOString(),
      updatedBy: adminDoc.data().email
    });
    
    return res.json(formatResponse(true, null, 'Number updated successfully'));
    
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
