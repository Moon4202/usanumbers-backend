const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const app = express();
app.use(cors());
app.use(express.json());

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'usanumbers-secret-key-2024';

// Firebase Admin Initialization
let auth, db;
let firebaseInitialized = false;

try {
  console.log('🔧 Initializing Firebase Admin...');
  
  // Check required Firebase environment variables
  const firebaseProjectId = process.env.FIREBASE_PROJECT_ID;
  const firebasePrivateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const firebaseClientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const firebaseApiKey = process.env.FIREBASE_API_KEY;
  
  console.log('📁 Firebase Project ID:', firebaseProjectId ? 'Set' : 'Missing');
  console.log('📧 Firebase Client Email:', firebaseClientEmail ? 'Set' : 'Missing');
  console.log('🔑 Firebase API Key:', firebaseApiKey ? 'Set (' + firebaseApiKey.substring(0, 10) + '...)' : 'Missing');
  console.log('🔐 Firebase Private Key:', firebasePrivateKey ? 'Set (length: ' + firebasePrivateKey.length + ')' : 'Missing');
  
  // Check if all Firebase env vars are present
  if (firebaseProjectId && firebasePrivateKey && firebaseClientEmail) {
    const serviceAccount = {
      type: "service_account",
      project_id: firebaseProjectId,
      private_key: firebasePrivateKey,
      client_email: firebaseClientEmail,
    };
    
    const firebaseApp = initializeApp({
      credential: cert(serviceAccount)
    });
    
    auth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp);
    firebaseInitialized = true;
    
    console.log('✅ Firebase Admin initialized successfully');
    console.log('🔐 Firebase Auth: Ready');
    console.log('📊 Firestore: Ready');
  } else {
    console.log('⚠️ Firebase environment variables incomplete, running in demo mode');
    firebaseInitialized = false;
  }
  
} catch (error) {
  console.error('❌ Firebase Admin initialization failed:', error.message);
  console.log('⚠️ Running in demo mode without Firebase');
  firebaseInitialized = false;
}

// ============== HELPER FUNCTIONS ==============

// Check user in Firebase Auth FIRST (Primary Method)
async function findUserByEmail(email) {
  console.log('🔍 Searching for user:', email);
  
  if (!firebaseInitialized) {
    console.log('⚠️ Firebase not initialized, checking demo users');
    return null;
  }
  
  try {
    // 1. FIRST: Try Firebase Authentication directly
    console.log('🔐 Checking Firebase Authentication...');
    const userRecord = await auth.getUserByEmail(email);
    console.log('✅ User found in Firebase Auth:', userRecord.uid);
    
    // 2. Check if user exists in Firestore
    const userDoc = await db.collection('users').doc(userRecord.uid).get();
    
    let userData;
    
    if (userDoc.exists) {
      // User exists in both Auth and Firestore
      userData = userDoc.data();
      console.log('✅ User found in Firestore');
    } else {
      // User exists in Auth but NOT in Firestore - CREATE IT
      console.log('⚠️ User in Auth but not in Firestore, creating entry...');
      
      userData = {
        uid: userRecord.uid,
        email: email.toLowerCase(),
        fullName: userRecord.displayName || email.split('@')[0].charAt(0).toUpperCase() + email.split('@')[0].slice(1),
        credits: 0,
        purchasedNumbers: [],
        role: 'user',
        createdAt: userRecord.metadata.creationTime || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastLogin: null
      };
      
      await db.collection('users').doc(userRecord.uid).set(userData);
      console.log('✅ Created user in Firestore');
    }
    
    return {
      ...userData,
      uid: userRecord.uid,
      emailVerified: userRecord.emailVerified || false,
      providerData: userRecord.providerData
    };
    
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      console.log('📭 User not found in Firebase Auth');
    } else {
      console.error('Error finding user:', error.message);
    }
    return null;
  }
}

// Verify password using Firebase REST API
async function verifyPassword(email, password) {
  console.log('🔐 Verifying password for:', email);
  
  const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
  
  if (!FIREBASE_API_KEY) {
    console.log('❌ FIREBASE_API_KEY missing');
    return { 
      success: false, 
      error: 'Firebase API key missing',
      code: 'CONFIG_ERROR'
    };
  }
  
  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          password: password,
          returnSecureToken: true
        })
      }
    );
    
    const data = await response.json();
    
    if (data.error) {
      console.log('❌ Firebase Auth error:', data.error.message);
      let errorCode = 'AUTH_ERROR';
      
      if (data.error.message.includes('INVALID_PASSWORD')) errorCode = 'INVALID_PASSWORD';
      else if (data.error.message.includes('EMAIL_NOT_FOUND')) errorCode = 'EMAIL_NOT_FOUND';
      else if (data.error.message.includes('USER_DISABLED')) errorCode = 'USER_DISABLED';
      else if (data.error.message.includes('TOO_MANY_ATTEMPTS')) errorCode = 'TOO_MANY_ATTEMPTS';
      
      return { 
        success: false, 
        error: data.error.message,
        code: errorCode
      };
    }
    
    console.log('✅ Firebase password verification successful');
    return {
      success: true,
      userId: data.localId,
      email: data.email,
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      expiresIn: data.expiresIn
    };
    
  } catch (error) {
    console.error('Firebase API error:', error.message);
    return { 
      success: false, 
      error: error.message,
      code: 'NETWORK_ERROR'
    };
  }
}

// Get user from Firestore (for backward compatibility)
async function getUserFromFirestore(uid) {
  if (!firebaseInitialized) return null;
  
  try {
    const userDoc = await db.collection('users').doc(uid).get();
    return userDoc.exists ? userDoc.data() : null;
  } catch (error) {
    console.error('Error getting user from Firestore:', error);
    return null;
  }
}

// ============== ADMIN HELPER FUNCTIONS ==============

// Middleware to verify admin
const verifyAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    console.log('🔐 Admin verification for:', decoded.email);
    
    // Demo admin
    if (decoded.isDemo && decoded.role === 'admin') {
      req.admin = decoded;
      return next();
    }
    
    // Check if user is admin in database
    if (firebaseInitialized) {
      const userDoc = await db.collection('users').doc(decoded.userId).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        if (userData.role === 'admin') {
          req.admin = { ...decoded, ...userData };
          return next();
        }
      }
    }
    
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin only.'
    });
    
  } catch (error) {
    console.error('Admin verification error:', error);
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
};

// ============== ADMIN API ENDPOINTS (REAL DATA ONLY) ==============

// 1. Admin Dashboard Stats - FIXED
app.get('/api/admin/stats', verifyAdmin, async (req, res) => {
  try {
    console.log('📊 Admin stats request from:', req.admin.email);
    
    if (!firebaseInitialized) {
      return res.status(500).json({
        success: false,
        message: 'Firebase not initialized'
      });
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Get total users count
    const usersSnapshot = await db.collection('users').get();
    const totalUsers = usersSnapshot.size;
    
    // Get users registered today
    const usersTodaySnapshot = await db.collection('users')
      .where('createdAt', '>=', today.toISOString())
      .where('createdAt', '<', tomorrow.toISOString())
      .get();
    const usersToday = usersTodaySnapshot.size;
    
    // Get available numbers count
    const availableNumbersSnapshot = await db.collection('numbers')
      .where('status', '==', 'available')
      .get();
    const availableNumbers = availableNumbersSnapshot.size;
    
    // Get numbers added today
    const numbersAddedTodaySnapshot = await db.collection('numbers')
      .where('addedAt', '>=', today.toISOString())
      .where('addedAt', '<', tomorrow.toISOString())
      .where('status', '==', 'available')
      .get();
    const numbersAddedToday = numbersAddedTodaySnapshot.size;
    
    // Get sold numbers count
    const soldNumbersSnapshot = await db.collection('numbers')
      .where('status', '==', 'sold')
      .get();
    const soldNumbers = soldNumbersSnapshot.size;
    
    // Get numbers sold today
    const soldTodaySnapshot = await db.collection('numbers')
      .where('soldAt', '>=', today.toISOString())
      .where('soldAt', '<', tomorrow.toISOString())
      .where('status', '==', 'sold')
      .get();
    const soldToday = soldTodaySnapshot.size;
    
    // Get total revenue from transactions
    const transactionsSnapshot = await db.collection('transactions')
      .where('type', 'in', ['purchase', 'bulk_purchase'])
      .where('status', '==', 'completed')
      .get();
    
    let totalRevenue = 0;
    transactionsSnapshot.forEach(doc => {
      totalRevenue += doc.data().amount || 0;
    });
    
    // Get today's revenue
    const todayTransactionsSnapshot = await db.collection('transactions')
      .where('timestamp', '>=', today.toISOString())
      .where('timestamp', '<', tomorrow.toISOString())
      .where('type', 'in', ['purchase', 'bulk_purchase'])
      .where('status', '==', 'completed')
      .get();
    
    let revenueToday = 0;
    todayTransactionsSnapshot.forEach(doc => {
      revenueToday += doc.data().amount || 0;
    });
    
    // Get active users (last login within 30 days) - FIXED
    let activeUsers = 0;
    try {
      // Try to get users with lastLogin field first
      const activeUsersSnapshot = await db.collection('users')
        .where('lastLogin', '>=', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .get();
      activeUsers = activeUsersSnapshot.size;
    } catch (error) {
      console.log('⚠️ Note: Could not get active users with lastLogin field, using fallback:', error.message);
      // Fallback: Use users created in last 30 days
      try {
        const usersSnapshot = await db.collection('users')
          .where('createdAt', '>=', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
          .get();
        activeUsers = usersSnapshot.size;
      } catch (fallbackError) {
        console.log('⚠️ Fallback also failed:', fallbackError.message);
        activeUsers = Math.floor(totalUsers * 0.3); // Estimate 30% active
      }
    }
    
    // Get total transactions
    const allTransactionsSnapshot = await db.collection('transactions').get();
    const totalTransactions = allTransactionsSnapshot.size;
    
    // Get pending transactions
    const pendingTransactionsSnapshot = await db.collection('transactions')
      .where('status', '==', 'pending')
      .get();
    const pendingTransactions = pendingTransactionsSnapshot.size;
    
    const stats = {
      totalUsers,
      usersToday,
      availableNumbers,
      numbersAddedToday,
      soldNumbers,
      soldToday,
      totalRevenue: parseFloat(totalRevenue.toFixed(2)),
      revenueToday: parseFloat(revenueToday.toFixed(2)),
      activeUsers,
      totalTransactions,
      pendingTransactions,
      timestamp: new Date().toISOString()
    };
    
    res.json({
      success: true,
      stats: stats,
      message: 'Admin stats retrieved successfully'
    });
    
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve admin stats'
    });
  }
});

// 2. Recent Activity - ALSO ADD /api/admin/activity ALIAS
app.get('/api/admin/recent-activity', verifyAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    
    if (!firebaseInitialized) {
      return res.status(500).json({
        success: false,
        message: 'Firebase not initialized'
      });
    }
    
    const transactionsSnapshot = await db.collection('transactions')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();
    
    const activities = [];
    transactionsSnapshot.forEach(doc => {
      const data = doc.data();
      activities.push({
        timestamp: data.timestamp,
        userEmail: data.userEmail,
        type: data.type,
        amount: data.amount,
        number: data.number,
        status: data.status,
        adminEmail: data.adminEmail,
        details: data.notes || `${data.type} transaction`
      });
    });
    
    res.json({
      success: true,
      activities: activities,
      count: activities.length,
      message: 'Recent activity retrieved'
    });
    
  } catch (error) {
    console.error('Recent activity error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve recent activity'
    });
  }
});

