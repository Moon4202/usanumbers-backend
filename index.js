const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const app = express();
app.use(cors());
app.use(express.json());

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'usanumbers-secret-key-2024';

// Firebase Admin Initialization
let db;
let firebaseInitialized = false;

try {
  console.log('🔧 Initializing Firebase Admin...');
  
  const serviceAccount = {
    type: "service_account",
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
  };
  
  console.log('📁 Firebase Project ID:', process.env.FIREBASE_PROJECT_ID);
  console.log('📧 Firebase Client Email:', process.env.FIREBASE_CLIENT_EMAIL);
  console.log('🔑 Private Key Available:', process.env.FIREBASE_PRIVATE_KEY ? 'Yes' : 'No');
  
  if (!process.env.FIREBASE_PRIVATE_KEY || !process.env.FIREBASE_CLIENT_EMAIL) {
    throw new Error('Firebase environment variables are missing');
  }
  
  initializeApp({
    credential: cert(serviceAccount)
  });
  
  db = getFirestore();
  firebaseInitialized = true;
  console.log('✅ Firebase Admin initialized successfully');
  
} catch (error) {
  console.error('❌ Firebase Admin initialization failed:', error.message);
  console.log('⚠️ Running in mock mode without Firebase');
  firebaseInitialized = false;
}

// ============== HELPER FUNCTIONS ==============

async function getUserByEmail(email) {
  if (!firebaseInitialized) {
    console.log('⚠️ Firebase not initialized, using mock data');
    
    // Mock users for testing
    const mockUsers = [
      {
        id: 'demo-user-1',
        email: 'demo@example.com',
        password: '$2a$10$N9qo8uLOickgx2ZMRZoMyeQFLHr8X7Q9jJgD8XrC6G5Yd7Y6Q2oW2', // "password123"
        fullName: 'Demo User',
        credits: 25.50,
        purchasedNumbers: [],
        role: 'user',
        createdAt: new Date().toISOString()
      },
      {
        id: 'admin-1',
        email: 'admin@example.com',
        password: '$2a$10$N9qo8uLOickgx2ZMRZoMyeQFLHr8X7Q9jJgD8XrC6G5Yd7Y6Q2oW2', // "password123"
        fullName: 'Administrator',
        credits: 1000,
        purchasedNumbers: [],
        role: 'admin',
        createdAt: new Date().toISOString()
      }
    ];
    
    const user = mockUsers.find(u => u.email.toLowerCase() === email.toLowerCase());
    return user || null;
  }
  
  try {
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('email', '==', email.toLowerCase()).get();
    
    if (snapshot.empty) {
      console.log('📭 User not found in Firebase:', email);
      return null;
    }
    
    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();
    
    console.log('✅ User found in Firebase:', email);
    return {
      id: userDoc.id,
      ...userData
    };
  } catch (error) {
    console.error('Error getting user by email:', error);
    return null;
  }
}

