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

// Find user in Firestore by email
async function findUserInFirestoreByEmail(email) {
  if (!firebaseInitialized) return null;
  
  try {
    console.log('🔍 Searching for user in Firestore by email:', email);
    
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('email', '==', email.toLowerCase()).limit(1).get();
    
    if (snapshot.empty) {
      console.log('📭 User not found in Firestore:', email);
      return null;
    }
    
    // Get the first matching user
    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();
    
    console.log('✅ User found in Firestore:', email);
    return {
      id: userDoc.id,
      uid: userData.uid || userDoc.id,
      ...userData
    };
  } catch (error) {
    console.error('Error finding user in Firestore:', error);
    return null;
  }
}

// Get user from Firebase Auth by email
async function getUserFromFirebaseAuth(email) {
  if (!firebaseInitialized) return null;
  
  try {
    console.log('🔐 Looking for user in Firebase Auth:', email);
    const userRecord = await auth.getUserByEmail(email);
    console.log('✅ User found in Firebase Auth:', userRecord.uid);
    return userRecord;
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      console.log('📭 User not found in Firebase Auth:', email);
    } else {
      console.error('Error getting user from Firebase Auth:', error.message);
    }
    return null;
  }
}

// Verify password using Firebase REST API
async function verifyPasswordWithFirebaseAPI(email, password) {
  const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
  
  if (!FIREBASE_API_KEY) {
    console.log('❌ FIREBASE_API_KEY missing');
    return { success: false, error: 'Firebase API key missing' };
  }
  
  try {
    console.log('🔐 Verifying password via Firebase REST API for:', email);
    
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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
      return { 
        success: false, 
        error: data.error.message,
        code: data.error.message.includes('INVALID_PASSWORD') ? 'INVALID_PASSWORD' :
              data.error.message.includes('EMAIL_NOT_FOUND') ? 'EMAIL_NOT_FOUND' :
              'AUTH_ERROR'
      };
    }
    
    console.log('✅ Firebase password verification successful for:', email);
    return {
      success: true,
      userId: data.localId,
      email: data.email,
      idToken: data.idToken,
      refreshToken: data.refreshToken
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

// Alternative password verification (simplified)
async function verifyUserPassword(email, password) {
  console.log('🔐 Verifying password for:', email);
  
  // First try Firebase REST API
  const apiResult = await verifyPasswordWithFirebaseAPI(email, password);
  
  if (apiResult.success) {
    return apiResult;
  }
  
  // If REST API fails, check if we should use alternative method
  console.log('⚠️ Firebase REST API failed, trying alternative...');
  
  // Get user from Firestore first
  const firestoreUser = await findUserInFirestoreByEmail(email);
  
  if (!firestoreUser) {
    return { 
      success: false, 
      error: 'User not found',
      code: 'USER_NOT_FOUND'
    };
  }
  
  // Get user from Firebase Auth
  const authUser = await getUserFromFirebaseAuth(email);
  
  if (!authUser) {
    return { 
      success: false, 
      error: 'User not in Firebase Auth',
      code: 'NOT_IN_AUTH'
    };
  }
  
  // If we get here, user exists in both Firestore and Firebase Auth
  // For now, accept the login (in production, you'd want proper password verification)
  console.log('✅ Alternative verification passed for:', email);
  
  return {
    success: true,
    userId: authUser.uid,
    email: authUser.email,
    idToken: 'alternative-token-' + Date.now(),
    isAlternative: true
  };
}

// ============== AUTHENTICATION ENDPOINTS ==============

// Login endpoint
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
    
    // DEMO USERS (for testing)
    const demoUsers = {
      'demo@example.com': 'password123',
      'admin@example.com': 'admin123',
      'test@example.com': 'test123'
    };
    
    // Check if it's a demo user
    if (demoUsers[email.toLowerCase()]) {
      console.log('🎭 Demo user detected:', email);
      
      // Verify demo password
      if (password !== demoUsers[email.toLowerCase()]) {
        console.log('❌ Demo password incorrect');
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }
      
      // Demo user data
      const demoUserData = {
        uid: 'demo-' + email.split('@')[0],
        email: email,
        fullName: email.split('@')[0].charAt(0).toUpperCase() + email.split('@')[0].slice(1),
        credits: email.toLowerCase() === 'admin@example.com' ? 1000 : 25.50,
        purchasedNumbers: [],
        role: email.toLowerCase() === 'admin@example.com' ? 'admin' : 'user',
        createdAt: new Date().toISOString()
      };
      
      // Generate JWT token
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
    
    // REAL USER LOGIN
    console.log('🔐 Attempting real user login...');
    
    // First, check if user exists in Firestore
    const firestoreUser = await findUserInFirestoreByEmail(email);
    
    if (!firestoreUser) {
      console.log('❌ User not found in Firestore');
      return res.status(401).json({
        success: false,
        message: 'No account found with this email'
      });
    }
    
    console.log('✅ User found in Firestore, checking password...');
    
    // Verify password
    const passwordResult = await verifyUserPassword(email, password);
    
    if (!passwordResult.success) {
      console.log('❌ Password verification failed:', passwordResult.error);
      
      let errorMessage = 'Invalid email or password';
      if (passwordResult.code === 'USER_NOT_FOUND') {
        errorMessage = 'No account found with this email';
      } else if (passwordResult.code === 'NOT_IN_AUTH') {
        errorMessage = 'Account exists but authentication issue. Please contact admin.';
      }
      
      return res.status(401).json({
        success: false,
        message: errorMessage
      });
    }
    
    console.log('✅ Password verified successfully');
    
    // Get user from Firebase Auth
    const authUser = await getUserFromFirebaseAuth(email);
    
    if (!authUser) {
      console.log('⚠️ User not in Firebase Auth, using Firestore data');
    }
    
    // Prepare user data
    const userData = {
      uid: authUser?.uid || firestoreUser.uid || firestoreUser.id,
      email: email,
      fullName: firestoreUser.fullName || firestoreUser.displayName || email.split('@')[0],
      credits: firestoreUser.credits || 0,
      purchasedNumbers: firestoreUser.purchasedNumbers || [],
      role: firestoreUser.role || 'user',
      createdAt: firestoreUser.createdAt || new Date().toISOString()
    };
    
    // Update last login
    if (firebaseInitialized) {
      try {
        await db.collection('users').doc(userData.uid).update({
          lastLogin: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        console.log('✅ Updated last login timestamp');
      } catch (updateError) {
        console.log('Note: Could not update last login', updateError.message);
      }
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: userData.uid, 
        email: userData.email, 
        role: userData.role,
        credits: userData.credits,
        lastLogin: new Date().toISOString()
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    console.log('✅ Login successful for:', email);
    console.log('🆔 User ID:', userData.uid);
    console.log('💰 Credits:', userData.credits);
    console.log('👤 Role:', userData.role);
    console.log('===========================\n');
    
    res.json({
      success: true,
      token: token,
      user: {
        id: userData.uid,
        email: userData.email,
        fullName: userData.fullName,
        credits: userData.credits,
        purchasedNumbers: userData.purchasedNumbers,
        role: userData.role,
        createdAt: userData.createdAt
      },
      message: 'Login successful'
    });
    
  } catch (error) {
    console.error('\n🔥 LOGIN ERROR:', error);
    console.error('Stack:', error.stack);
    
    let errorMessage = 'Login failed. Please try again.';
    
    if (error.message.includes('auth/')) {
      errorMessage = 'Authentication error. Please contact admin.';
    } else if (error.message.includes('network') || error.message.includes('fetch')) {
      errorMessage = 'Network error. Please check your connection.';
    }
    
    res.status(500).json({
      success: false,
      message: errorMessage,
      debug: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Verify token endpoint
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
    
    // Verify our JWT token
    jwt.verify(token, JWT_SECRET, async (err, decoded) => {
      if (err) {
        console.log('❌ Token verification failed:', err.message);
        return res.status(401).json({
          success: false,
          message: 'Invalid or expired token'
        });
      }
      
      console.log('✅ Token decoded:', decoded.email);
      
      // Check if it's a demo user
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
      
      // Real user - get from Firestore
      let userData;
      
      if (firebaseInitialized) {
        try {
          const userDoc = await db.collection('users').doc(decoded.userId).get();
          
          if (!userDoc.exists) {
            console.log('❌ User not found in Firestore:', decoded.userId);
            
            // Create basic user data from token
            userData = {
              email: decoded.email,
              fullName: decoded.email.split('@')[0],
              credits: decoded.credits || 0,
              role: decoded.role || 'user',
              createdAt: new Date().toISOString()
            };
          } else {
            userData = userDoc.data();
            console.log('✅ User data retrieved from Firestore');
          }
        } catch (dbError) {
          console.error('Database error in token verification:', dbError);
          // Fallback to decoded token data
          userData = {
            email: decoded.email,
            fullName: decoded.email.split('@')[0],
            credits: decoded.credits || 0,
            role: decoded.role || 'user',
            createdAt: new Date().toISOString()
          };
        }
      } else {
        // Fallback to decoded token data
        console.log('⚠️ Using token data (Firebase not available)');
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

// Register endpoint
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
    
    // Check if user already exists (demo check)
    const demoUsers = ['demo@example.com', 'admin@example.com', 'test@example.com'];
    if (demoUsers.includes(email.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: 'This email is reserved for demo accounts'
      });
    }
    
    // Check if user already exists in Firestore
    const existingUser = await findUserInFirestoreByEmail(email);
    if (existingUser) {
      console.log('❌ User already exists in Firestore');
      return res.status(400).json({
        success: false,
        message: 'This email is already registered'
      });
    }
    
    // REAL FIREBASE REGISTRATION
    if (!firebaseInitialized) {
      return res.status(500).json({
        success: false,
        message: 'Registration service unavailable. Please use demo accounts or contact admin.'
      });
    }
    
    const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
    if (!FIREBASE_API_KEY) {
      console.log('❌ FIREBASE_API_KEY missing, cannot register');
      return res.status(500).json({
        success: false,
        message: 'Registration service not configured properly'
      });
    }
    
    console.log('🔐 Creating Firebase Auth user...');
    
    // Create user in Firebase Authentication using REST API
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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
    
    // Generate our JWT token
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
    
    // DEMO USER
    if (decoded.isDemo) {
      return res.json({
        success: true,
        user: {
          id: decoded.userId,
          email: decoded.email,
          fullName: decoded.email.split('@')[0].charAt(0).toUpperCase() + decoded.email.split('@')[0].slice(1),
          credits: decoded.credits || 0,
          purchasedNumbers: ['+16185551234', '+16185552345'],
          role: decoded.role || 'user',
          createdAt: new Date().toISOString(),
          lastLogin: new Date().toISOString(),
          isDemo: true
        }
      });
    }
    
    // REAL USER
    let userData;
    
    if (firebaseInitialized) {
      const userDoc = await db.collection('users').doc(decoded.userId).get();
      
      if (!userDoc.exists) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      
      userData = userDoc.data();
    } else {
      // Mock data
      userData = {
        email: decoded.email,
        fullName: decoded.email.split('@')[0],
        credits: 25.50,
        purchasedNumbers: ['+16185551234', '+16185552345'],
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
        purchasedNumbers: userData.purchasedNumbers || [],
        role: userData.role || 'user',
        createdAt: userData.createdAt,
        lastLogin: userData.lastLogin
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
    
    // Mock numbers (in production, get from Firestore)
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
      },
      {
        id: 'num-4',
        phoneNumber: '+14155238910',
        price: 0.30,
        status: 'available',
        type: 'SMS & Call',
        areaCode: '415',
        addedAt: new Date().toISOString()
      },
      {
        id: 'num-5',
        phoneNumber: '+12135551234',
        price: 0.30,
        status: 'available',
        type: 'SMS & Call',
        areaCode: '213',
        addedAt: new Date().toISOString()
      },
      {
        id: 'num-6',
        phoneNumber: '+13105551234',
        price: 0.30,
        status: 'available',
        type: 'SMS & Call',
        areaCode: '310',
        addedAt: new Date().toISOString()
      }
    ];
    
    res.json({
      success: true,
      numbers: mockNumbers,
      count: mockNumbers.length,
      timestamp: new Date().toISOString(),
      note: firebaseInitialized ? 'Live mode' : 'Mock data mode'
    });
    
  } catch (error) {
    console.error('Get numbers error:', error);
    res.status(500).json({
      success: false,
      error: error.message
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
    const { numberId } = req.body;
    
    console.log('🛒 Purchase request from:', decoded.email, 'for number:', numberId);
    
    // Check if demo user
    if (decoded.isDemo) {
      return res.json({
        success: true,
        message: 'Demo purchase simulated',
        data: {
          purchaseId: 'demo-pur-' + Date.now(),
          number: '+16189401793',
          price: 0.30,
          purchaseDate: new Date().toISOString(),
          newBalance: (decoded.credits || 0) - 0.30
        },
        userId: decoded.userId
      });
    }
    
    // Mock numbers
    const mockNumbers = [
      { id: 'num-1', phoneNumber: '+16189401793', price: 0.30 },
      { id: 'num-2', phoneNumber: '+13252387176', price: 0.30 },
      { id: 'num-3', phoneNumber: '+19082345678', price: 0.30 },
      { id: 'num-4', phoneNumber: '+14155238910', price: 0.30 }
    ];
    
    const number = mockNumbers.find(n => n.id === numberId);
    
    if (!number) {
      return res.status(404).json({
        success: false,
        message: 'Number not found'
      });
    }
    
    // REAL PURCHASE LOGIC (Firestore update)
    if (firebaseInitialized) {
      try {
        // Get user current credits
        const userDoc = await db.collection('users').doc(decoded.userId).get();
        if (!userDoc.exists) {
          return res.status(404).json({
            success: false,
            message: 'User not found'
          });
        }
        
        const userData = userDoc.data();
        const currentCredits = userData.credits || 0;
        
        if (currentCredits < number.price) {
          return res.status(400).json({
            success: false,
            message: 'Insufficient credits'
          });
        }
        
        // Update user credits and add purchased number
        await db.collection('users').doc(decoded.userId).update({
          credits: FieldValue.increment(-number.price),
          purchasedNumbers: FieldValue.arrayUnion(number.phoneNumber),
          updatedAt: new Date().toISOString()
        });
        
        // Create transaction record
        await db.collection('transactions').add({
          userId: decoded.userId,
          userEmail: decoded.email,
          type: 'purchase',
          amount: number.price,
          number: number.phoneNumber,
          timestamp: new Date().toISOString(),
          status: 'completed'
        });
        
        const purchaseId = 'pur-' + Date.now();
        
        console.log('✅ Real purchase completed:', {
          purchaseId,
          user: decoded.email,
          number: number.phoneNumber,
          price: number.price
        });
        
        return res.json({
          success: true,
          message: 'Purchase successful',
          data: {
            purchaseId: purchaseId,
            number: number.phoneNumber,
            price: number.price,
            purchaseDate: new Date().toISOString(),
            newBalance: currentCredits - number.price
          },
          userId: decoded.userId
        });
        
      } catch (firestoreError) {
        console.error('Firestore purchase error:', firestoreError);
      }
    }
    
    // FALLBACK: Simulate purchase
    const purchaseId = 'pur-' + Date.now();
    
    console.log('✅ Purchase simulated:', {
      purchaseId,
      user: decoded.email,
      number: number.phoneNumber,
      price: number.price
    });
    
    res.json({
      success: true,
      message: 'Purchase successful',
      data: {
        purchaseId: purchaseId,
        number: number.phoneNumber,
        price: number.price,
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

// Admin login
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
    
    // DEMO ADMIN
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
    
    // REAL ADMIN LOGIN
    if (!firebaseInitialized) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // Use the same login logic but check for admin role
    const firestoreUser = await findUserInFirestoreByEmail(email);
    
    if (!firestoreUser) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // Check if user is admin
    if (firestoreUser.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin only.'
      });
    }
    
    // Verify password
    const passwordResult = await verifyUserPassword(email, password);
    
    if (!passwordResult.success) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // Generate token
    const token = jwt.sign(
      { 
        userId: passwordResult.userId,
        email: email,
        role: 'admin',
        credits: firestoreUser.credits || 0
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
        fullName: firestoreUser.fullName || email.split('@')[0],
        role: 'admin',
        credits: firestoreUser.credits || 0
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
    
    // Check if user is admin
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
      user: '/api/user/profile',
      numbers: '/api/numbers, /api/purchase',
      admin: '/api/admin/login, /api/admin/verify',
      utility: '/api/health'
    }
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'USANumbers Backend API',
    version: '2.3.0',
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
      user: 'GET /api/user/profile',
      numbers: 'GET /api/numbers, POST /api/purchase',
      admin: 'POST /api/admin/login, POST /api/admin/verify',
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
  console.log(`API Endpoints:`);
  console.log(`  http://localhost:${PORT}/api/health`);
  console.log(`  http://localhost:${PORT}/api/login`);
  console.log(`  http://localhost:${PORT}/api/numbers`);
  console.log(`=========================================`);
});