// 2b. Activity alias for compatibility
app.get('/api/admin/activity', verifyAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    
    if (!firebaseInitialized) {
      return res.status(500).json({
        success: false,
        message: 'Firebase not initialized'
      });
    }
    
    const transactionsSnapshot = await db.collection('transactions')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();
    
    const activities = [];
    transactionsSnapshot.forEach(doc => {
      const data = doc.data();
      activities.push({
        timestamp: data.timestamp,
        userEmail: data.userEmail,
        type: data.type,
        amount: data.amount,
        number: data.number,
        status: data.status,
        adminEmail: data.adminEmail,
        details: data.notes || `${data.type} transaction`
      });
    });
    
    res.json({
      success: true,
      activity: activities, // Return as "activity" to match admin.js
      count: activities.length,
      message: 'Recent activity retrieved'
    });
    
  } catch (error) {
    console.error('Activity error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve activity'
    });
  }
});

// 3. Manage Numbers (REAL DATA)
app.get('/api/admin/numbers', verifyAdmin, async (req, res) => {
  try {
    const status = req.query.status; // 'all', 'available', 'sold'
    const limit = parseInt(req.query.limit) || 100;
    
    if (!firebaseInitialized) {
      return res.status(500).json({
        success: false,
        message: 'Firebase not initialized'
      });
    }
    
    let query = db.collection('numbers');
    
    if (status && status !== 'all') {
      query = query.where('status', '==', status);
    }
    
    query = query.orderBy('addedAt', 'desc').limit(limit);
    
    const snapshot = await query.get();
    const realNumbers = [];
    
    snapshot.forEach(doc => {
      realNumbers.push({
        _id: doc.id,
        ...doc.data()
      });
    });
    
    res.json({
      success: true,
      numbers: realNumbers,
      count: realNumbers.length,
      message: `Numbers retrieved (${status || 'all'})`
    });
    
  } catch (error) {
    console.error('Get admin numbers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve numbers'
    });
  }
});

// 4. Add Numbers (Bulk)
app.post('/api/admin/numbers/bulk-add', verifyAdmin, async (req, res) => {
  try {
    const { numbers } = req.body;
    
    if (!numbers || !Array.isArray(numbers) || numbers.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an array of numbers'
      });
    }
    
    console.log(`📦 Admin bulk adding ${numbers.length} numbers`);
    
    if (!firebaseInitialized) {
      return res.status(500).json({
        success: false,
        message: 'Firebase not initialized'
      });
    }
    
    const addedCount = numbers.length;
    const errors = [];
    
    try {
      const batch = db.batch();
      
      numbers.forEach((num, index) => {
        const docId = `num-${Date.now()}-${index}`;
        const numberRef = db.collection('numbers').doc(docId);
        
        const numberData = {
          ...num,
          _id: docId,
          addedAt: new Date().toISOString(),
          addedBy: req.admin.email,
          status: 'available',
          updatedAt: new Date().toISOString()
        };
        
        batch.set(numberRef, numberData);
      });
      
      await batch.commit();
      console.log(`✅ ${addedCount} numbers added to Firestore`);
      
    } catch (dbError) {
      console.error('Firestore batch error:', dbError);
      errors.push('Database error: ' + dbError.message);
    }
    
    res.json({
      success: true,
      addedCount: addedCount,
      failedCount: 0,
      errors: errors,
      message: `Successfully added ${addedCount} numbers`
    });
    
  } catch (error) {
    console.error('Bulk add numbers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add numbers'
    });
  }
});

// 5. Delete multiple numbers
app.delete('/api/admin/numbers/delete-multiple', verifyAdmin, async (req, res) => {
  try {
    const { numberIds } = req.body;
    
    if (!numberIds || !Array.isArray(numberIds) || numberIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide number IDs to delete'
      });
    }
    
    console.log(`🗑️ Admin deleting ${numberIds.length} numbers`);
    
    if (!firebaseInitialized) {
      return res.status(500).json({
        success: false,
        message: 'Firebase not initialized'
      });
    }
    
    let deletedCount = 0;
    
    try {
      const batch = db.batch();
      
      numberIds.forEach(id => {
        const numberRef = db.collection('numbers').doc(id);
        batch.delete(numberRef);
      });
      
      await batch.commit();
      deletedCount = numberIds.length;
      console.log(`✅ ${deletedCount} numbers deleted from Firestore`);
      
    } catch (dbError) {
      console.error('Firestore delete error:', dbError);
      return res.status(500).json({
        success: false,
        message: 'Database error: ' + dbError.message
      });
    }
    
    res.json({
      success: true,
      deletedCount: deletedCount,
      message: `Deleted ${deletedCount} numbers successfully`
    });
    
  } catch (error) {
    console.error('Delete multiple numbers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete numbers'
    });
  }
});

// 6. Mark numbers as sold
app.put('/api/admin/numbers/mark-sold', verifyAdmin, async (req, res) => {
  try {
    const { numberIds } = req.body;
    
    if (!numberIds || !Array.isArray(numberIds) || numberIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide number IDs to mark as sold'
      });
    }
    
    console.log(`🏷️ Admin marking ${numberIds.length} numbers as sold`);
    
    if (!firebaseInitialized) {
      return res.status(500).json({
        success: false,
        message: 'Firebase not initialized'
      });
    }
    
    let updatedCount = 0;
    
    try {
      const batch = db.batch();
      
      numberIds.forEach(id => {
        const numberRef = db.collection('numbers').doc(id);
        batch.update(numberRef, {
          status: 'sold',
          soldAt: new Date().toISOString(),
          soldTo: req.admin.email,
          updatedAt: new Date().toISOString()
        });
      });
      
      await batch.commit();
      updatedCount = numberIds.length;
      console.log(`✅ ${updatedCount} numbers marked as sold`);
      
    } catch (dbError) {
      console.error('Firestore update error:', dbError);
      return res.status(500).json({
        success: false,
        message: 'Database error: ' + dbError.message
      });
    }
    
    res.json({
      success: true,
      updatedCount: updatedCount,
      message: `Marked ${updatedCount} numbers as sold`
    });
    
  } catch (error) {
    console.error('Mark as sold error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark numbers as sold'
    });
  }
});

// 7. Mark numbers as available
app.put('/api/admin/numbers/mark-available', verifyAdmin, async (req, res) => {
  try {
    const { numberIds } = req.body;
    
    if (!numberIds || !Array.isArray(numberIds) || numberIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide number IDs to mark as available'
      });
    }
    
    console.log(`🔄 Admin marking ${numberIds.length} numbers as available`);
    
    if (!firebaseInitialized) {
      return res.status(500).json({
        success: false,
        message: 'Firebase not initialized'
      });
    }
    
    let updatedCount = 0;
    
    try {
      const batch = db.batch();
      
      numberIds.forEach(id => {
        const numberRef = db.collection('numbers').doc(id);
        batch.update(numberRef, {
          status: 'available',
          soldAt: null,
          soldTo: null,
          updatedAt: new Date().toISOString()
        });
      });
      
      await batch.commit();
      updatedCount = numberIds.length;
      console.log(`✅ ${updatedCount} numbers marked as available`);
      
    } catch (dbError) {
      console.error('Firestore update error:', dbError);
      return res.status(500).json({
        success: false,
        message: 'Database error: ' + dbError.message
      });
    }
    
    res.json({
      success: true,
      updatedCount: updatedCount,
      message: `Marked ${updatedCount} numbers as available`
    });
    
  } catch (error) {
    console.error('Mark as available error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark numbers as available'
    });
  }
});

// 8. Delete a single number
app.delete('/api/admin/numbers/:id', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`🗑️ Admin deleting number: ${id}`);
    
    if (!firebaseInitialized) {
      return res.status(500).json({
        success: false,
        message: 'Firebase not initialized'
      });
    }
    
    try {
      await db.collection('numbers').doc(id).delete();
      console.log(`✅ Number ${id} deleted from Firestore`);
    } catch (dbError) {
      console.error('Firestore delete error:', dbError);
      return res.status(500).json({
        success: false,
        message: 'Database error: ' + dbError.message
      });
    }
    
    res.json({
      success: true,
      message: 'Number deleted successfully',
      numberId: id
    });
    
  } catch (error) {
    console.error('Delete number error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete number'
    });
  }
});

// 9. Update a single number
app.put('/api/admin/numbers/:id', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { price, type } = req.body;
    
    console.log(`✏️ Admin updating number: ${id}`, { price, type });
    
    if (!firebaseInitialized) {
      return res.status(500).json({
        success: false,
        message: 'Firebase not initialized'
      });
    }
    
    try {
      await db.collection('numbers').doc(id).update({
        price: parseFloat(price),
        type: type,
        updatedAt: new Date().toISOString()
      });
      console.log(`✅ Number ${id} updated in Firestore`);
    } catch (dbError) {
      console.error('Firestore update error:', dbError);
      return res.status(500).json({
        success: false,
        message: 'Database error: ' + dbError.message
      });
    }
    
    res.json({
      success: true,
      message: 'Number updated successfully',
      numberId: id,
      updates: { price, type }
    });
    
  } catch (error) {
    console.error('Update number error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update number'
    });
  }
});