async function createUser(userData) {
  if (!firebaseInitialized) {
    console.log('⚠️ Firebase not initialized, creating mock user');
    return {
      id: 'mock-user-' + Date.now(),
      ...userData
    };
  }
  
  try {
    const usersRef = db.collection('users');
    const docRef = await usersRef.add({
      ...userData,
      email: userData.email.toLowerCase(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    
    console.log('✅ User created in Firebase:', userData.email);
    return {
      id: docRef.id,
      ...userData
    };
  } catch (error) {
    console.error('Error creating user:', error);
    throw error;
  }
}

async function verifyPassword(inputPassword, storedHash) {
  try {
    if (!storedHash) {
      console.log('⚠️ No password hash stored');
      return false;
    }
    
    // Check if it's a bcrypt hash
    if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$') || storedHash.startsWith('$2y$')) {
      const isValid = await bcrypt.compare(inputPassword, storedHash);
      console.log('🔐 Bcrypt password check:', isValid ? 'Valid' : 'Invalid');
      return isValid;
    } else {
      // Simple comparison for non-bcrypt hashes
      console.log('⚠️ Using simple password comparison');
      return inputPassword === storedHash;
    }
  } catch (error) {
    console.error('Password verification error:', error);
    return false;
  }
}

// ============== AUTHENTICATION ENDPOINTS ==============

// Login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    console.log('🔑 Login attempt for:', email);
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }
    
    // Get user from database
    let user = await getUserByEmail(email);
    
    if (!user) {
      console.log('❌ User not found:', email);
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
    
    console.log('📋 User found:', user.email, 'Role:', user.role);
    
    // Verify password
    const passwordValid = await verifyPassword(password, user.password);
    
    if (!passwordValid) {
      console.log('❌ Invalid password for user:', email);
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
    
    console.log('✅ Password verified for:', email);
    
    // Update last login if Firebase is available
    if (firebaseInitialized) {
      try {
        await db.collection('users').doc(user.id).update({
          lastLogin: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      } catch (updateError) {
        console.log('Note: Could not update last login', updateError.message);
      }
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email, 
        role: user.role || 'user',
        credits: user.credits || 0
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    console.log('✅ Login successful for:', email);
    console.log('🎫 Token generated, expires in 7 days');
    
    // Prepare user response (remove password)
    const { password: _, ...userWithoutPassword } = user;
    
    res.json({
      success: true,
      token: token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName || user.email.split('@')[0],
        credits: user.credits || 0,
        role: user.role || 'user',
        createdAt: user.createdAt
      },
      message: 'Login successful'
    });
    
  } catch (error) {
    console.error('🔥 Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error: ' + error.message
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
    
    // Verify JWT token
    jwt.verify(token, JWT_SECRET, async (err, decoded) => {
      if (err) {
        console.log('❌ Token verification failed:', err.message);
        return res.status(401).json({
          success: false,
          message: 'Invalid or expired token'
        });
      }
      
      console.log('✅ Token decoded:', decoded.email);
      
      // Get user data
      let userData;
      
      if (firebaseInitialized && db) {
        try {
          const userDoc = await db.collection('users').doc(decoded.userId).get();
          
          if (!userDoc.exists) {
            console.log('❌ User not found in Firebase:', decoded.userId);
            return res.status(404).json({
              success: false,
              message: 'User not found'
            });
          }
          
          userData = userDoc.data();
          console.log('✅ User data retrieved from Firebase');
          
        } catch (dbError) {
          console.error('Database error in token verification:', dbError);
          // Fallback to decoded token data
          userData = {
            email: decoded.email,
            fullName: decoded.email.split('@')[0],
            credits: decoded.credits || 0,
            role: decoded.role || 'user'
          };
        }
      } else {
        // Fallback to decoded token data
        console.log('⚠️ Using token data (Firebase not available)');
        userData = {
          email: decoded.email,
          fullName: decoded.email.split('@')[0],
          credits: decoded.credits || 0,
          role: decoded.role || 'user'
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
    
    console.log('📝 Registration attempt for:', email);
    
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
    
    // Check if user already exists
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists'
      });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user object
    const userData = {
      email: email.toLowerCase(),
      password: hashedPassword,
      fullName: fullName,
      credits: 0,
      purchasedNumbers: [],
      role: 'user',
      createdAt: new Date().toISOString(),
      lastLogin: null,
      updatedAt: new Date().toISOString()
    };
    
    // Save to database
    const user = await createUser(userData);
    
    // Generate token
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email, 
        role: user.role 
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    console.log('✅ New user registered:', email);
    
    res.json({
      success: true,
      token: token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        credits: user.credits,
        role: user.role
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

// ============== USER ENDPOINTS ==============

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
    
    // Get user data
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

// ============== NUMBERS ENDPOINTS ==============

// Get available numbers
app.get('/api/numbers', async (req, res) => {
  try {
    console.log('📞 Numbers request received');
    
    // Mock numbers (in production, get from Firebase)
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
    
    // Simulate purchase (in production, update Firebase)
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

// ============== ADMIN ENDPOINTS ==============

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
    
    // Get user from database
    const user = await getUserByEmail(email);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // Check if user is admin
    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin only.'
      });
    }
    
    // Verify password
    const passwordValid = await verifyPassword(password, user.password);
    
    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // Generate token
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email, 
        role: user.role,
        isAdmin: true
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    console.log('✅ Admin login successful for:', email);
    
    res.json({
      success: true,
      token: token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        credits: user.credits || 0
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

// ============== UTILITY ENDPOINTS ==============

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'USANumbers Backend is running',
    mode: firebaseInitialized ? 'Firebase + JWT Authentication' : 'Mock Mode',
    timestamp: new Date().toISOString(),
    firebase: firebaseInitialized ? 'Connected' : 'Not connected',
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
    version: '2.0.0',
    status: 'Active',
    mode: firebaseInitialized ? 'Production' : 'Development',
    firebase: firebaseInitialized ? 'Connected' : 'Not connected',
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

// ============== ERROR HANDLING ==============

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
  console.log(`🔐 JWT Secret: ${JWT_SECRET ? 'Configured' : 'Default'}`);
  console.log(`📊 Firebase: ${firebaseInitialized ? 'Connected ✓' : 'Not Connected ✗'}`);
  console.log(`⏰ Started: ${new Date().toLocaleString()}`);
  console.log(`=========================================`);
  console.log(`API Endpoints:`);
  console.log(`  http://localhost:${PORT}/api/health`);
  console.log(`  http://localhost:${PORT}/api/login`);
  console.log(`  http://localhost:${PORT}/api/numbers`);
  console.log(`=========================================`);
});
