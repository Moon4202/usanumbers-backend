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
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: "private_key_id_placeholder",
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: "client_id_placeholder",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(process.env.FIREBASE_CLIENT_EMAIL)}`
};

try {
  initializeApp({
    credential: cert(serviceAccount)
  });
  console.log('✅ Firebase Admin initialized successfully');
} catch (error) {
  console.error('❌ Firebase Admin initialization failed:', error.message);
  console.log('⚠️ Running in mock mode');
}

const db = getFirestore();

// ============== HELPER FUNCTIONS ==============

async function getUserByEmail(email) {
  try {
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('email', '==', email.toLowerCase()).get();
    
    if (snapshot.empty) {
      return null;
    }
    
    const userDoc = snapshot.docs[0];
    return {
      id: userDoc.id,
      ...userDoc.data()
    };
  } catch (error) {
    console.error('Error getting user by email:', error);
    return null;
  }
}

async function createUser(userData) {
  try {
    const usersRef = db.collection('users');
    const docRef = await usersRef.add({
      ...userData,
      email: userData.email.toLowerCase(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    
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
    return await bcrypt.compare(inputPassword, storedHash);
  } catch (error) {
    console.error('Password verification error:', error);
    return false;
  }
}

// ============== AUTHENTICATION ENDPOINTS ==============

// Login endpoint - FIXED FOR FIREBASE
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
    
    // Try to get user from Firebase
    let user = await getUserByEmail(email);
    
    if (!user) {
      console.log('❌ User not found in Firebase:', email);
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
    
    // Verify password
    const passwordValid = await verifyPassword(password, user.password);
    
    if (!passwordValid) {
      console.log('❌ Invalid password for user:', email);
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
    
    // Update last login
    try {
      await db.collection('users').doc(user.id).update({
        lastLogin: new Date().toISOString()
      });
    } catch (updateError) {
      console.log('Note: Could not update last login', updateError.message);
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
      
      try {
        // Get user from Firebase
        const userDoc = await db.collection('users').doc(decoded.userId).get();
        
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
            id: userDoc.id,
            email: userData.email,
            fullName: userData.fullName || userData.email.split('@')[0],
            credits: userData.credits || 0,
            role: userData.role || 'user',
            createdAt: userData.createdAt
          }
        });
        
      } catch (dbError) {
        console.error('Database error in token verification:', dbError);
        res.status(500).json({
          success: false,
          message: 'Database error'
        });
      }
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
    
    if (!email || !password || !fullName) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
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
      lastLogin: null
    };
    
    // Save to Firebase
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
    
    // Get user from Firebase
    const userDoc = await db.collection('users').doc(decoded.userId).get();
    
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
        id: userDoc.id,
        email: userData.email,
        fullName: userData.fullName,
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

// Update user profile
app.put('/api/user/profile', async (req, res) => {
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
    const { fullName } = req.body;
    
    await db.collection('users').doc(decoded.userId).update({
      fullName: fullName,
      updatedAt: new Date().toISOString()
    });
    
    res.json({
      success: true,
      message: 'Profile updated successfully'
    });
    
  } catch (error) {
    console.error('Update profile error:', error);
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
    // For now, return mock numbers
    // TODO: Get numbers from Firebase
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
      }
    ];
    
    res.json({
      success: true,
      numbers: mockNumbers,
      count: mockNumbers.length,
      timestamp: new Date().toISOString()
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
    
    // Get user
    const userDoc = await db.collection('users').doc(decoded.userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    const userData = userDoc.data();
    
    // Find number (in production, get from Firebase)
    const mockNumbers = [
      { id: 'num-1', phoneNumber: '+16189401793', price: 0.30 },
      { id: 'num-2', phoneNumber: '+13252387176', price: 0.30 }
    ];
    
    const number = mockNumbers.find(n => n.id === numberId);
    
    if (!number) {
      return res.status(404).json({
        success: false,
        message: 'Number not found'
      });
    }
    
    // Check if user has enough credits
    if (userData.credits < number.price) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient credits'
      });
    }
    
    // Deduct credits and add number to user
    await db.collection('users').doc(decoded.userId).update({
      credits: FieldValue.increment(-number.price),
      purchasedNumbers: FieldValue.arrayUnion(number.phoneNumber),
      updatedAt: new Date().toISOString()
    });
    
    // Create transaction record (optional)
    await db.collection('transactions').add({
      userId: decoded.userId,
      type: 'purchase',
      amount: number.price,
      number: number.phoneNumber,
      timestamp: new Date().toISOString(),
      status: 'completed'
    });
    
    res.json({
      success: true,
      message: 'Purchase successful',
      data: {
        purchaseId: 'pur-' + Date.now(),
        number: number.phoneNumber,
        price: number.price,
        purchaseDate: new Date().toISOString(),
        newBalance: userData.credits - number.price
      }
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
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }
    
    // Get user from Firebase
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

// ============== UTILITY ENDPOINTS ==============

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Backend is running',
    mode: 'Firebase + JWT Authentication Mode',
    timestamp: new Date().toISOString(),
    firebase: process.env.FIREBASE_PROJECT_ID ? 'Configured' : 'Not configured'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'USANumbers Backend API',
    version: '1.0.0',
    endpoints: {
      auth: ['POST /api/login', 'POST /api/register', 'POST /api/verify-token'],
      user: ['GET /api/user/profile', 'PUT /api/user/profile'],
      numbers: ['GET /api/numbers', 'POST /api/purchase'],
      admin: ['POST /api/admin/login'],
      utility: ['GET /api/health']
    }
  });
});

// ============== ERROR HANDLING ==============

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.path
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('🔥 Server error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ USANumbers Backend running on port ${PORT}`);
  console.log('Mode: Firebase + JWT Authentication');
  console.log(`Firebase Project: ${process.env.FIREBASE_PROJECT_ID || 'Not configured'}`);
  console.log('Endpoints available at:');
  console.log(`  http://localhost:${PORT}/api/health`);
});
