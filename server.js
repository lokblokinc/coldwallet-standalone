require('dotenv').config();

const express = require('express');
const path = require('path');
const engine = require('ejs-mate');
const sequelize = require('./config/database');
const Address = require('./models/address');
const networkDetector = require('./utils/networkDetection');

const app = express();
const PORT = process.env.PORT || 3001;

// Configure EJS with ejs-mate
app.engine('ejs', engine);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/plug-ins/coldwallet/assets', express.static(path.join(__dirname, 'views/plug-ins/coldwallet/assets')));

// Request logging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Network detection middleware - block access if network detected
app.use((req, res, next) => {
  // Skip network check for health endpoint
  if (req.path === '/health') {
    return next();
  }

  // Check for bypass in development mode
  if (process.env.NODE_ENV === 'development' && req.query.bypass === 'network') {
    console.warn('⚠️  Network detection bypassed via query parameter (dev mode)');
    return next();
  }

  const detection = networkDetector.detect();
  
  if (detection.hasNetwork) {
    // Network detected - block access
    return res.status(403).render('network-blocked', {
      title: 'Cold Wallet Unavailable',
      stylesheets: ['/css/loading-overlay.css'],
      detection: {
        interfaces: detection.interfaces,
        gateway: detection.gateway,
        details: detection.details || {},
        timestamp: detection.timestamp
      }
    });
  }
  
  next();
});

// Main route - Cold Wallet UI
app.get('/', async (req, res) => {
  try {
    res.render('plug-ins/coldwallet/coldwallet', {
      title: 'Cold Wallet',
      stylesheets: ['/css/loading-overlay.css'],
      user: null,  // No authentication
      NODE_ENV: process.env.NODE_ENV || 'development',
      isSecureTerminal: false,  // No terminal enforcement
      addresses: [],  // Empty; UI uses localStorage
      baseUrl: '/',
      selectedAddress: null,
      // TSS environment variables
      TssApiUrl: process.env.TSS_ORCHESTRATOR_API_URL || null,
      TssClientId: process.env.TSS_TOKEN_CLIENT_ID || null,
      TssClientSecret: process.env.TSS_TOKEN_CLIENT_SECRET || null,
      TssTokenUrl: process.env.TSS_TOKEN_URL || null,
      TssHelperUrl: process.env.TSS_HELPER_API_URL || null,
      walletData: { addresses: [], balance: { btc: 0, usd: 0 }, recentTransactions: [] }
    });
  } catch (error) {
    console.error('Error rendering Cold Wallet page:', error);
    res.status(500).render('error', {
      title: 'Error',
      stylesheets: [],
      errorCode: 500,
      errorMessage: 'Failed to load Cold Wallet',
      errorDescription: error.message
    });
  }
});

// API: Get wallet addresses
app.get('/api/addresses', async (req, res) => {
  try {
    const addresses = await Address.findAll({
      attributes: ['id', 'address', 'asset', 'partyGUID']
    });
    res.json({ success: true, addresses });
  } catch (error) {
    console.error('Error fetching addresses:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch addresses' });
  }
});

// API: Add new address
app.post('/api/addresses', async (req, res) => {
  const maxRetries = 5;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const { address, partyGUID, asset, userId } = req.body || {};
      
      if (!address) {
        return res.status(400).json({ error: 'Missing address' });
      }

      const [row, created] = await Address.findOrCreate({
        where: { address },
        defaults: {
          address,
          partyGUID: partyGUID || '',
          asset: asset || 'BTC',
          user_id: userId || null
        }
      });

      if (!created) {
        const needsUpdate =
          (asset && row.asset !== asset) ||
          (partyGUID && row.partyGUID !== partyGUID);

        if (needsUpdate) {
          await row.update({
            asset: asset || row.asset,
            partyGUID: partyGUID || row.partyGUID
          });
        }
      }

      return res.status(created ? 201 : 200).json(row);

    } catch (err) {
      attempt++;

      if (err.name === 'SequelizeTimeoutError' || 
          err.message?.includes('SQLITE_BUSY') || 
          err.message?.includes('database is locked')) {
        
        if (attempt < maxRetries) {
          const backoffDelay = Math.min(100 * Math.pow(2, attempt - 1), 2000);
          console.log(`Database locked, retrying attempt ${attempt}/${maxRetries} after ${backoffDelay}ms`);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
          continue;
        } else {
          console.error(`POST /api/addresses failed after ${maxRetries} retries`);
          return res.status(503).json({ 
            error: 'Database temporarily unavailable',
            retries: maxRetries 
          });
        }
      }

      console.error('POST /api/addresses failed:', err);
      return res.status(500).json({ error: 'Internal error', details: err.message });
    }
  }
});

// API: Delete address
app.delete('/api/addresses/:address', async (req, res) => {
  try {
    const { address } = req.params;

    if (!address) {
      return res.status(400).json({ success: false, error: 'Address parameter is required' });
    }

    const addressRecord = await Address.findOne({ where: { address } });

    if (!addressRecord) {
      return res.status(404).json({ 
        success: false, 
        error: 'Wallet address not found' 
      });
    }

    await addressRecord.destroy();
    console.log(`Deleted address ${address}`);

    res.json({ 
      success: true, 
      message: 'Wallet address deleted successfully',
      address
    });

  } catch (error) {
    console.error('DELETE /api/addresses/:address failed:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to delete wallet address',
      details: error.message 
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  const detection = networkDetector.detect();
  
  res.json({
    status: detection.hasNetwork ? 'blocked' : 'healthy',
    timestamp: new Date().toISOString(),
    networkDetection: {
      enabled: detection.enabled,
      hasNetwork: detection.hasNetwork,
      interfaces: detection.interfaces || [],
      gateway: detection.gateway || false,
      details: detection.details || {},
      config: networkDetector.getConfig()
    },
    config: {
      tssApiUrl: process.env.TSS_ORCHESTRATOR_API_URL || 'not_configured',
      nodeEnv: process.env.NODE_ENV || 'development'
    }
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).render('error', {
    title: 'Error',
    stylesheets: [],
    errorCode: 500,
    errorMessage: 'Internal Server Error',
    errorDescription: err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Not Found',
    errorCode: 404,
    errorMessage: 'Page Not Found',
    errorDescription: `The page ${req.url} does not exist`
  });
});

// Initialize database and start server
async function startServer() {
  try {
    // Test database connection
    await sequelize.authenticate();
    console.log('✅ Database connected');

    // Sync database schema (creates/updates Addresses table)
    await sequelize.sync({ alter: true });
    console.log('✅ Database schema synced');

    // Start Express server
    app.listen(PORT, () => {
      console.log(`✅ Cold Wallet Standalone Server running on http://localhost:${PORT}`);
      console.log(`   Health check: http://localhost:${PORT}/health`);
      console.log(`   API: http://localhost:${PORT}/api/addresses`);
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();
