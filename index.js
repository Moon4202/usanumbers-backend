const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Test if environment variables are loading
app.get('/api/env-check', (req, res) => {
  res.json({
    projectId: process.env.FIREBASE_PROJECT_ID ? 'Set' : 'Missing',
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL ? 'Set' : 'Missing',
    privateKey: process.env.FIREBASE_PRIVATE_KEY ? 'Set (Length: ' + process.env.FIREBASE_PRIVATE_KEY.length + ')' : 'Missing'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Environment check:');
  console.log('- Project ID:', process.env.FIREBASE_PROJECT_ID || 'Missing');
  console.log('- Client Email:', process.env.FIREBASE_CLIENT_EMAIL ? 'Set' : 'Missing');
  console.log('- Private Key:', process.env.FIREBASE_PRIVATE_KEY ? 'Set' : 'Missing');
});
