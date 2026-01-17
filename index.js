const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

// Firebase REST API configuration
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'usanumbers-secret-key-2024';

// Temporary user storage (in production, use Firebase)
const tempUsers = [
  {
    id: '1',
    email: 'demo@example.com',
    password: '$2a$10$YourHashedPasswordHere', // "password123"
    fullName: 'Demo User',
    credits: 25.50,
    purchasedNumbers: [],
    role: 'user',
    createdAt: new Date().toISOString()
  }
];

// Helper function to get Firebase access token
async function getFirebaseAccessToken() {
  try {
    const { GoogleAuth } = require('google-auth-library');
    const auth = new GoogleAuth({
      credentials: {
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        project_id: process.env.FIREBASE_PROJECT_ID
      },
      scopes: ['https://www.googleapis.com/auth/datastore']
    });
    
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    return token.token;
  } catch (error) {
    console.error('Failed to get access token:', error.message);
    return null;
  }
}

// ============== AUTHENTICATION ENDPOINTS ==============

// Login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Input validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }
    
    // Find user (temporary - replace with Firebase)
    const user = tempUsers.find(u => u.email.toLowerCase() === email.toLowerCase());
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // In production, compare with bcrypt
    // For demo, accept any password for demo@example.com
    if (email.toLowerCase() === 'demo@example.com') {
      // Demo user - accept any password
      const token = jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      
      return res.json({
        success: true,
        token: token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          credits: user.credits,
          role: user.role
        },
        message: 'Login successful'
      });
    }
    
    // For other users (when Firebase is connected)
    // const passwordMatch = await bcrypt.compare(password, user.password);
    // if (!passwordMatch) {
    //   return res.status(401).json({
    //     success: false,
    //     message: 'Invalid credentials'
    //   });
    // }
    
    // For now, reject non-demo users
    return res.status(401).json({
      success: false,
      message: 'Please use demo@example.com for testing'
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
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
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(401).json({
          success: false,
          message: 'Invalid or expired token'
        });
      }
      
      // Find user
      const user = tempUsers.find(u => u.id === decoded.userId);
      
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'User not found'
        });
      }
      
      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          credits: user.credits,
          role: user.role
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

// Register endpoint (for future use)
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    
    // Input validation
    if (!email || !password || !fullName) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }
    
    // Check if user already exists
    const existingUser = tempUsers.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists'
      });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create new user
    const newUser = {
      id: 'user-' + Date.now(),
      email: email,
      password: hashedPassword,
      fullName: fullName,
      credits: 0,
      purchasedNumbers: [],
      role: 'user',
      createdAt: new Date().toISOString()
    };
    
    tempUsers.push(newUser);
    
    // Generate token
    const token = jwt.sign(
      { userId: newUser.id, email: newUser.email, role: newUser.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({
      success: true,
      token: token,
      user: {
        id: newUser.id,
        email: newUser.email,
        fullName: newUser.fullName,
        credits: newUser.credits,
        role: newUser.role
      },
      message: 'Registration successful'
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// ============== OTHER ENDPOINTS ==============

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Backend is running',
    mode: 'REST API Mode with Authentication',
    timestamp: new Date().toISOString()
  });
});

// Get numbers
app.get('/api/numbers', async (req, res) => {
  try {
    const mockNumbers = [
      {
        id: 'num-1',
        phoneNumber: '+16189401793',
        price: 0.30,
        status: 'available',
        type: 'SMS & Call',
        areaCode: '618'
      },
      {
        id: 'num-2',
        phoneNumber: '+13252387176',
        price: 0.30,
        status: 'available',
        type: 'SMS & Call',
        areaCode: '325'
      },
      {
        id: 'num-3',
        phoneNumber: '+19082345678',
        price: 0.30,
        status: 'available',
        type: 'SMS & Call',
        areaCode: '908'
      },
      {
        id: 'num-4',
        phoneNumber: '+14155238910',
        price: 0.30,
        status: 'available',
        type: 'SMS & Call',
        areaCode: '415'
      }
    ];
    
    res.json({
      success: true,
      numbers: mockNumbers,
      count: mockNumbers.length,
      note: 'Mock data - Firebase integration coming soon',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Purchase endpoint (protected)
app.post('/api/purchase', async (req, res) => {
  try {
    // Check authentication
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
    
    // Find the number
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
    
    // Simulate purchase
    res.json({
      success: true,
      message: 'Purchase successful',
      data: {
        purchaseId: 'pur-' + Date.now(),
        number: number.phoneNumber,
        price: number.price,
        purchaseDate: new Date().toISOString()
      },
      userId: decoded.userId
    });
    
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    console.error('Purchase error:', error);
    res.status(500).json({
      success: false,
      error: error.message
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
    
    // Find user
    const user = tempUsers.find(u => u.id === decoded.userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        credits: user.credits,
        purchasedNumbers: user.purchasedNumbers,
        createdAt: user.createdAt
      }
    });
    
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Test endpoint
app.get('/api/firebase-test', async (req, res) => {
  try {
    const accessToken = await getFirebaseAccessToken();
    
    if (!accessToken) {
      return res.json({
        success: false,
        message: 'Could not get Firebase access token'
      });
    }
    
    res.json({
      success: true,
      message: 'Firebase access token obtained',
      tokenAvailable: true,
      projectId: FIREBASE_PROJECT_ID
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ USANumbers Backend running on port ${PORT}`);
  console.log('Mode: JWT Authentication + Mock Data');
  console.log('Endpoints available:');
  console.log('  POST /api/login');
  console.log('  POST /api/verify-token');
  console.log('  POST /api/register');
  console.log('  GET  /api/numbers');
  console.log('  POST /api/purchase');
  console.log('  GET  /api/user/profile');
});