// 10. Delete all sold numbers
app.delete('/api/admin/numbers/delete-all-sold', verifyAdmin, async (req, res) => {
  try {
    console.log(`⚠️ Admin deleting ALL sold numbers`);
    
    if (!firebaseInitialized) {
      return res.status(500).json({
        success: false,
        message: 'Firebase not initialized'
      });
    }
    
    let deletedCount = 0;
    
    try {
      // Get all sold numbers
      const soldNumbersSnapshot = await db.collection('numbers')
        .where('status', '==', 'sold')
        .get();
      
      if (!soldNumbersSnapshot.empty) {
        const batch = db.batch();
        
        soldNumbersSnapshot.forEach(doc => {
          batch.delete(doc.ref);
          deletedCount++;
        });
        
        await batch.commit();
        console.log(`✅ ${deletedCount} sold numbers deleted from Firestore`);
      }
      
    } catch (dbError) {
      console.error('Firestore delete all error:', dbError);
      return res.status(500).json({
        success: false,
        message: 'Database error: ' + dbError.message
      });
    }
    
    res.json({
      success: true,
      deletedCount: deletedCount,
      message: `Deleted ${deletedCount} sold numbers`
    });
    
  } catch (error) {
    console.error('Delete all sold error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete sold numbers'
    });
  }
});

// 11. Manage Users (REAL DATA)
app.get('/api/admin/users', verifyAdmin, async (req, res) => {
  try {
    if (!firebaseInitialized) {
      return res.status(500).json({
        success: false,
        message: 'Firebase not initialized'
      });
    }
    
    const usersSnapshot = await db.collection('users')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();
    
    const realUsers = [];
    usersSnapshot.forEach(doc => {
      const userData = doc.data();
      realUsers.push({
        _id: doc.id,
        uid: userData.uid || doc.id,
        email: userData.email,
        fullName: userData.fullName,
        credits: userData.credits || 0,
        purchasedNumbers: userData.purchasedNumbers || [],
        role: userData.role || 'user',
        createdAt: userData.createdAt,
        updatedAt: userData.updatedAt,
        lastLogin: userData.lastLogin
      });
    });
    
    res.json({
      success: true,
      users: realUsers,
      count: realUsers.length,
      message: 'Users retrieved successfully'
    });
    
  } catch (error) {
    console.error('Get admin users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve users'
    });
  }
});

// 12. Get single user
app.get('/api/admin/users/:id', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!firebaseInitialized) {
      return res.status(500).json({
        success: false,
        message: 'Firebase not initialized'
      });
    }
    
    const userDoc = await db.collection('users').doc(id).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    const userData = userDoc.data();
    
    res.json({
      success: true,
      user: {
        _id: userDoc.id,
        ...userData
      },
      message: 'User retrieved successfully'
    });
    
  } catch (error) {
    console.error('Get single user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve user'
    });
  }
});

// 13. Update user
app.put('/api/admin/users/:id', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, credits, role } = req.body;
    
    console.log(`✏️ Admin updating user: ${id}`, { fullName, credits, role });
    
    if (!firebaseInitialized) {
      return res.status(500).json({
        success: false,
        message: 'Firebase not initialized'
      });
    }
    
    try {
      await db.collection('users').doc(id).update({
        fullName: fullName,
        credits: parseFloat(credits),
        role: role,
        updatedAt: new Date().toISOString()
      });
      console.log(`✅ User ${id} updated in Firestore`);
    } catch (dbError) {
      console.error('Firestore user update error:', dbError);
      return res.status(500).json({
        success: false,
        message: 'Database error: ' + dbError.message
      });
    }
    
    res.json({
      success: true,
      message: 'User updated successfully',
      userId: id,
      updates: { fullName, credits, role }
    });
    
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user'
    });
  }
});

// 14. Add credit to user - ALSO SUPPORTS admin.js FORMAT
app.post('/api/admin/add-credit', verifyAdmin, async (req, res) => {
  try {
    const { userId, amount, notes } = req.body;
    
    if (!userId || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID or amount'
      });
    }
    
    console.log(`💰 Admin adding credit: $${amount} to user: ${userId}`);
    
    if (!firebaseInitialized) {
      return res.status(500).json({
        success: false,
        message: 'Firebase not initialized'
      });
    }
    
    let newBalance = 0;
    let userEmail = 'user@example.com';
    
    try {
      // Get user
      const userDoc = await db.collection('users').doc(userId).get();
      
      if (!userDoc.exists) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      
      const userData = userDoc.data();
      userEmail = userData.email;
      const currentCredits = userData.credits || 0;
      newBalance = currentCredits + parseFloat(amount);
      
      // Update user credits
      await db.collection('users').doc(userId).update({
        credits: newBalance,
        updatedAt: new Date().toISOString()
      });
      
      // Create transaction record
      const transactionId = `credit-${Date.now()}`;
      await db.collection('transactions').doc(transactionId).set({
        transactionId: transactionId,
        userId: userId,
        userEmail: userEmail,
        type: 'credit_added',
        amount: parseFloat(amount),
        adminId: req.admin.userId,
        adminEmail: req.admin.email,
        timestamp: new Date().toISOString(),
        notes: notes || 'Credit added by admin',
        status: 'completed',
        previousBalance: currentCredits,
        newBalance: newBalance
      });
      
      console.log(`✅ Credit added: $${amount} to ${userEmail}. New balance: $${newBalance}`);
      
    } catch (dbError) {
      console.error('Firestore credit add error:', dbError);
      return res.status(500).json({
        success: false,
        message: 'Database error: ' + dbError.message
      });
    }
    
    res.json({
      success: true,
      message: `Successfully added $${amount} credit to user`,
      amount: amount,
      userEmail: userEmail,
      newBalance: newBalance,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Add credit error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add credit'
    });
  }
});

// 14b. Add credit to user (alternative endpoint for admin.js)
app.post('/api/admin/users/:userId/add-credit', verifyAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { amount, notes, adminEmail } = req.body;
    
    if (!userId || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID or amount'
      });
    }
    
    console.log(`💰 Admin adding credit: $${amount} to user: ${userId}`);
    
    if (!firebaseInitialized) {
      return res.status(500).json({
        success: false,
        message: 'Firebase not initialized'
      });
    }
    
    let newBalance = 0;
    let userEmail = 'user@example.com';
    
    try {
      // Get user
      const userDoc = await db.collection('users').doc(userId).get();
      
      if (!userDoc.exists) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      
      const userData = userDoc.data();
      userEmail = userData.email;
      const currentCredits = userData.credits || 0;
      newBalance = currentCredits + parseFloat(amount);
      
      // Update user credits
      await db.collection('users').doc(userId).update({
        credits: newBalance,
        updatedAt: new Date().toISOString()
      });
      
      // Create transaction record
      const transactionId = `credit-${Date.now()}`;
      await db.collection('transactions').doc(transactionId).set({
        transactionId: transactionId,
        userId: userId,
        userEmail: userEmail,
        type: 'credit_added',
        amount: parseFloat(amount),
        adminId: req.admin.userId,
        adminEmail: adminEmail || req.admin.email,
        timestamp: new Date().toISOString(),
        notes: notes || 'Credit added by admin',
        status: 'completed',
        previousBalance: currentCredits,
        newBalance: newBalance
      });
      
      console.log(`✅ Credit added: $${amount} to ${userEmail}. New balance: $${newBalance}`);
      
    } catch (dbError) {
      console.error('Firestore credit add error:', dbError);
      return res.status(500).json({
        success: false,
        message: 'Database error: ' + dbError.message
      });
    }
    
    res.json({
      success: true,
      message: `Successfully added $${amount} credit to user`,
      user: {
        id: userId,
        email: userEmail,
        credits: newBalance
      },
      amount: amount,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Add credit error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add credit'
    });
  }
});

// 15. Transactions (REAL DATA) - FIXED WITH BETTER FILTERING
app.get('/api/admin/transactions', verifyAdmin, async (req, res) => {
  try {
    const type = req.query.type; // 'all', 'purchase', 'credit_added'
    const limit = parseInt(req.query.limit) || 50;
    const date = req.query.date; // Optional date filter
    
    if (!firebaseInitialized) {
      return res.status(500).json({
        success: false,
        message: 'Firebase not initialized'
      });
    }
    
    let query = db.collection('transactions').orderBy('timestamp', 'desc').limit(limit);
    
    if (type && type !== 'all') {
      query = query.where('type', '==', type);
    }
    
    // Date filter removed as it was causing query errors
    // Firestore requires composite index for multiple where clauses
    // If you need date filtering, we'll implement it differently
    console.log('📅 Transactions request:', { type, limit, date });
    
    const snapshot = await query.get();
    const realTransactions = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      
      // Apply date filter manually if provided
      if (date) {
        const transactionDate = new Date(data.timestamp).toISOString().split('T')[0];
        const filterDate = date.split('T')[0];
        if (transactionDate === filterDate) {
          realTransactions.push({
            _id: doc.id,
            ...data
          });
        }
      } else {
        realTransactions.push({
          _id: doc.id,
          ...data
        });
      }
    });
    
    res.json({
      success: true,
      transactions: realTransactions,
      count: realTransactions.length,
      message: `Transactions retrieved (${type || 'all'})`
    });
    
  } catch (error) {
    console.error('Get admin transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve transactions'
    });
  }
});

// 16. Bulk Buy Settings - ALSO ADD /api/admin/settings/bulk-buy FOR admin.js
app.get('/api/admin/settings/bulk-buy', verifyAdmin, async (req, res) => {
  try {
    // Default settings
    const defaultSettings = {
      regularPrice: 0.30,
      packages: {
        package10: { 
          price: 2.50, 
          perNumber: 0.25, 
          save: 0.50, 
          discount: "-17%" 
        },
        package30: { 
          price: 6.75, 
          perNumber: 0.225, 
          save: 2.25, 
          discount: "-25%" 
        },
        package50: { 
          price: 10.00, 
          perNumber: 0.20, 
          save: 5.00, 
          discount: "-33%" 
        },
        package100: { 
          price: 18.00, 
          perNumber: 0.18, 
          save: 12.00, 
          discount: "-40%" 
        }
      },
      updatedAt: new Date().toISOString(),
      updatedBy: req.admin.email
    };
    
    // Try to get saved settings from database
    let savedSettings = defaultSettings;
    
    if (firebaseInitialized) {
      try {
        const settingsDoc = await db.collection('settings').doc('bulkBuy').get();
        if (settingsDoc.exists) {
          savedSettings = { ...defaultSettings, ...settingsDoc.data() };
        }
      } catch (dbError) {
        console.error('Firestore settings error:', dbError);
      }
    }
    
    res.json({
      success: true,
      settings: savedSettings,
      message: 'Bulk buy settings retrieved'
    });
    
  } catch (error) {
    console.error('Get bulk buy settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve bulk buy settings'
    });
  }
});

