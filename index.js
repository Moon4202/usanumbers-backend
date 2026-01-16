const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Mock data - temporary
const mockNumbers = [
  { id: '1', phoneNumber: '+1 (618) 940-1793', price: 0.30, type: 'SMS & Call', status: 'available', apiUrl: 'https://sms.usa.com/api/6189401793?token=test123' },
  { id: '2', phoneNumber: '+1 (325) 238-7176', price: 0.30, type: 'SMS & Call', status: 'available', apiUrl: 'https://sms.usa.com/api/3252387176?token=test456' },
  { id: '3', phoneNumber: '+1 (415) 555-1234', price: 0.30, type: 'SMS & Call', status: 'available', apiUrl: 'https://sms.usa.com/api/4155551234?token=test789' }
];

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'USANumbers Backend API',
    status: 'Production Ready',
    mode: 'MOCK DATA - Firebase coming soon',
    endpoints: ['/api/numbers', '/api/purchase', '/api/admin'],
    time: new Date().toISOString()
  });
});

// Get numbers
app.get('/api/numbers', (req, res) => {
  const maskedNumbers = mockNumbers.map(num => ({
    ...num,
    displayNumber: maskNumber(num.phoneNumber),
    apiUrl: 'Hidden - Provided after purchase'
  }));
  
  res.json({ 
    success: true, 
    numbers: maskedNumbers,
    count: maskedNumbers.length,
    note: 'Real Firebase integration in progress'
  });
});

// Purchase number
app.post('/api/purchase', (req, res) => {
  const { userId, numberId } = req.body;
  
  const number = mockNumbers.find(n => n.id === numberId);
  if (!number) {
    return res.status(404).json({ success: false, error: 'Number not found' });
  }
  
  res.json({ 
    success: true, 
    message: 'Purchase successful!',
    number: {
      phoneNumber: number.phoneNumber,
      apiUrl: number.apiUrl,
      price: number.price
    },
    userId,
    note: 'Mock purchase - Real Firebase integration soon'
  });
});

// Admin endpoint
app.get('/api/admin/numbers', (req, res) => {
  res.json({ 
    success: true, 
    allNumbers: mockNumbers,
    total: mockNumbers.length,
    note: 'Admin endpoint - Add authentication'
  });
});

// Helper function
function maskNumber(phoneNumber) {
  const digits = phoneNumber.replace(/\D/g, '');
  if (digits.length >= 10) {
    const areaCode = digits.substring(0, 3);
    return `+1 (${areaCode}) XXX-XXXX`;
  }
  return phoneNumber;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ USANumbers Backend running on port ${PORT}`);
  console.log(`📞 Mock numbers: ${mockNumbers.length}`);
  console.log(`🔗 Endpoint: http://localhost:${PORT}`);
});
