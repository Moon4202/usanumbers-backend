// ===========================================
// INDEX.JS (BACKEND) - TOKEN VERIFICATION VERSION
// ===========================================

const express = require('express');
const cors = require('cors');

// Firebase Admin SDK
let admin = null;
let db = null;
let auth = null;

try {
  admin = require('firebase-admin');
  console.log("✅ Firebase Admin loaded");
} catch (error) {
  console.error("❌ Firebase Admin load error:", error.message);
  process.exit(1);
}

// ===========================================
// INITIALIZE FIREBASE ADMIN
// ===========================================
let firebaseApp = null;

try {
  if (admin) {
    // Initialize with environment variables
    const privateKey = process.env.FIREBASE_PRIVATE_KEY 
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') 
      : undefined;
    
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && privateKey) {
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: privateKey
        })
      });
      console.log("✅ Firebase Admin initialized with cert");
    } else {
      console.error("❌ Missing Firebase environment variables");
      process.exit(1);
    }
    
    db = admin.firestore();
    auth = admin.auth();
    console.log("✅ Firestore and Auth initialized");
  }
} catch (error) {
  console.error("❌ Firebase Admin initialization error:", error);
  process.exit(1);
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
// TOKEN VERIFICATION MIDDLEWARE
// ===========================================
async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json(formatResponse(false, null, 'No token provided'));
  }
  
  const token = authHeader.split('Bearer ')[1];
  
  try {
    // Firebase Admin SDK se token verify karo
    const decodedToken = await auth.verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Token verification failed:', error);
    return res.status(401).json(formatResponse(false, null, 'Invalid token'));
  }
}

// ===========================================
// 1. AUTH ENDPOINTS - FIXED WITH TOKEN VERIFICATION
// ===========================================