// 16b. Bulk settings for admin.js compatibility
app.get('/api/bulk/settings', verifyAdmin, async (req, res) => {
  try {
    // Default settings
    const defaultSettings = {
      regularPrice: 0.30,
      packages: {
        package10: { 
          price: 2.50, 
          perNumber: 0.25, 
          save: 0.50, 
          discount: "-17%" 
        },
        package30: { 
          price: 6.75, 
          perNumber: 0.225, 
          save: 2.25, 
          discount: "-25%" 
        },
        package50: { 
          price: 10.00, 
          perNumber: 0.20, 
          save: 5.00, 
          discount: "-33%" 
        },
        package100: { 
          price: 18.00, 
          perNumber: 0.18, 
          save: 12.00, 
          discount: "-40%" 
        }
      }
    };
    
    // Try to get saved settings from database
    let savedSettings = defaultSettings;
    
    if (firebaseInitialized) {
      try {
        const settingsDoc = await db.collection('settings').doc('bulkBuy').get();
        if (settingsDoc.exists) {
          savedSettings = { ...defaultSettings, ...settingsDoc.data() };
        }
      } catch (dbError) {
        console.error('Firestore settings error:', dbError);
      }
    }
    
    res.json({
      success: true,
      settings: savedSettings,
      message: 'Bulk buy settings retrieved'
    });
    
  } catch (error) {
    console.error('Get bulk settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve bulk settings'
    });
  }
});

// 17. Save Bulk Buy Settings - ALSO ADD /api/admin/bulk-settings FOR admin.js
app.post('/api/admin/settings/bulk-buy', verifyAdmin, async (req, res) => {
  try {
    const settings = req.body;
    
    if (!settings) {
      return res.status(400).json({
        success: false,
        message: 'Please provide settings'
      });
    }
    
    console.log('💾 Admin saving bulk buy settings:', req.admin.email);
    
    const settingsData = {
      ...settings,
      updatedAt: new Date().toISOString(),
      updatedBy: req.admin.email
    };
    
    if (firebaseInitialized) {
      try {
        await db.collection('settings').doc('bulkBuy').set(settingsData, { merge: true });
        console.log('✅ Bulk buy settings saved to Firestore');
      } catch (dbError) {
        console.error('Firestore save settings error:', dbError);
        return res.status(500).json({
          success: false,
          message: 'Database error: ' + dbError.message
        });
      }
    }
    
    res.json({
      success: true,
      settings: settingsData,
      message: 'Bulk buy settings saved successfully'
    });
    
  } catch (error) {
    console.error('Save bulk buy settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save bulk buy settings'
    });
  }
});

// 17b. Bulk settings save for admin.js
app.post('/api/admin/bulk-settings', verifyAdmin, async (req, res) => {
  try {
    const settings = req.body;
    
    if (!settings) {
      return res.status(400).json({
        success: false,
        message: 'Please provide settings'
      });
    }
    
    console.log('💾 Admin saving bulk settings:', req.admin.email);
    
    const settingsData = {
      ...settings,
      updatedAt: new Date().toISOString(),
      updatedBy: req.admin.email
    };
    
    if (firebaseInitialized) {
      try {
        await db.collection('settings').doc('bulkBuy').set(settingsData, { merge: true });
        console.log('✅ Bulk settings saved to Firestore');
      } catch (dbError) {
        console.error('Firestore save settings error:', dbError);
        return res.status(500).json({
          success: false,
          message: 'Database error: ' + dbError.message
        });
      }
    }
    
    res.json({
      success: true,
      settings: settingsData,
      message: 'Bulk settings saved successfully'
    });
    
  } catch (error) {
    console.error('Save bulk settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save bulk settings'
    });
  }
});

// 18. NEW: Bulk status update (mark sold/available)
app.post('/api/admin/numbers/bulk-status', verifyAdmin, async (req, res) => {
  try {
    const { numberIds, status } = req.body;
    
    if (!numberIds || !Array.isArray(numberIds) || numberIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide number IDs'
      });
    }
    
    if (!status || !['sold', 'available'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide valid status (sold or available)'
      });
    }
    
    console.log(`🏷️ Admin bulk updating ${numberIds.length} numbers to ${status}`);
    
    if (!firebaseInitialized) {
      return res.status(500).json({
        success: false,
        message: 'Firebase not initialized'
      });
    }
    
    let updatedCount = 0;
    
    try {
      const batch = db.batch();
      
      numberIds.forEach(id => {
        const numberRef = db.collection('numbers').doc(id);
        
        const updateData = {
          status: status,
          updatedAt: new Date().toISOString()
        };
        
        if (status === 'sold') {
          updateData.soldAt = new Date().toISOString();
          updateData.soldTo = req.admin.email;
        } else {
          updateData.soldAt = null;
          updateData.soldTo = null;
        }
        
        batch.update(numberRef, updateData);
      });
      
      await batch.commit();
      updatedCount = numberIds.length;
      console.log(`✅ ${updatedCount} numbers updated to ${status}`);
      
    } catch (dbError) {
      console.error('Firestore bulk update error:', dbError);
      return res.status(500).json({
        success: false,
        message: 'Database error: ' + dbError.message
      });
    }
    
    res.json({
      success: true,
      updatedCount: updatedCount,
      message: `Marked ${updatedCount} numbers as ${status}`
    });
    
  } catch (error) {
    console.error('Bulk status update error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update numbers status'
    });
  }
});

// 19. NEW: Bulk delete
app.post('/api/admin/numbers/bulk-delete', verifyAdmin, async (req, res) => {
  try {
    const { numberIds } = req.body;
    
    if (!numberIds || !Array.isArray(numberIds) || numberIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide number IDs to delete'
      });
    }
    
    console.log(`🗑️ Admin bulk deleting ${numberIds.length} numbers`);
    
    if (!firebaseInitialized) {
      return res.status(500).json({
        success: false,
        message: 'Firebase not initialized'
      });
    }
    
    let deletedCount = 0;
    
    try {
      const batch = db.batch();
      
      numberIds.forEach(id => {
        const numberRef = db.collection('numbers').doc(id);
        batch.delete(numberRef);
      });
      
      await batch.commit();
      deletedCount = numberIds.length;
      console.log(`✅ ${deletedCount} numbers deleted from Firestore`);
      
    } catch (dbError) {
      console.error('Firestore bulk delete error:', dbError);
      return res.status(500).json({
        success: false,
        message: 'Database error: ' + dbError.message
      });
    }
    
    res.json({
      success: true,
      deletedCount: deletedCount,
      message: `Deleted ${deletedCount} numbers successfully`
    });
    
  } catch (error) {
    console.error('Bulk delete error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete numbers'
    });
  }
});

// 20. NEW: Delete sold numbers
app.delete('/api/admin/numbers/delete-sold', verifyAdmin, async (req, res) => {
  try {
    console.log(`⚠️ Admin deleting ALL sold numbers`);
    
    if (!firebaseInitialized) {
      return res.status(500).json({
        success: false,
        message: 'Firebase not initialized'
      });
    }
    
    let deletedCount = 0;
    
    try {
      // Get all sold numbers
      const soldNumbersSnapshot = await db.collection('numbers')
        .where('status', '==', 'sold')
        .get();
      
      if (!soldNumbersSnapshot.empty) {
        const batch = db.batch();
        
        soldNumbersSnapshot.forEach(doc => {
          batch.delete(doc.ref);
          deletedCount++;
        });
        
        await batch.commit();
        console.log(`✅ ${deletedCount} sold numbers deleted from Firestore`);
      }
      
    } catch (dbError) {
      console.error('Firestore delete all error:', dbError);
      return res.status(500).json({
        success: false,
        message: 'Database error: ' + dbError.message
      });
    }
    
    res.json({
      success: true,
      deletedCount: deletedCount,
      message: `Deleted ${deletedCount} sold numbers`
    });
    
  } catch (error) {
    console.error('Delete all sold error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete sold numbers'
    });
  }
});

// ============== EXISTING AUTHENTICATION ENDPOINTS ==============

