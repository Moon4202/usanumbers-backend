const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

// ===========================================
// INITIALIZE FIREBASE ADMIN
// ===========================================
let firebaseApp;
try {
  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID || "usa-number-2554f",
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    }),
    databaseURL: "https://usa-number-2554f-default-rtdb.firebaseio.com"
  });
  console.log("✅ Firebase Admin initialized");
} catch (error) {
  console.error("❌ Firebase Admin error:", error);
}

const db = admin.firestore();
const auth = admin.auth();

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
// 1. AUTH ENDPOINTS (FIXED)
// ===========================================

// LOGIN - POST
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email) {
      return res.status(400).json(formatResponse(false, null, 'Email required'));
    }
    
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('email', '==', email).limit(1).get();
    
    if (snapshot.empty) {
      return res.status(401).json(formatResponse(false, null, 'User not found'));
    }
    
    const userData = snapshot.docs[0].data();
    return res.json(formatResponse(true, { 
      uid: snapshot.docs[0].id,
      email: userData.email,
      role: userData.role || 'user'
    }));
    
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
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// ===========================================
// 2. USER ENDPOINTS (WORKING)
// ===========================================

// GET USER DATA - GET
app.get('/api/user/:uid', async (req, res) => {
  try {
    const { uid } = req.params;
    
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
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// GET USER NUMBERS - GET
app.get('/api/user/:uid/numbers', async (req, res) => {
  try {
    const { uid } = req.params;
    
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
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// DELETE USER NUMBER - POST
app.post('/api/user/numbers/delete', async (req, res) => {
  try {
    const { userId, phoneNumber, numberData } = req.body;
    
    if (!userId || !phoneNumber) {
      return res.status(400).json(formatResponse(false, null, 'Invalid request'));
    }
    
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json(formatResponse(false, null, 'User not found'));
    }
    
    const userData = userDoc.data();
    
    const updatedPurchasedNumbers = (userData.purchasedNumbers || [])
      .filter(num => num !== phoneNumber);
    
    let updatedPurchasedNumbersData = userData.purchasedNumbersData || [];
    updatedPurchasedNumbersData = updatedPurchasedNumbersData
      .filter(item => item.phoneNumber !== phoneNumber);
    
    await userRef.update({
      purchasedNumbers: updatedPurchasedNumbers,
      purchasedNumbersData: updatedPurchasedNumbersData
    });
    
    return res.json(formatResponse(true, null, 'Number deleted successfully'));
    
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
    return res.status(500).json(formatResponse(false, null, error.message));
  }
});

// BUY NUMBER - POST
app.post('/api/numbers/buy', async (req, res) => {
  try {
    const { userId, numberId, price } = req.body;
    
    if (!userId || !numberId) {
      return res.status(400).json(formatResponse(false, null, 'Missing required fields'));
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
    const { userId, quantity, totalPrice, packageType, numbers } = req.body;
    
    if (!userId || !quantity || !totalPrice || !numbers || !numbers.length) {
      return res.status(400).json(formatResponse(false, null, 'Missing required fields'));
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
        packageType: packageType || 'custom',
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
        packageType: packageType || 'custom',
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

// ADMIN STATS - GET with adminId query
app.get('/api/admin/stats', async (req, res) => {
  try {
    const { adminId } = req.query;
    
    if (!adminId) {
      return res.status(400).json(formatResponse(false, null, 'adminId required'));
    }
    
    const adminDoc = await db.collection('users').doc(adminId).get();
    if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
      return res.status(403).json(formatResponse(false, null, 'Unauthorized'));
    }
    
    const usersSnapshot = await db.collection('users').limit(1000).get();
    const numbersSnapshot = await db.collection('numbers').limit(1000).get();
    
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
        role: data.role || 'user'
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
    
    const adminDoc = await db.collection('users').doc(adminId).get();
    if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
      return res.status(403).json(formatResponse(false, null, 'Unauthorized'));
    }
    
    let query = db.collection('numbers').orderBy('addedAt', 'desc').limit(parseInt(limit));
    
    if (filter !== 'all') {
      query = db.collection('numbers')
        .where('status', '==', filter)
        .orderBy('addedAt', 'desc')
        .limit(parseInt(limit));
    }
    
    const snapshot = await query.get();
    
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
    
    if (adminId) {
      const adminDoc = await db.collection('users').doc(adminId).get();
      if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
        return res.status(403).json(formatResponse(false, null, 'Unauthorized'));
      }
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

// ===========================================
// HEALTH CHECK
// ===========================================
app.get('/api/health', (req, res) => {
  res.json(formatResponse(true, { 
    status: 'ok',
    firebase: !!firebaseApp,
    timestamp: new Date().toISOString()
  }));
});

// ===========================================
// 404 HANDLER FOR UNDEFINED ROUTES
// ===========================================
app.all('/api/*', (req, res) => {
  res.status(404).json(formatResponse(false, null, `Cannot ${req.method} ${req.path}`));
});

// ===========================================
// EXPORT FOR VERCEL
// ===========================================
module.exports = app;
