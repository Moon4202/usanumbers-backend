const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Temporary in-memory storage
const tempNumbers = [
  { id: '1', phoneNumber: '+1 (618) XXX-XXXX', price: 0.30, type: 'SMS & Call', status: 'available' },
  { id: '2', phoneNumber: '+1 (325) XXX-XXXX', price: 0.30, type: 'SMS & Call', status: 'available' },
  { id: '3', phoneNumber: '+1 (415) XXX-XXXX', price: 0.30, type: 'SMS & Call', status: 'available' }
];

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'USANumbers Backend API',
    status: 'Active',
    mode: 'TEST MODE - Firebase pending',
    endpoints: ['/api/test', '/api/numbers', '/api/purchase']
  });
});

// Test route
app.get('/api/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Backend API is working in TEST mode',
    note: 'Firebase integration in progress',
    time: new Date().toISOString()
  });
});

// Get numbers
app.get('/api/numbers', (req, res) => {
  res.json({ 
    success: true, 
    numbers: tempNumbers,
    count: tempNumbers.length,
    note: 'Test data - Firebase integration soon'
  });
});

// Purchase endpoint
app.post('/api/purchase', (req, res) => {
  const { userId, numberId } = req.body;
  
  res.json({ 
    success: true, 
    message: 'Purchase API ready',
    userId: userId || 'test-user',
    numberId: numberId || 'test-number',
    note: 'Test mode - Real purchase coming soon'
  });
});

// Admin test endpoint
app.get('/api/admin/numbers', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Admin API endpoint',
    action: 'Add/Delete/Update numbers',
    note: 'Protected endpoint - add authentication later'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT} (TEST MODE)`);
});