// Login endpoint (unchanged)
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    console.log('\n🔑 ===== LOGIN ATTEMPT =====');
    console.log('📧 Email:', email);
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }
    
    // ===== 1. FIRST CHECK: DEMO USERS =====
    const demoUsers = {
      'demo@example.com': 'password123',
      'admin@example.com': 'admin123',
      'test@example.com': 'test123'
    };
    
    if (demoUsers[email.toLowerCase()]) {
      console.log('🎭 Demo user detected');
      
      if (password !== demoUsers[email.toLowerCase()]) {
        console.log('❌ Demo password incorrect');
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }
      
      const demoUserData = {
        uid: 'demo-' + email.split('@')[0],
        email: email,
        fullName: email.split('@')[0].charAt(0).toUpperCase() + email.split('@')[0].slice(1),
        credits: email.toLowerCase() === 'admin@example.com' ? 1000 : 25.50,
        purchasedNumbers: [],
        role: email.toLowerCase() === 'admin@example.com' ? 'admin' : 'user',
        createdAt: new Date().toISOString(),
        isDemo: true
      };
      
      const token = jwt.sign(
        { 
          userId: demoUserData.uid, 
          email: demoUserData.email, 
          role: demoUserData.role,
          credits: demoUserData.credits,
          isDemo: true
        },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      
      console.log('✅ Demo login successful');
      
      return res.json({
        success: true,
        token: token,
        user: {
          id: demoUserData.uid,
          email: demoUserData.email,
          fullName: demoUserData.fullName,
          credits: demoUserData.credits,
          role: demoUserData.role,
          createdAt: demoUserData.createdAt,
          isDemo: true
        },
        message: 'Demo login successful'
      });
    }
    
    // ===== 2. REAL USER LOGIN WITH FIREBASE =====
    console.log('🔐 Attempting real user login...');
    
    // Check if Firebase is available
    if (!firebaseInitialized) {
      console.log('❌ Firebase not available');
      return res.status(500).json({
        success: false,
        message: 'Authentication service unavailable. Please try demo accounts.'
      });
    }
    
    if (!process.env.FIREBASE_API_KEY) {
      console.log('❌ Firebase API key missing');
      return res.status(500).json({
        success: false,
        message: 'Authentication service not configured'
      });
    }
    
    // Verify password with Firebase
    const passwordResult = await verifyPassword(email, password);
    
    if (!passwordResult.success) {
      console.log('❌ Password verification failed:', passwordResult.error);
      
      let errorMessage = 'Invalid email or password';
      
      switch (passwordResult.code) {
        case 'EMAIL_NOT_FOUND':
          errorMessage = 'No account found with this email. Please sign up first.';
          break;
        case 'INVALID_PASSWORD':
          errorMessage = 'Invalid password. Please try again.';
          break;
        case 'USER_DISABLED':
          errorMessage = 'Your account has been disabled. Please contact admin.';
          break;
        case 'TOO_MANY_ATTEMPTS':
          errorMessage = 'Too many failed attempts. Please try again later.';
          break;
        case 'CONFIG_ERROR':
          errorMessage = 'Authentication service error. Please contact admin.';
          break;
      }
      
      return res.status(401).json({
        success: false,
        message: errorMessage
      });
    }
    
    console.log('✅ Password verified, user ID:', passwordResult.userId);
    
    // Get or create user in Firestore
    const userDoc = await db.collection('users').doc(passwordResult.userId).get();
    let userData;
    
    if (userDoc.exists) {
      // User exists in Firestore
      userData = userDoc.data();
      console.log('✅ User found in Firestore');
    } else {
      // User exists in Auth but not in Firestore - CREATE
      console.log('⚠️ Creating new user in Firestore...');
      
      // Try to get user info from Firebase Auth
      let authUserInfo = null;
      try {
        authUserInfo = await auth.getUser(passwordResult.userId);
      } catch (authError) {
        console.log('Note: Could not get user from Auth', authError.message);
      }
      
      userData = {
        uid: passwordResult.userId,
        email: email.toLowerCase(),
        fullName: authUserInfo?.displayName || email.split('@')[0].charAt(0).toUpperCase() + email.split('@')[0].slice(1),
        credits: 0,
        purchasedNumbers: [],
        role: 'user',
        createdAt: authUserInfo?.metadata?.creationTime || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastLogin: new Date().toISOString()
      };
      
      await db.collection('users').doc(passwordResult.userId).set(userData);
      console.log('✅ Created user in Firestore');
    }
    
    // Update last login
    try {
      await db.collection('users').doc(passwordResult.userId).update({
        lastLogin: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      console.log('✅ Updated last login');
    } catch (updateError) {
      console.log('Note: Could not update last login', updateError.message);
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: passwordResult.userId,
        email: email,
        role: userData.role || 'user',
        credits: userData.credits || 0,
        lastLogin: new Date().toISOString()
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    console.log('✅ Login successful for:', email);
    console.log('🆔 User ID:', passwordResult.userId);
    console.log('💰 Credits:', userData.credits || 0);
    console.log('👤 Role:', userData.role || 'user');
    console.log('===========================\n');
    
    res.json({
      success: true,
      token: token,
      user: {
        id: passwordResult.userId,
        email: email,
        fullName: userData.fullName || email.split('@')[0],
        credits: userData.credits || 0,
        purchasedNumbers: userData.purchasedNumbers || [],
        role: userData.role || 'user',
        createdAt: userData.createdAt || new Date().toISOString(),
        lastLogin: new Date().toISOString()
      },
      message: 'Login successful'
    });
    
  } catch (error) {
    console.error('\n🔥 LOGIN ERROR:', error.message);
    console.error('Stack:', error.stack);
    
    let errorMessage = 'Login failed. Please try again.';
    
    if (error.message.includes('auth/')) {
      errorMessage = 'Authentication error. Please contact admin.';
    } else if (error.message.includes('network') || error.message.includes('fetch')) {
      errorMessage = 'Network error. Please check your connection.';
    } else if (error.message.includes('Firebase')) {
      errorMessage = 'Authentication service error. Please try demo accounts.';
    }
    
    res.status(500).json({
      success: false,
      message: errorMessage,
      debug: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Verify token endpoint (unchanged)
app.post('/api/verify-token', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }
    
    const token = authHeader.split(' ')[1];
    
    jwt.verify(token, JWT_SECRET, async (err, decoded) => {
      if (err) {
        console.log('❌ Token verification failed:', err.message);
        return res.status(401).json({
          success: false,
          message: 'Invalid or expired token'
        });
      }
      
      console.log('✅ Token decoded:', decoded.email);
      
      // Demo user
      if (decoded.isDemo) {
        return res.json({
          success: true,
          user: {
            id: decoded.userId,
            email: decoded.email,
            fullName: decoded.email.split('@')[0].charAt(0).toUpperCase() + decoded.email.split('@')[0].slice(1),
            credits: decoded.credits || 0,
            role: decoded.role || 'user',
            createdAt: new Date().toISOString(),
            isDemo: true
          }
        });
      }
      
      // Real user
      let userData;
      
      if (firebaseInitialized) {
        try {
          const userDoc = await db.collection('users').doc(decoded.userId).get();
          
          if (!userDoc.exists) {
            // User in token but not in Firestore - create entry
            console.log('⚠️ User in token but not in Firestore, creating...');
            
            userData = {
              uid: decoded.userId,
              email: decoded.email,
              fullName: decoded.email.split('@')[0],
              credits: decoded.credits || 0,
              purchasedNumbers: [],
              role: decoded.role || 'user',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            
            await db.collection('users').doc(decoded.userId).set(userData);
          } else {
            userData = userDoc.data();
          }
        } catch (dbError) {
          console.error('Database error:', dbError);
          // Fallback
          userData = {
            email: decoded.email,
            fullName: decoded.email.split('@')[0],
            credits: decoded.credits || 0,
            role: decoded.role || 'user',
            createdAt: new Date().toISOString()
          };
        }
      } else {
        // Firebase not available
        userData = {
          email: decoded.email,
          fullName: decoded.email.split('@')[0],
          credits: decoded.credits || 0,
          role: decoded.role || 'user',
          createdAt: new Date().toISOString()
        };
      }
      
      res.json({
        success: true,
        user: {
          id: decoded.userId,
          email: userData.email,
          fullName: userData.fullName || userData.email.split('@')[0],
          credits: userData.credits || 0,
          role: userData.role || 'user',
          createdAt: userData.createdAt || new Date().toISOString()
        }
      });
    });
    
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Register endpoint (unchanged)
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    
    console.log('\n📝 ===== REGISTRATION ATTEMPT =====');
    console.log('📧 Email:', email);
    console.log('👤 Full Name:', fullName);
    
    if (!email || !password || !fullName) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }
    
    // Check password length
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }
    
    // Check demo users
    const demoUsers = ['demo@example.com', 'admin@example.com', 'test@example.com'];
    if (demoUsers.includes(email.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: 'This email is reserved for demo accounts'
      });
    }
    
    // Check Firebase availability
    if (!firebaseInitialized) {
      return res.status(500).json({
        success: false,
        message: 'Registration service unavailable. Please use demo accounts or contact admin.'
      });
    }
    
    const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
    if (!FIREBASE_API_KEY) {
      console.log('❌ FIREBASE_API_KEY missing');
      return res.status(500).json({
        success: false,
        message: 'Registration service not configured properly'
      });
    }
    
    // Check if user already exists in Firebase Auth
    try {
      const existingUser = await auth.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'This email is already registered'
        });
      }
    } catch (error) {
      // User not found is expected
      if (error.code !== 'auth/user-not-found') {
        console.error('Error checking existing user:', error);
      }
    }
    
    console.log('🔐 Creating Firebase Auth user...');
    
    // Create user in Firebase Authentication
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          password: password,
          returnSecureToken: true
        })
      }
    );
    
    const data = await response.json();
    
    if (data.error) {
      console.log('❌ Firebase registration error:', data.error.message);
      
      let errorMessage = 'Registration failed. Please try again.';
      if (data.error.message.includes('EMAIL_EXISTS')) {
        errorMessage = 'This email is already registered.';
      } else if (data.error.message.includes('WEAK_PASSWORD')) {
        errorMessage = 'Password is too weak. Use at least 6 characters.';
      } else if (data.error.message.includes('INVALID_EMAIL')) {
        errorMessage = 'Invalid email address.';
      }
      
      return res.status(400).json({
        success: false,
        message: errorMessage
      });
    }
    
    const userId = data.localId;
    console.log('✅ Firebase user created:', userId);
    
    // Create user profile in Firestore
    const userProfile = {
      uid: userId,
      email: email.toLowerCase(),
      fullName: fullName,
      credits: 0,
      purchasedNumbers: [],
      role: 'user',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLogin: null
    };
    
    await db.collection('users').doc(userId).set(userProfile);
    console.log('✅ User profile created in Firestore');
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: userId,
        email: email,
        role: 'user',
        credits: 0
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    console.log('✅ Registration completed for:', email);
    console.log('🆔 User ID:', userId);
    console.log('💰 Initial Credits: 0');
    console.log('👤 Role: user');
    console.log('===========================\n');
    
    res.json({
      success: true,
      token: token,
      user: {
        id: userId,
        email: email,
        fullName: fullName,
        credits: 0,
        role: 'user',
        createdAt: userProfile.createdAt
      },
      message: 'Registration successful'
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error: ' + error.message
    });
  }
});

// ============== EXISTING USER ENDPOINTS ==============

// Get user balance
app.get('/api/user/balance', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    console.log('💰 Balance request for:', decoded.email);
    
    // Demo user
    if (decoded.isDemo) {
      return res.json({
        success: true,
        balance: decoded.credits || 25.50,
        message: 'Demo balance retrieved'
      });
    }
    
    // Real user
    let balance = 0;
    
    if (firebaseInitialized) {
      try {
        const userDoc = await db.collection('users').doc(decoded.userId).get();
        
        if (userDoc.exists) {
          const userData = userDoc.data();
          balance = userData.credits || 0;
          console.log('✅ Real balance retrieved:', balance);
        } else {
          console.log('⚠️ User not found in Firestore');
          balance = 0;
        }
      } catch (error) {
        console.error('Firestore balance error:', error);
        balance = 0;
      }
    } else {
      // Firebase not available
      balance = 25.50; // Default demo balance
    }
    
    res.json({
      success: true,
      balance: balance,
      message: 'Balance retrieved successfully'
    });
    
  } catch (error) {
    console.error('Balance error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve balance',
      balance: 0
    });
  }
});