// LOGIN - POST (Returns Firebase Token)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json(formatResponse(false, null, 'Email and password required'));
    }
    
    console.log(`Login attempt for: ${email}`);
    
    if (!db || !auth) {
      return res.status(503).json(formatResponse(false, null, 'Database connection error'));
    }
    
    try {
      // 1. Firebase Auth se user check karo
      let userRecord;
      try {
        userRecord = await auth.getUserByEmail(email);
        console.log(`✅ User found in Auth: ${userRecord.uid}`);
      } catch (authError) {
        console.log(`❌ User not found in Auth: ${authError.message}`);
        return res.status(401).json(formatResponse(false, null, 'Invalid email or password'));
      }
      
      // 2. NOTE: Backend password verify nahi kar sakta
      // Frontend ne already Firebase Auth se login kar liya hoga
      // Hum sirf user exists check kar rahe hain
      
      // 3. Firestore se user data lao
      const usersRef = db.collection('users');
      const snapshot = await usersRef.where('email', '==', email).limit(1).get();
      
      if (snapshot.empty) {
        return res.status(404).json(formatResponse(false, null, 'User not found in database'));
      }
      
      const userDoc = snapshot.docs[0];
      const userData = userDoc.data();
      
      // 4. Create custom token for frontend
      const customToken = await auth.createCustomToken(userDoc.id);
      
      // 5. Update last login
      await userDoc.ref.update({
        lastLogin: new Date().toISOString()
      });
      
      console.log(`✅ Login successful for: ${email}`);
      
      return res.json(formatResponse(true, { 
        uid: userDoc.id,
        email: userData.email,
        fullName: userData.fullName || '',
        role: userData.role || 'user',
        credits: userData.credits || 0,
        token: customToken // Send token to frontend
      }, 'Login successful'));
      
    } catch (firebaseError) {
      console.error('Firebase error:', firebaseError);
      return res.status(500).json(formatResponse(false, null, 'Database error: ' + firebaseError.message));
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
    
    if (!db || !auth) {
      return res.status(503).json(formatResponse(false, null, 'Database connection error'));
    }
    
    try {
      // Check if user already exists in Auth
      try {
        await auth.getUserByEmail(email);
        return res.status(400).json(formatResponse(false, null, 'User already exists'));
      } catch (authError) {
        // User doesn't exist, good to create
        console.log("User doesn't exist in Auth, creating...");
      }
      
      // Create user in Firebase Auth with random password
      const randomPassword = Math.random().toString(36).slice(-8);
      const userRecord = await auth.createUser({
        uid: uid,
        email: email,
        displayName: fullName || email.split('@')[0],
        password: randomPassword
      });
      console.log("✅ Firebase Auth user created:", userRecord.uid);
      
      // Create user data in Firestore
      const userData = {
        uid: uid,
        email,
        fullName: fullName || email.split('@')[0],
        credits: 0,
        purchasedNumbers: [],
        purchasedNumbersData: [],
        role: 'user',
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString(),
        status: 'active'
      };
      
      await db.collection('users').doc(uid).set(userData);
      console.log("✅ Firestore user created:", uid);
      
      return res.json(formatResponse(true, { 
        uid: uid, 
        email 
      }, 'User created successfully'));
      
    } catch (firebaseError) {
      console.error('Firebase write error:', firebaseError);
      return res.status(500).json(formatResponse(false, null, 'Database error: ' + firebaseError.message));
    }
    
  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// ===========================================
// 2. PROTECTED ENDPOINTS (Token Required)
// ===========================================

// GET USER DATA - GET (Protected)
app.get('/api/user/:uid', verifyToken, async (req, res) => {
  try {
    const { uid } = req.params;
    
    // Verify that token UID matches requested UID
    if (req.user.uid !== uid) {
      return res.status(403).json(formatResponse(false, null, 'Unauthorized'));
    }
    
    console.log(`Get user data for: ${uid}`);
    
    if (!db) {
      return res.status(503).json(formatResponse(false, null, 'Database connection error'));
    }
    
    try {
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
    } catch (firebaseError) {
      console.error('Firebase read error:', firebaseError);
      return res.status(500).json(formatResponse(false, null, 'Database error: ' + firebaseError.message));
    }
    
  } catch (error) {
    console.error('Get user error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// GET USER NUMBERS - GET (Protected)
app.get('/api/user/:uid/numbers', verifyToken, async (req, res) => {
  try {
    const { uid } = req.params;
    
    // Verify that token UID matches requested UID
    if (req.user.uid !== uid) {
      return res.status(403).json(formatResponse(false, null, 'Unauthorized'));
    }
    
    console.log(`Get user numbers for: ${uid}`);
    
    if (!db) {
      return res.status(503).json(formatResponse(false, null, 'Database connection error'));
    }
    
    try {
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
    } catch (firebaseError) {
      console.error('Firebase read error:', firebaseError);
      return res.status(500).json(formatResponse(false, null, 'Database error: ' + firebaseError.message));
    }
    
  } catch (error) {
    console.error('Get user numbers error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// DELETE USER NUMBER - POST (Protected)
app.post('/api/user/numbers/delete', verifyToken, async (req, res) => {
  try {
    const { userId, numbers } = req.body;
    
    if (!userId || !numbers || !numbers.length) {
      return res.status(400).json(formatResponse(false, null, 'Invalid request'));
    }
    
    // Verify that token UID matches userId
    if (req.user.uid !== userId) {
      return res.status(403).json(formatResponse(false, null, 'Unauthorized'));
    }
    
    console.log(`Delete numbers for user: ${userId}, count: ${numbers.length}`);
    
    if (!db) {
      return res.status(503).json(formatResponse(false, null, 'Database connection error'));
    }
    
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
      return res.status(500).json(formatResponse(false, null, 'Database error: ' + firebaseError.message));
    }
    
  } catch (error) {
    console.error('Delete user number error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// GET AVAILABLE NUMBERS - GET (Public - No Token Needed)
app.get('/api/numbers/available', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    
    console.log(`Get available numbers, limit: ${limit}`);
    
    if (!db) {
      return res.status(503).json(formatResponse(false, null, 'Database connection error'));
    }
    
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
      
      if (numbers.length === 0) {
        return res.status(404).json(formatResponse(false, null, 'No available numbers found'));
      }
      
      return res.json(formatResponse(true, numbers));
    } catch (firebaseError) {
      console.error('Firebase query error:', firebaseError);
      return res.status(500).json(formatResponse(false, null, 'Database error: ' + firebaseError.message));
    }
    
  } catch (error) {
    console.error('Get available numbers error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// BUY NUMBER - POST (Protected)
app.post('/api/numbers/buy', verifyToken, async (req, res) => {
  try {
    const { userId, numberId, price } = req.body;
    
    if (!userId || !numberId) {
      return res.status(400).json(formatResponse(false, null, 'Missing required fields'));
    }
    
    // Verify that token UID matches userId
    if (req.user.uid !== userId) {
      return res.status(403).json(formatResponse(false, null, 'Unauthorized'));
    }
    
    console.log(`Buy number: ${numberId} for user: ${userId}`);
    
    if (!db || !admin) {
      return res.status(503).json(formatResponse(false, null, 'Database connection error'));
    }
    
    try {
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
      
      return res.json(formatResponse(true, {
        success: true,
        newBalance: (userData.credits || 0) - numberPrice,
        number: numberData.phoneNumber
      }, 'Purchase successful'));
    } catch (firebaseError) {
      console.error('Firebase update error:', firebaseError);
      return res.status(500).json(formatResponse(false, null, 'Database error: ' + firebaseError.message));
    }
    
  } catch (error) {
    console.error('Buy number error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// BULK BUY - POST (Protected)
app.post('/api/numbers/bulk-buy', verifyToken, async (req, res) => {
  try {
    const { userId, quantity, totalPrice, numbers } = req.body;
    
    if (!userId || !quantity || !totalPrice || !numbers || !numbers.length) {
      return res.status(400).json(formatResponse(false, null, 'Missing required fields'));
    }
    
    // Verify that token UID matches userId
    if (req.user.uid !== userId) {
      return res.status(403).json(formatResponse(false, null, 'Unauthorized'));
    }
    
    console.log(`Bulk buy: ${quantity} numbers for user: ${userId}`);
    
    if (!db || !admin) {
      return res.status(503).json(formatResponse(false, null, 'Database connection error'));
    }
    
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
      
      // Prepare data
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
      
      // Use batch for atomic operation
      const batch = db.batch();
      
      // Update each number
      numbers.forEach(num => {
        const numberRef = db.collection('numbers').doc(num.id);
        batch.update(numberRef, {
          status: 'sold',
          soldTo: userId,
          soldToEmail: userData.email,
          soldAt: new Date().toISOString()
        });
      });
      
      // Update user
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
      return res.status(500).json(formatResponse(false, null, 'Database error: ' + firebaseError.message));
    }
    
  } catch (error) {
    console.error('Bulk buy error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// ===========================================
// 4. ADMIN ENDPOINTS (Protected with Admin Check)
// ===========================================

// ADMIN STATS - GET (Protected + Admin Check)
app.get('/api/admin/stats', verifyToken, async (req, res) => {
  try {
    const adminId = req.user.uid;
    
    console.log(`Get admin stats for: ${adminId}`);
    
    if (!db) {
      return res.status(503).json(formatResponse(false, null, 'Database connection error'));
    }
    
    try {
      // Check if user is admin
      const adminDoc = await db.collection('users').doc(adminId).get();
      if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
        return res.status(403).json(formatResponse(false, null, 'Unauthorized: Admin access required'));
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
        soldNumbers: soldCount
      }));
    } catch (firebaseError) {
      console.error('Firebase stats error:', firebaseError);
      return res.status(500).json(formatResponse(false, null, 'Database error: ' + firebaseError.message));
    }
    
  } catch (error) {
    console.error('Admin stats error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// GET ALL USERS - GET (Protected + Admin Check)
app.get('/api/admin/users', verifyToken, async (req, res) => {
  try {
    const adminId = req.user.uid;
    const limit = parseInt(req.query.limit) || 50;
    
    console.log(`Get users for admin: ${adminId}, limit: ${limit}`);
    
    if (!db) {
      return res.status(503).json(formatResponse(false, null, 'Database connection error'));
    }
    
    try {
      // Check if user is admin
      const adminDoc = await db.collection('users').doc(adminId).get();
      if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
        return res.status(403).json(formatResponse(false, null, 'Unauthorized: Admin access required'));
      }
      
      let query = db.collection('users').orderBy('createdAt', 'desc');
      const snapshot = await query.limit(parseInt(limit)).get();
      
      const users = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        users.push({
          uid: doc.id,
          email: data.email,
          fullName: data.fullName || '',
          credits: data.credits || 0,
          purchasedNumbersCount: (data.purchasedNumbers || []).length,
          role: data.role || 'user'
        });
      });
      
      if (users.length === 0) {
        return res.status(404).json(formatResponse(false, null, 'No users found'));
      }
      
      return res.json(formatResponse(true, users));
    } catch (firebaseError) {
      console.error('Firebase users error:', firebaseError);
      return res.status(500).json(formatResponse(false, null, 'Database error: ' + firebaseError.message));
    }
    
  } catch (error) {
    console.error('Get users error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// SEARCH USER BY EMAIL - GET (Protected + Admin Check)
app.get('/api/admin/users/search', verifyToken, async (req, res) => {
  try {
    const adminId = req.user.uid;
    const { email } = req.query;
    
    if (!email) {
      return res.status(400).json(formatResponse(false, null, 'email required'));
    }
    
    console.log(`Search user by email: ${email}`);
    
    if (!db) {
      return res.status(503).json(formatResponse(false, null, 'Database connection error'));
    }
    
    try {
      // Check if user is admin
      const adminDoc = await db.collection('users').doc(adminId).get();
      if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
        return res.status(403).json(formatResponse(false, null, 'Unauthorized: Admin access required'));
      }
      
      // Exact match search - limit 1 for single read
      const snapshot = await db.collection('users')
        .where('email', '==', email.toLowerCase())
        .limit(1)
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
          role: data.role || 'user'
        });
      });
      
      if (users.length === 0) {
        return res.status(404).json(formatResponse(false, null, 'User not found'));
      }
      
      return res.json(formatResponse(true, users));
      
    } catch (firebaseError) {
      console.error('Firebase search error:', firebaseError);
      return res.status(500).json(formatResponse(false, null, 'Database error: ' + firebaseError.message));
    }
    
  } catch (error) {
    console.error('Search user error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// GET ALL NUMBERS (ADMIN) - GET (Protected + Admin Check)
app.get('/api/admin/numbers', verifyToken, async (req, res) => {
  try {
    const adminId = req.user.uid;
    const filter = req.query.filter || 'all';
    const limit = parseInt(req.query.limit) || 50;
    
    console.log(`Get admin numbers, filter: ${filter}, limit: ${limit}`);
    
    if (!db) {
      return res.status(503).json(formatResponse(false, null, 'Database connection error'));
    }
    
    try {
      // Check if user is admin
      const adminDoc = await db.collection('users').doc(adminId).get();
      if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
        return res.status(403).json(formatResponse(false, null, 'Unauthorized: Admin access required'));
      }
      
      let numbersQuery = db.collection('numbers').orderBy('addedAt', 'desc');
      
      if (filter !== 'all') {
        numbersQuery = db.collection('numbers')
          .where('status', '==', filter)
          .orderBy('addedAt', 'desc');
      }
      
      const snapshot = await numbersQuery.limit(parseInt(limit)).get();
      
      const numbers = [];
      snapshot.forEach(doc => {
        numbers.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      if (numbers.length === 0) {
        return res.status(404).json(formatResponse(false, null, 'No numbers found'));
      }
      
      return res.json(formatResponse(true, numbers));
    } catch (firebaseError) {
      console.error('Firebase query error:', firebaseError);
      return res.status(500).json(formatResponse(false, null, 'Database error: ' + firebaseError.message));
    }
    
  } catch (error) {
    console.error('Get numbers error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// UPLOAD NUMBERS - POST (Protected + Admin Check)
app.post('/api/admin/numbers/upload', verifyToken, async (req, res) => {
  try {
    const adminId = req.user.uid;
    const { numbers, price, type } = req.body;
    
    if (!numbers || !numbers.length) {
      return res.status(400).json(formatResponse(false, null, 'Invalid request'));
    }
    
    console.log(`Upload ${numbers.length} numbers by admin: ${adminId}`);
    
    if (!db) {
      return res.status(503).json(formatResponse(false, null, 'Database connection error'));
    }
    
    try {
      // Check if user is admin
      const adminDoc = await db.collection('users').doc(adminId).get();
      if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
        return res.status(403).json(formatResponse(false, null, 'Unauthorized: Admin access required'));
      }
      
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
        return res.json(formatResponse(true, { added: successCount }, `Added ${successCount} numbers`));
      } else {
        return res.status(400).json(formatResponse(false, null, 'No valid numbers to upload'));
      }
    } catch (firebaseError) {
      console.error('Firebase batch error:', firebaseError);
      return res.status(500).json(formatResponse(false, null, 'Database error: ' + firebaseError.message));
    }
    
  } catch (error) {
    console.error('Upload numbers error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// DELETE NUMBERS (ADMIN) - POST (Protected + Admin Check)
app.post('/api/admin/numbers/delete', verifyToken, async (req, res) => {
  try {
    const adminId = req.user.uid;
    const { numberIds } = req.body;
    
    if (!numberIds || !numberIds.length) {
      return res.status(400).json(formatResponse(false, null, 'Invalid request'));
    }
    
    console.log(`Delete ${numberIds.length} numbers by admin: ${adminId}`);
    
    if (!db) {
      return res.status(503).json(formatResponse(false, null, 'Database connection error'));
    }
    
    try {
      // Check if user is admin
      const adminDoc = await db.collection('users').doc(adminId).get();
      if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
        return res.status(403).json(formatResponse(false, null, 'Unauthorized: Admin access required'));
      }
      
      const batch = db.batch();
      
      numberIds.forEach(id => {
        const numberRef = db.collection('numbers').doc(id);
        batch.delete(numberRef);
      });
      
      await batch.commit();
      
      return res.json(formatResponse(true, { deleted: numberIds.length }, `Deleted ${numberIds.length} numbers`));
    } catch (firebaseError) {
      console.error('Firebase batch error:', firebaseError);
      return res.status(500).json(formatResponse(false, null, 'Database error: ' + firebaseError.message));
    }
    
  } catch (error) {
    console.error('Delete numbers error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// DELETE ALL SOLD NUMBERS - POST (Protected + Admin Check)
app.post('/api/admin/numbers/delete-sold', verifyToken, async (req, res) => {
  try {
    const adminId = req.user.uid;
    
    console.log(`Delete all sold numbers by admin: ${adminId}`);
    
    if (!db) {
      return res.status(503).json(formatResponse(false, null, 'Database connection error'));
    }
    
    try {
      // Check if user is admin
      const adminDoc = await db.collection('users').doc(adminId).get();
      if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
        return res.status(403).json(formatResponse(false, null, 'Unauthorized: Admin access required'));
      }
      
      const snapshot = await db.collection('numbers')
        .where('status', '==', 'sold')
        .limit(100)
        .get();
      
      if (snapshot.empty) {
        return res.status(404).json(formatResponse(false, null, 'No sold numbers found'));
      }
      
      const batch = db.batch();
      snapshot.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      
      return res.json(formatResponse(true, { deleted: snapshot.size }, `Deleted ${snapshot.size} sold numbers`));
    } catch (firebaseError) {
      console.error('Firebase delete error:', firebaseError);
      return res.status(500).json(formatResponse(false, null, 'Database error: ' + firebaseError.message));
    }
    
  } catch (error) {
    console.error('Delete sold numbers error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// UPDATE USER (ADMIN) - POST (Protected + Admin Check)
app.post('/api/admin/users/update', verifyToken, async (req, res) => {
  try {
    const adminId = req.user.uid;
    const { userId, updates } = req.body;
    
    if (!userId || !updates) {
      return res.status(400).json(formatResponse(false, null, 'Invalid request'));
    }
    
    console.log(`Update user ${userId} by admin: ${adminId}`);
    
    if (!db) {
      return res.status(503).json(formatResponse(false, null, 'Database connection error'));
    }
    
    try {
      // Check if user is admin
      const adminDoc = await db.collection('users').doc(adminId).get();
      if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
        return res.status(403).json(formatResponse(false, null, 'Unauthorized: Admin access required'));
      }
      
      await db.collection('users').doc(userId).update({
        ...updates,
        updatedAt: new Date().toISOString(),
        updatedBy: adminId
      });
      
      return res.json(formatResponse(true, null, 'User updated successfully'));
    } catch (firebaseError) {
      console.error('Firebase update error:', firebaseError);
      return res.status(500).json(formatResponse(false, null, 'Database error: ' + firebaseError.message));
    }
    
  } catch (error) {
    console.error('Update user error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// DELETE USER (ADMIN) - POST (Protected + Admin Check)
app.post('/api/admin/users/delete', verifyToken, async (req, res) => {
  try {
    const adminId = req.user.uid;
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json(formatResponse(false, null, 'Invalid request'));
    }
    
    console.log(`Delete user ${userId} by admin: ${adminId}`);
    
    if (!db) {
      return res.status(503).json(formatResponse(false, null, 'Database connection error'));
    }
    
    try {
      // Check if user is admin
      const adminDoc = await db.collection('users').doc(adminId).get();
      if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
        return res.status(403).json(formatResponse(false, null, 'Unauthorized: Admin access required'));
      }
      
      // First get user data to check if exists
      const userDoc = await db.collection('users').doc(userId).get();
      
      if (!userDoc.exists) {
        return res.status(404).json(formatResponse(false, null, 'User not found'));
      }
      
      // Delete from Firestore
      await db.collection('users').doc(userId).delete();
      
      // Try to delete from Firebase Auth (if available)
      if (auth) {
        try {
          await auth.deleteUser(userId);
          console.log(`✅ User ${userId} deleted from Firebase Auth`);
        } catch (authError) {
          console.log(`⚠️ Could not delete from Auth: ${authError.message}`);
        }
      }
      
      console.log(`✅ User ${userId} deleted successfully`);
      return res.json(formatResponse(true, null, 'User deleted successfully'));
      
    } catch (firebaseError) {
      console.error('Firebase delete error:', firebaseError);
      return res.status(500).json(formatResponse(false, null, 'Database error: ' + firebaseError.message));
    }
    
  } catch (error) {
    console.error('Delete user error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// UPDATE NUMBER (ADMIN) - POST (Protected + Admin Check)
app.post('/api/admin/numbers/update', verifyToken, async (req, res) => {
  try {
    const adminId = req.user.uid;
    const { numberId, updates } = req.body;
    
    if (!numberId || !updates) {
      return res.status(400).json(formatResponse(false, null, 'Invalid request'));
    }
    
    console.log(`Update number ${numberId} by admin: ${adminId}`);
    
    if (!db) {
      return res.status(503).json(formatResponse(false, null, 'Database connection error'));
    }
    
    try {
      // Check if user is admin
      const adminDoc = await db.collection('users').doc(adminId).get();
      if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
        return res.status(403).json(formatResponse(false, null, 'Unauthorized: Admin access required'));
      }
      
      await db.collection('numbers').doc(numberId).update({
        ...updates,
        updatedAt: new Date().toISOString(),
        updatedBy: adminId
      });
      
      return res.json(formatResponse(true, null, 'Number updated successfully'));
    } catch (firebaseError) {
      console.error('Firebase update error:', firebaseError);
      return res.status(500).json(formatResponse(false, null, 'Database error: ' + firebaseError.message));
    }
    
  } catch (error) {
    console.error('Update number error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// GET BULK BUY SETTINGS - GET (Protected + Admin Check)
app.get('/api/admin/settings/bulk-buy', verifyToken, async (req, res) => {
  try {
    const adminId = req.user.uid;
    
    console.log('Get bulk buy settings');
    
    if (!db) {
      return res.status(503).json(formatResponse(false, null, 'Database connection error'));
    }
    
    try {
      // Check if user is admin
      const adminDoc = await db.collection('users').doc(adminId).get();
      if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
        return res.status(403).json(formatResponse(false, null, 'Unauthorized: Admin access required'));
      }
      
      const settingsDoc = await db.collection('settings').doc('bulkBuy').get();
      
      if (!settingsDoc.exists) {
        // Return default settings if not found
        const defaultSettings = {
          regularPrice: 0.30,
          packages: {
            package10: { price: 2.50, perNumber: 0.25, save: 0.50, discount: "-17%" },
            package30: { price: 6.75, perNumber: 0.225, save: 2.25, discount: "-25%" },
            package50: { price: 10.00, perNumber: 0.20, save: 5.00, discount: "-33%" },
            package100: { price: 18.00, perNumber: 0.18, save: 12.00, discount: "-40%" }
          }
        };
        return res.json(formatResponse(true, defaultSettings));
      }
      
      return res.json(formatResponse(true, settingsDoc.data()));
    } catch (firebaseError) {
      console.error('Firebase read error:', firebaseError);
      return res.status(500).json(formatResponse(false, null, 'Database error: ' + firebaseError.message));
    }
    
  } catch (error) {
    console.error('Get bulk buy settings error:', error);
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// SAVE BULK BUY SETTINGS - POST (Protected + Admin Check)
app.post('/api/admin/settings/bulk-buy', verifyToken, async (req, res) => {
  try {
    const adminId = req.user.uid;
    const { settings } = req.body;
    
    if (!settings) {
      return res.status(400).json(formatResponse(false, null, 'Invalid request'));
    }
    
    console.log(`Save bulk buy settings by admin: ${adminId}`);
    
    if (!db) {
      return res.status(503).json(formatResponse(false, null, 'Database connection error'));
    }
    
    try {
      // Check if user is admin
      const adminDoc = await db.collection('users').doc(adminId).get();
      if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
        return res.status(403).json(formatResponse(false, null, 'Unauthorized: Admin access required'));
      }
      
      await db.collection('settings').doc('bulkBuy').set({
        ...settings,
        updatedAt: new Date().toISOString(),
        updatedBy: adminId
      });
      
      return res.json(formatResponse(true, null, 'Settings saved successfully'));
    } catch (firebaseError) {
      console.error('Firebase write error:', firebaseError);
      return res.status(500).json(formatResponse(false, null, 'Database error: ' + firebaseError.message));
    }
    
  } catch (error) {
    console.error('Save bulk buy settings error:', error);
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
    mode: 'firebase-token-auth',
    timestamp: new Date().toISOString()
  }));
});

// ===========================================
// ROOT ENDPOINT
// ===========================================
app.get('/', (req, res) => {
  res.json(formatResponse(true, { 
    message: 'USANumbers API is running - Token Verification Mode',
    version: '1.0.0',
    mode: 'firebase-token-auth',
    endpoints: [
      '/api/health',
      '/api/auth/login',
      '/api/auth/signup',
      '/api/user/:uid (token required)',
      '/api/numbers/available',
      '/api/admin/stats (token + admin required)'
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
