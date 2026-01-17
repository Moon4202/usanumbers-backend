const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { initializeApp, applicationDefault, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const app = express();
app.use(cors());
app.use(express.json());

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'usanumbers-secret-key-2024';

// Firebase Admin Initialization
let db;
try {
  // Try to initialize Firebase with service account
  const serviceAccount = {
    type: "service_account",
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
  };
  
  initializeApp({
    credential: cert(serviceAccount)
  });
  
  db = getFirestore();
  console.log('✅ Firebase Admin initialized successfully');
  console.log(`📊 Firebase Project: ${process.env.FIREBASE_PROJECT_ID}`);
  
} catch (error) {
  console.error('❌ Firebase Admin initialization failed:', error.message);
  console.log('⚠️ Running in fallback mode without Firebase');
  
  // Fallback: Create mock database
  db = {
    collection: (name) => {
      console.log(`📝 Mock collection: ${name}`);
      return {
        where: () => ({ get: () => ({ empty: true, docs: [] }) }),
        doc: () => ({ 
          get: () => ({ exists: false }), 
          update: () => Promise.resolve(),
          set: () => Promise.resolve()
        }),
        add: (data) => {
          console.log('Mock add:', data);
          return Promise.resolve({ id: 'mock-id-' + Date.now() });
        }
      };
    }
  };
}

// ... rest of the code same as before ...

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ USANumbers Backend running on port ${PORT}`);
  console.log('Mode: Firebase + JWT Authentication');
  console.log('Endpoints available at:');
  console.log(`  http://localhost:${PORT}/api/health`);
});