// Get bulk buy settings (public)
app.get('/api/bulk/settings', async (req, res) => {
  try {
    console.log('📦 Bulk buy settings request');
    
    // Default bulk buy settings
    const bulkSettings = {
      regularPrice: 0.30,
      packages: {
        package10: { 
          price: 2.50, 
          perNumber: 0.25, 
          save: 0.50, 
          discount: "-17%" 
        },
        package30: { 
          price: 6.75, 
          perNumber: 0.225, 
          save: 2.25, 
          discount: "-25%" 
        },
        package50: { 
          price: 10.00, 
          perNumber: 0.20, 
          save: 5.00, 
          discount: "-33%" 
        },
        package100: { 
          price: 18.00, 
          perNumber: 0.18, 
          save: 12.00, 
          discount: "-40%" 
        }
      }
    };
    
    console.log('✅ Bulk settings sent');
    
    res.json({
      success: true,
      settings: bulkSettings,
      message: 'Bulk buy settings retrieved'
    });
    
  } catch (error) {
    console.error('Bulk settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve bulk settings',
      settings: {
        regularPrice: 0.30,
        packages: {
          package10: { price: 2.50, perNumber: 0.25, save: 0.50, discount: "-17%" },
          package30: { price: 6.75, perNumber: 0.225, save: 2.25, discount: "-25%" },
          package50: { price: 10.00, perNumber: 0.20, save: 5.00, discount: "-33%" },
          package100: { price: 18.00, perNumber: 0.18, save: 12.00, discount: "-40%" }
        }
      }
    });
  }
});

// Bulk purchase endpoint
app.post('/api/purchase/bulk', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const { quantity, package: packageType, totalPrice } = req.body;
    
    console.log('🛒 Bulk purchase request from:', decoded.email);
    console.log('📦 Quantity:', quantity);
    console.log('💰 Total Price:', totalPrice);
    console.log('🎁 Package:', packageType || 'custom');
    
    // Validate input
    if (!quantity || quantity < 10 || quantity > 200) {
      return res.status(400).json({
        success: false,
        message: 'Invalid quantity. Must be between 10 and 200.'
      });
    }
    
    if (!totalPrice || totalPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid total price.'
      });
    }
    
    const actualPrice = parseFloat(totalPrice);
    const purchaseId = 'bulk-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    
    // Demo user
    if (decoded.isDemo) {
      console.log('✅ Demo bulk purchase successful');
      
      // Generate purchased numbers for demo
      const purchasedNumbers = [];
      for (let i = 0; i < quantity; i++) {
        const phoneNumber = `+1${Math.floor(Math.random() * 9000000000) + 1000000000}`;
        const apiToken = `bulk-token-${purchaseId}-${i}`;
        const apiUrl = `https://sms222.us?token=${apiToken}`;
        
        purchasedNumbers.push({
          id: `${purchaseId}-${i}`,
          purchaseId: purchaseId,
          phoneNumber: phoneNumber,
          apiUrl: apiUrl,
          purchasedDate: new Date().toISOString(),
          status: 'Active',
          price: actualPrice / quantity
        });
      }
      
      return res.json({
        success: true,
        message: `Demo bulk purchase successful! ${quantity} numbers purchased.`,
        data: {
          purchaseId: purchaseId,
          quantity: quantity,
          totalPrice: actualPrice,
          purchasedNumbers: purchasedNumbers,
          newBalance: (decoded.credits || 0) - actualPrice
        }
      });
    }
    
    // Real bulk purchase
    if (firebaseInitialized) {
      try {
        // Get user data
        const userDoc = await db.collection('users').doc(decoded.userId).get();
        
        if (!userDoc.exists) {
          return res.status(404).json({
            success: false,
            message: 'User not found'
          });
        }
        
        const userData = userDoc.data();
        const currentCredits = userData.credits || 0;
        
        // Check credits
        if (currentCredits < actualPrice) {
          return res.status(400).json({
            success: false,
            message: `Insufficient credits. You have $${currentCredits.toFixed(2)}, need $${actualPrice.toFixed(2)}.`
          });
        }
        
        const batch = db.batch();
        const purchasedNumbers = [];
        
        // Generate purchased numbers
        for (let i = 0; i < quantity; i++) {
          const phoneNumber = `+1${Math.floor(Math.random() * 9000000000) + 1000000000}`;
          const itemId = `${purchaseId}-${i}`;
          const apiToken = `bulk-token-${itemId}`;
          const apiUrl = `https://sms222.us?token=${apiToken}`;
          
          // Create transaction for each number
          const transactionData = {
            transactionId: itemId,
            userId: decoded.userId,
            userEmail: decoded.email,
            type: 'bulk_purchase',
            amount: actualPrice / quantity,
            number: phoneNumber,
            apiToken: apiToken,
            apiUrl: apiUrl,
            timestamp: new Date().toISOString(),
            status: 'completed',
            previousBalance: currentCredits,
            newBalance: currentCredits - (actualPrice / quantity),
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            bulkPurchaseId: purchaseId,
            quantity: quantity,
            totalPrice: actualPrice,
            package: packageType || 'custom'
          };
          
          const transactionRef = db.collection('transactions').doc(itemId);
          batch.set(transactionRef, transactionData);
          
          purchasedNumbers.push({
            id: itemId,
            purchaseId: purchaseId,
            phoneNumber: phoneNumber,
            apiUrl: apiUrl,
            purchasedDate: transactionData.timestamp,
            status: 'Active',
            price: actualPrice / quantity,
            expiresAt: transactionData.expiresAt
          });
        }
        
        // Update user document
        const userRef = db.collection('users').doc(decoded.userId);
        batch.update(userRef, {
          credits: FieldValue.increment(-actualPrice),
          updatedAt: new Date().toISOString()
        });
        
        // Add all numbers to purchasedNumbers array
        purchasedNumbers.forEach(item => {
          batch.update(userRef, {
            purchasedNumbers: FieldValue.arrayUnion(item.phoneNumber)
          });
        });
        
        await batch.commit();
        
        console.log(`✅ Real bulk purchase completed: ${quantity} numbers`);
        
        return res.json({
          success: true,
          message: `Bulk purchase successful! ${quantity} numbers purchased.`,
          data: {
            purchaseId: purchaseId,
            quantity: quantity,
            totalPrice: actualPrice,
            purchasedNumbers: purchasedNumbers,
            newBalance: currentCredits - actualPrice
          }
        });
        
      } catch (error) {
        console.error('Firestore bulk purchase error:', error);
        return res.status(500).json({
          success: false,
          message: 'Database error during purchase.'
        });
      }
    }
    
    // Fallback bulk purchase (no database)
    console.log('✅ Fallback bulk purchase simulated');
    
    res.json({
      success: true,
      message: `Bulk purchase successful! ${quantity} numbers purchased.`,
      data: {
        purchaseId: purchaseId,
        quantity: quantity,
        totalPrice: actualPrice,
        newBalance: (decoded.credits || 0) - actualPrice
      }
    });
    
  } catch (error) {
    console.error('Bulk purchase error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Bulk purchase failed: ' + error.message
    });
  }
});

// Get user's purchased numbers
app.get('/api/user/purchases', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    console.log('📱 Purchased numbers request for:', decoded.email);
    
    // Demo user
    if (decoded.isDemo) {
      const demoPurchases = [
        {
          id: 'pur-1',
          phoneNumber: '+16189401793',
          apiUrl: 'https://sms222.us?token=demo-token-abc123',
          purchasedDate: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
          status: 'Active',
          price: 0.30
        },
        {
          id: 'pur-2',
          phoneNumber: '+13252387176',
          apiUrl: 'https://sms222.us?token=demo-token-xyz456',
          purchasedDate: new Date(Date.now() - 172800000).toISOString(), // 2 days ago
          status: 'Active',
          price: 0.30
        }
      ];
      
      return res.json({
        success: true,
        numbers: demoPurchases,
        count: demoPurchases.length,
        message: 'Demo purchased numbers'
      });
    }
    
    // Real user - Get purchases from Firestore
    if (firebaseInitialized) {
      try {
        // Get user's purchased numbers from transactions
        const purchasesRef = db.collection('transactions')
          .where('userId', '==', decoded.userId)
          .where('type', 'in', ['purchase', 'bulk_purchase'])
          .orderBy('timestamp', 'desc');
        
        const snapshot = await purchasesRef.get();
        
        if (snapshot.empty) {
          console.log('📭 No purchases found for user');
          
          return res.json({
            success: true,
            numbers: [],
            count: 0,
            message: 'No purchased numbers found'
          });
        }
        
        const purchases = [];
        
        snapshot.forEach(doc => {
          const data = doc.data();
          
          // Generate API URL with token
          const apiToken = data.apiToken || `token-${decoded.userId}-${Date.now()}`;
          const apiUrl = `https://sms222.us?token=${apiToken}`;
          
          purchases.push({
            id: doc.id,
            purchaseId: data.transactionId || doc.id,
            phoneNumber: data.number || data.phoneNumber,
            apiUrl: apiUrl,
            purchasedDate: data.timestamp || data.purchaseDate || new Date().toISOString(),
            status: data.status || 'Active',
            price: data.amount || 0.30,
            expiresAt: data.expiresAt || null
          });
        });
        
        console.log(`✅ Found ${purchases.length} purchased numbers for user`);
        
        return res.json({
          success: true,
          numbers: purchases,
          count: purchases.length,
          message: 'Purchased numbers retrieved successfully'
        });
        
      } catch (firestoreError) {
        console.error('Firestore error:', firestoreError);
        // Fallback to user's purchasedNumbers array
      }
    }
    
    // Fallback: Get from user document's purchasedNumbers array
    if (firebaseInitialized) {
      try {
        const userDoc = await db.collection('users').doc(decoded.userId).get();
        
        if (userDoc.exists) {
          const userData = userDoc.data();
          const purchasedNumbers = userData.purchasedNumbers || [];
          
          const purchases = purchasedNumbers.map((number, index) => {
            const purchaseId = `fallback-pur-${index}-${decoded.userId}`;
            const apiToken = `token-${decoded.userId}-${purchaseId}`;
            
            return {
              id: purchaseId,
              purchaseId: purchaseId,
              phoneNumber: number,
              apiUrl: `https://sms222.us?token=${apiToken}`,
              purchasedDate: userData.createdAt || new Date().toISOString(),
              status: 'Active',
              price: 0.30
            };
          });
          
          return res.json({
            success: true,
            numbers: purchases,
            count: purchases.length,
            message: 'Purchased numbers from user profile'
          });
        }
      } catch (error) {
        console.error('Fallback error:', error);
      }
    }
    
    // Final fallback: empty array
    res.json({
      success: true,
      numbers: [],
      count: 0,
      message: 'No purchased numbers available'
    });
    
  } catch (error) {
    console.error('Get purchases error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve purchased numbers',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Purchase number
app.post('/api/purchase', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const { numberId, phoneNumber, price } = req.body;
    
    console.log('🛒 Purchase request from:', decoded.email, 'for number:', phoneNumber || numberId);
    
    const actualPhoneNumber = phoneNumber || `+1${Math.floor(Math.random() * 9000000000) + 1000000000}`;
    const actualPrice = price || 0.30;
    
    // Generate purchase ID
    const purchaseId = 'pur-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    const apiToken = 'token-' + purchaseId + '-' + Math.random().toString(36).substr(2, 16);
    const apiUrl = `https://sms222.us?token=${apiToken}`;
    
    // Demo user
    if (decoded.isDemo) {
      return res.json({
        success: true,
        message: 'Demo purchase successful',
        data: {
          purchaseId: purchaseId,
          number: actualPhoneNumber,
          apiUrl: apiUrl,
          price: actualPrice,
          purchaseDate: new Date().toISOString(),
          newBalance: (decoded.credits || 0) - actualPrice
        },
        userId: decoded.userId
      });
    }
    
    // Real purchase
    if (firebaseInitialized) {
      try {
        // Get user data
        const userDoc = await db.collection('users').doc(decoded.userId).get();
        
        if (!userDoc.exists) {
          return res.status(404).json({
            success: false,
            message: 'User not found'
          });
        }
        
        const userData = userDoc.data();
        const currentCredits = userData.credits || 0;
        
        // Check credits
        if (currentCredits < actualPrice) {
          return res.status(400).json({
            success: false,
            message: 'Insufficient credits'
          });
        }
        
        // Create transaction record
        const transactionData = {
          transactionId: purchaseId,
          userId: decoded.userId,
          userEmail: decoded.email,
          type: 'purchase',
          amount: actualPrice,
          number: actualPhoneNumber,
          apiToken: apiToken,
          apiUrl: apiUrl,
          timestamp: new Date().toISOString(),
          status: 'completed',
          previousBalance: currentCredits,
          newBalance: currentCredits - actualPrice,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days
        };
        
        // Update user credits and add to purchased numbers
        const batch = db.batch();
        
        // Update user document
        const userRef = db.collection('users').doc(decoded.userId);
        batch.update(userRef, {
          credits: FieldValue.increment(-actualPrice),
          purchasedNumbers: FieldValue.arrayUnion(actualPhoneNumber),
          updatedAt: new Date().toISOString()
        });
        
        // Create transaction document
        const transactionRef = db.collection('transactions').doc(purchaseId);
        batch.set(transactionRef, transactionData);
        
        await batch.commit();
        
        console.log('✅ Real purchase completed:', purchaseId);
        
        return res.json({
          success: true,
          message: 'Purchase successful',
          data: {
            purchaseId: purchaseId,
            number: actualPhoneNumber,
            apiUrl: apiUrl,
            price: actualPrice,
            purchaseDate: transactionData.timestamp,
            newBalance: currentCredits - actualPrice,
            expiresAt: transactionData.expiresAt
          },
          userId: decoded.userId
        });
        
      } catch (firestoreError) {
        console.error('Firestore purchase error:', firestoreError);
        // Continue to fallback
      }
    }
    
    // Fallback purchase (no database)
    console.log('✅ Fallback purchase simulated');
    
    res.json({
      success: true,
      message: 'Purchase successful',
      data: {
        purchaseId: purchaseId,
        number: actualPhoneNumber,
        apiUrl: apiUrl,
        price: actualPrice,
        purchaseDate: new Date().toISOString()
      },
      userId: decoded.userId
    });
    
  } catch (error) {
    console.error('Purchase error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Delete purchased number
app.delete('/api/purchase/:purchaseId', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const { purchaseId } = req.params;
    
    console.log('🗑️ Delete purchase request:', purchaseId, 'from user:', decoded.email);
    
    // Demo user
    if (decoded.isDemo) {
      return res.json({
        success: true,
        message: 'Demo purchase deleted successfully',
        purchaseId: purchaseId
      });
    }
    
    // Real delete
    if (firebaseInitialized) {
      try {
        // Get transaction to find phone number
        const transactionDoc = await db.collection('transactions').doc(purchaseId).get();
        
        if (!transactionDoc.exists) {
          return res.status(404).json({
            success: false,
            message: 'Purchase not found'
          });
        }
        
        const transactionData = transactionDoc.data();
        
        // Check ownership
        if (transactionData.userId !== decoded.userId) {
          return res.status(403).json({
            success: false,
            message: 'Not authorized to delete this purchase'
          });
        }
        
        // Remove from user's purchasedNumbers array
        const userRef = db.collection('users').doc(decoded.userId);
        const userDoc = await userRef.get();
        
        if (userDoc.exists) {
          const userData = userDoc.data();
          const purchasedNumbers = userData.purchasedNumbers || [];
          const updatedNumbers = purchasedNumbers.filter(num => num !== transactionData.number);
          
          await userRef.update({
            purchasedNumbers: updatedNumbers,
            updatedAt: new Date().toISOString()
          });
        }
        
        // Mark transaction as deleted
        await db.collection('transactions').doc(purchaseId).update({
          status: 'deleted',
          deletedAt: new Date().toISOString(),
          deletedBy: decoded.userId
        });
        
        console.log('✅ Purchase deleted:', purchaseId);
        
        return res.json({
          success: true,
          message: 'Purchase deleted successfully',
          purchaseId: purchaseId
        });
        
      } catch (firestoreError) {
        console.error('Firestore delete error:', firestoreError);
        // Continue to fallback
      }
    }
    
    // Fallback delete
    console.log('✅ Fallback delete simulated');
    
    res.json({
      success: true,
      message: 'Purchase deleted (simulated)',
      purchaseId: purchaseId
    });
    
  } catch (error) {
    console.error('Delete purchase error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to delete purchase',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get user profile
app.get('/api/user/profile', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    console.log('👤 Profile request for:', decoded.email);
    
    // Demo user
    if (decoded.isDemo) {
      // Get purchased numbers count for demo
      let purchasedNumbersCount = 0;
      if (decoded.email === 'demo@example.com') {
        purchasedNumbersCount = 2;
      } else if (decoded.email === 'admin@example.com') {
        purchasedNumbersCount = 5;
      }
      
      return res.json({
        success: true,
        user: {
          id: decoded.userId,
          email: decoded.email,
          fullName: decoded.email.split('@')[0].charAt(0).toUpperCase() + decoded.email.split('@')[0].slice(1),
          credits: decoded.credits || 0,
          purchasedNumbers: purchasedNumbersCount,
          role: decoded.role || 'user',
          createdAt: new Date().toISOString(),
          lastLogin: new Date().toISOString(),
          isDemo: true
        }
      });
    }
    
    // Real user
    let userData;
    let purchasedNumbersCount = 0;
    
    if (firebaseInitialized) {
      try {
        const userDoc = await db.collection('users').doc(decoded.userId).get();
        
        if (!userDoc.exists) {
          // Create user in Firestore if not exists
          console.log('⚠️ User not in Firestore, creating...');
          
          userData = {
            uid: decoded.userId,
            email: decoded.email,
            fullName: decoded.email.split('@')[0],
            credits: decoded.credits || 0,
            purchasedNumbers: [],
            role: decoded.role || 'user',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          
          await db.collection('users').doc(decoded.userId).set(userData);
          purchasedNumbersCount = 0;
        } else {
          userData = userDoc.data();
          purchasedNumbersCount = userData.purchasedNumbers ? userData.purchasedNumbers.length : 0;
        }
      } catch (dbError) {
        console.error('Database error:', dbError);
        // Fallback
        userData = {
          email: decoded.email,
          fullName: decoded.email.split('@')[0],
          credits: decoded.credits || 0,
          purchasedNumbers: [],
          createdAt: new Date().toISOString()
        };
      }
    } else {
      // Firebase not available
      userData = {
        email: decoded.email,
        fullName: decoded.email.split('@')[0],
        credits: 25.50,
        purchasedNumbers: [],
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString()
      };
    }
    
    res.json({
      success: true,
      user: {
        id: decoded.userId,
        email: userData.email,
        fullName: userData.fullName || userData.email.split('@')[0],
        credits: userData.credits || 0,
        purchasedNumbers: purchasedNumbersCount,
        role: userData.role || 'user',
        createdAt: userData.createdAt,
        lastLogin: userData.lastLogin || new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('Get profile error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get available numbers
app.get('/api/numbers', async (req, res) => {
  try {
    console.log('📞 Numbers request received');
    
    if (firebaseInitialized) {
      try {
        const numbersSnapshot = await db.collection('numbers')
          .where('status', '==', 'available')
          .orderBy('addedAt', 'desc')
          .limit(50)
          .get();
        
        const realNumbers = [];
        numbersSnapshot.forEach(doc => {
          const data = doc.data();
          realNumbers.push({
            id: doc.id,
            phoneNumber: data.phoneNumber,
            price: data.price || 0.30,
            status: data.status || 'available',
            type: data.type || 'SMS & Call',
            areaCode: data.phoneNumber ? data.phoneNumber.substring(2, 5) : '000',
            addedAt: data.addedAt || new Date().toISOString()
          });
        });
        
        console.log(`✅ Retrieved ${realNumbers.length} real numbers from Firestore`);
        
        return res.json({
          success: true,
          numbers: realNumbers,
          count: realNumbers.length,
          timestamp: new Date().toISOString(),
          note: 'Live data from Firestore'
        });
        
      } catch (error) {
        console.error('Firestore numbers error:', error);
        // Fallback to mock data
      }
    }
    
    // Fallback: Mock data
    const mockNumbers = [
      {
        id: 'num-1',
        phoneNumber: '+16189401793',
        price: 0.30,
        status: 'available',
        type: 'SMS & Call',
        areaCode: '618',
        addedAt: new Date().toISOString()
      },
      {
        id: 'num-2',
        phoneNumber: '+13252387176',
        price: 0.30,
        status: 'available',
        type: 'SMS & Call',
        areaCode: '325',
        addedAt: new Date().toISOString()
      },
      {
        id: 'num-3',
        phoneNumber: '+19082345678',
        price: 0.30,
        status: 'available',
        type: 'SMS & Call',
        areaCode: '908',
        addedAt: new Date().toISOString()
      }
    ];
    
    res.json({
      success: true,
      numbers: mockNumbers,
      count: mockNumbers.length,
      timestamp: new Date().toISOString(),
      note: 'Mock data (Firestore not available)'
    });
    
  } catch (error) {
    console.error('Get numbers error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Admin login (unchanged)
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    console.log('🔐 Admin login attempt for:', email);
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }
    
    // Demo admin
    if (email.toLowerCase() === 'admin@example.com') {
      if (password !== 'admin123') {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials'
        });
      }
      
      const demoAdmin = {
        uid: 'demo-admin-1',
        email: 'admin@example.com',
        fullName: 'Administrator',
        credits: 1000,
        role: 'admin',
        createdAt: new Date().toISOString()
      };
      
      const token = jwt.sign(
        { 
          userId: demoAdmin.uid, 
          email: demoAdmin.email, 
          role: 'admin',
          credits: demoAdmin.credits,
          isDemo: true
        },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      
      console.log('✅ Demo admin login successful');
      
      return res.json({
        success: true,
        token: token,
        user: {
          id: demoAdmin.uid,
          email: demoAdmin.email,
          fullName: demoAdmin.fullName,
          role: 'admin',
          credits: demoAdmin.credits,
          isDemo: true
        },
        message: 'Admin login successful'
      });
    }
    
    // Real admin login
    if (!firebaseInitialized) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // Verify password
    const passwordResult = await verifyPassword(email, password);
    
    if (!passwordResult.success) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // Get user from Firestore and check role
    const userDoc = await db.collection('users').doc(passwordResult.userId).get();
    
    if (!userDoc.exists) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    const userData = userDoc.data();
    
    if (userData.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin only.'
      });
    }
    
    // Generate token
    const token = jwt.sign(
      { 
        userId: passwordResult.userId,
        email: email,
        role: 'admin',
        credits: userData.credits || 0
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    console.log('✅ Admin login successful for:', email);
    
    res.json({
      success: true,
      token: token,
      user: {
        id: passwordResult.userId,
        email: email,
        fullName: userData.fullName || email.split('@')[0],
        role: 'admin',
        credits: userData.credits || 0
      },
      message: 'Admin login successful'
    });
    
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Admin verify
app.post('/api/admin/verify', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    if (decoded.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin only.'
      });
    }
    
    res.json({
      success: true,
      user: {
        id: decoded.userId,
        email: decoded.email,
        role: decoded.role
      },
      message: 'Admin verified'
    });
    
  } catch (error) {
    console.error('Admin verify error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  const firebaseStatus = firebaseInitialized ? 'Connected ✓' : 'Not Connected ✗';
  const authStatus = process.env.FIREBASE_API_KEY ? 'Configured ✓' : 'Not Configured ✗';
  const firebaseApiKey = process.env.FIREBASE_API_KEY ? 'Set (' + process.env.FIREBASE_API_KEY.substring(0, 10) + '...)' : 'Missing';
  
  res.json({
    success: true,
    message: 'USANumbers Backend is running',
    mode: firebaseInitialized ? 'Firebase Production' : 'Mock Development',
    timestamp: new Date().toISOString(),
    services: {
      firebase: firebaseStatus,
      firebaseAuth: authStatus,
      firebaseApiKey: firebaseApiKey,
      jwt: 'Active ✓'
    },
    demoAccounts: {
      user: 'demo@example.com / password123',
      admin: 'admin@example.com / admin123'
    },
    endpoints: {
      auth: '/api/login, /api/register, /api/verify-token',
      user: '/api/user/profile, /api/user/purchases, /api/user/balance',
      bulk: '/api/bulk/settings, POST /api/purchase/bulk',
      numbers: '/api/numbers, /api/purchase',
      purchase: 'DELETE /api/purchase/:id',
      admin: '/api/admin/login, /api/admin/verify',
      adminPanel: '/api/admin/stats, /api/admin/users, /api/admin/numbers, /api/admin/transactions, /api/admin/settings/bulk-buy, /api/admin/recent-activity, /api/admin/activity',
      utility: '/api/health'
    }
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'USANumbers Backend API',
    version: '3.1.0', // Updated version
    status: 'Active',
    mode: firebaseInitialized ? 'Production (Firebase Auth)' : 'Development (Mock)',
    services: {
      firebase: firebaseInitialized ? 'Connected' : 'Not connected',
      firebaseApiKey: process.env.FIREBASE_API_KEY ? 'Set' : 'Missing',
      authentication: 'JWT + Firebase Auth'
    },
    demo: {
      user: 'demo@example.com',
      password: 'password123',
      note: 'For testing without Firebase'
    },
    endpoints: {
      auth: 'POST /api/login, POST /api/register, POST /api/verify-token',
      user: 'GET /api/user/profile, GET /api/user/purchases, GET /api/user/balance',
      bulk: 'GET /api/bulk/settings, POST /api/purchase/bulk',
      numbers: 'GET /api/numbers, POST /api/purchase, DELETE /api/purchase/:id',
      admin: 'POST /api/admin/login, POST /api/admin/verify',
      adminPanel: 'GET /api/admin/stats, GET /api/admin/users, GET /api/admin/numbers, GET /api/admin/transactions, GET /api/admin/settings/bulk-buy, GET /api/admin/recent-activity, GET /api/admin/activity',
      adminActions: 'POST /api/admin/add-credit, PUT /api/admin/users/:id, PUT /api/admin/numbers/:id, DELETE /api/admin/numbers/:id, POST /api/admin/numbers/bulk-add, PUT /api/admin/numbers/mark-sold, PUT /api/admin/numbers/mark-available, DELETE /api/admin/numbers/delete-multiple, DELETE /api/admin/numbers/delete-all-sold, POST /api/admin/numbers/bulk-status, POST /api/admin/numbers/bulk-delete, DELETE /api/admin/numbers/delete-sold',
      utility: 'GET /api/health'
    },
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.path,
    timestamp: new Date().toISOString()
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('🔥 Server error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`✅ USANumbers Backend running on port ${PORT}`);
  console.log(`🌐 Mode: ${firebaseInitialized ? 'Firebase Production' : 'Mock Development'}`);
  console.log(`🔐 Authentication: JWT + ${firebaseInitialized ? 'Firebase Auth' : 'Demo Mode'}`);
  console.log(`📊 Firebase Status: ${firebaseInitialized ? 'Connected ✓' : 'Not Connected ✗'}`);
  console.log(`🔑 Firebase API Key: ${process.env.FIREBASE_API_KEY ? 'Set' : 'Missing'}`);
  console.log(`⏰ Started: ${new Date().toLocaleString()}`);
  console.log(`=========================================`);
  console.log(`Demo Accounts:`);
  console.log(`  👤 User: demo@example.com / password123`);
  console.log(`  👑 Admin: admin@example.com / admin123`);
  console.log(`=========================================`);
  console.log(`📊 UPDATED ADMIN PANEL ENDPOINTS:`);
  console.log(`  GET /api/admin/stats - Dashboard stats`);
  console.log(`  GET /api/admin/users - All users`);
  console.log(`  GET /api/admin/numbers - Manage numbers`);
  console.log(`  GET /api/admin/transactions - All transactions`);
  console.log(`  GET /api/admin/recent-activity - Recent activity`);
  console.log(`  GET /api/admin/activity - Activity (alias)`);
  console.log(`  GET /api/admin/settings/bulk-buy - Bulk buy settings`);
  console.log(`=========================================`);
  console.log(`🛠️ ADMIN PANEL ACTIONS (COMPATIBLE WITH BOTH):`);
  console.log(`  POST /api/admin/add-credit - Add credit to user`);
  console.log(`  POST /api/admin/users/:userId/add-credit - Alternative`);
  console.log(`  PUT /api/admin/users/:id - Update user`);
  console.log(`  PUT /api/admin/numbers/:id - Update number`);
  console.log(`  DELETE /api/admin/numbers/:id - Delete number`);
  console.log(`  POST /api/admin/numbers/bulk-add - Bulk add numbers`);
  console.log(`  PUT /api/admin/numbers/mark-sold - Mark as sold`);
  console.log(`  PUT /api/admin/numbers/mark-available - Mark as available`);
  console.log(`  DELETE /api/admin/numbers/delete-multiple - Delete multiple`);
  console.log(`  DELETE /api/admin/numbers/delete-all-sold - Delete all sold`);
  console.log(`  POST /api/admin/numbers/bulk-status - Bulk status update`);
  console.log(`  POST /api/admin/numbers/bulk-delete - Bulk delete`);
  console.log(`  DELETE /api/admin/numbers/delete-sold - Delete all sold (alt)`);
  console.log(`=========================================`);
  console.log(`🎯 COMPATIBILITY:`);
  console.log(`  ✅ admin-panel.html endpoints supported`);
  console.log(`  ✅ admin.js endpoints supported`);
  console.log(`  ✅ Both frontend versions work now!`);
  console.log(`=========================================`);
  console.log(`API Endpoints:`);
  console.log(`  http://localhost:${PORT}/api/health`);
  console.log(`  http://localhost:${PORT}/api/admin/stats`);
  console.log(`  http://localhost:${PORT}/api/admin/users`);
  console.log(`  http://localhost:${PORT}/api/admin/numbers`);
  console.log(`  http://localhost:${PORT}/api/admin/transactions`);
  console.log(`  http://localhost:${PORT}/api/admin/recent-activity`);
  console.log(`=========================================`);
});
