const express = require('express');
const router = express.Router();
const { checkLoggedIn } = require('../../../middlewares/roles');
const { isSecureTerminal } = require('../../../middlewares/security');
const { Address, User } = require('../../../models');
require('dotenv').config();

// Personal Wallet Plugin Routes
// This file contains all routes for the Personal Wallet plugin

// Plugin-specific authentication middleware
router.use(checkLoggedIn);

// Main consumer wallet page (consumerwallet.ejs)
router.get('/', async (req, res) => {
  try {
    // Load wallet data for the user
    const walletData = await loadWalletData(req.user.id);
    
    return res.render('plug-ins/coldwallet/coldwallet', { 
      title: 'Cold Wallet',
      stylesheets: ['/css/loading-overlay.css'],
      user: req.user || null,
      NODE_ENV: process.env.NODE_ENV,
      isSecureTerminal: isSecureTerminal(req),
      // Pass individual properties that templates expect
      addresses: walletData.addresses || [],
      baseUrl: req.baseUrl,
      selectedAddress: null, // Set default or pass from query params
      // TSS-related environment variables
      TssApiUrl: process.env.TSS_ORCHESTRATOR_API_URL,
      TssClientId: process.env.TSS_TOKEN_CLIENT_ID,
      TssClientSecret: process.env.TSS_TOKEN_CLIENT_SECRET,
      TssTokenUrl: process.env.TSS_TOKEN_URL,
      TssHelperUrl: process.env.TSS_HELPER_API_URL,
      walletData
    });
  } catch (error) {
    console.error('Cold Wallet Plugin - Error rendering main page:', error);
    res.status(500).render('error', { error: 'Failed to load Cold Wallet page' });
  }
});

// API: Get wallet addresses
router.get('/api/addresses', async (req, res) => {
  try {
    const addresses = await Address.findAll({
      where: { user_id: req.user.id },
      attributes: ['id', 'address', 'asset', 'partyGUID']
    });
    
    res.json({ success: true, addresses });
  } catch (error) {
    console.error('Cold Wallet Plugin - Error fetching addresses:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch addresses' });
  }
});

// API: Add new address (with retry logic for database locks)
router.post('/api/addresses', async (req, res) => {
  const maxRetries = 5;
  let attempt = 0;
  
  while (attempt < maxRetries) {
    try {
      const { address, partyGUID, asset, userId } = req.body || {};
      if (!address) return res.status(400).json({ error: 'Missing address' });

      // Validate toughkey_id exists if provided
      if (userId) {
        const userExists = await User.findByPk(userId);
        if (!userExists) {
          return res.status(400).json({ 
            error: 'Invalid userId - User does not exist',
            userId 
          });
        }
      }

      const [row, created] = await Address.findOrCreate({
        where: { address },
        defaults: {
          address,
          partyGUID,
          asset,
          user_id: userId ?? null
        }
      });
      
      if (!created) {
        const needsUpdate =
          (userId && row.user_id !== userId) ||
          (asset && row.asset !== asset) ||
          (partyGUID && row.partyGUID !== partyGUID);

        if (needsUpdate) {
          // Validate user_id again for updates
          if (userId && userId !== row.user_id) {
            const userExists = await User.findByPk(userId);
            if (!userExists) {
              return res.status(400).json({ 
                error: 'Invalid user_id for update - User does not exist',
                userId 
              });
            }
          }

          await row.update({
            user_id: (userId ?? row.user_id),
            asset: (asset ?? row.asset),
            partyGUID: (partyGUID ?? row.partyGUID)
          });
        }
      }

      return res.status(created ? 201 : 200).json(row);
      
    } catch (err) {
      attempt++;
      
      // Handle Foreign Key Constraint errors immediately (don't retry)
      if (err.name === 'SequelizeForeignKeyConstraintError') {
        console.error('POST /api/addresses failed - Foreign Key Constraint Error', {
          error: err.message,
          userId: req.body?.userId,
          address: req.body?.address
        });
        return res.status(400).json({ 
          error: 'Foreign key constraint failed - invalid user_id reference',
          details: err.message
        });
      }
      
      // Handle database lock/timeout errors with retry
      if (err.name === 'SequelizeTimeoutError' || 
          err.message?.includes('SQLITE_BUSY') || 
          err.message?.includes('database is locked')) {
        
        if (attempt < maxRetries) {
          const backoffDelay = Math.min(100 * Math.pow(2, attempt - 1), 2000);
          console.log(`Database locked, retrying attempt ${attempt}/${maxRetries} after ${backoffDelay}ms delay`);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
          continue;
        } else {
          console.error(`POST /api/addresses failed after ${maxRetries} retries - database permanently locked`);
          return res.status(503).json({ 
            error: 'Database temporarily unavailable, please try again',
            retries: maxRetries 
          });
        }
      }
      
      // For other errors, fail immediately
      console.error('POST /api/addresses failed with unexpected error', err);
      return res.status(500).json({ error: 'Internal error', details: err.message });
    }
  }
});

// API: Delete address
router.delete('/api/addresses/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    if (!address) {
      return res.status(400).json({ success: false, error: 'Address parameter is required' });
    }
    
    // Find the address record to ensure it belongs to the current user
    const addressRecord = await Address.findOne({
      where: { 
        address: address,
        user_id: req.user.id 
      }
    });
    
    if (!addressRecord) {
      return res.status(404).json({ 
        success: false, 
        error: 'Wallet address not found or does not belong to current user' 
      });
    }
    
    // Delete the address
    await addressRecord.destroy();
    
    console.log(`[Personal Wallet] Deleted address ${address} for user ${req.user.id}`);
    
    res.json({ 
      success: true, 
      message: 'Wallet address deleted successfully',
      address: address
    });
    
  } catch (error) {
    console.error('DELETE /api/addresses/:address failed', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to delete wallet address',
      details: error.message 
    });
  }
});

// Plugin health check endpoint
router.get('/health', (req, res) => {
  res.json({ 
    plugin: 'consumerwallet',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    config: {
      tssApiUrl: process.env.TSS_ORCHESTRATOR_API_URL || 'not_configured',
      nodeEnv: process.env.NODE_ENV
    }
  });
});

// Helper function to load wallet data
async function loadWalletData(userId) {
  try {
    const addresses = await Address.findAll({
      where: { user_id: userId },
      attributes: ['address', 'asset']
    });
    
    return {
      addresses: addresses || [],
      balance: {
        btc: 2.45738291, // Mock data - replace with real balance lookup
        usd: 156847.32
      },
      recentTransactions: [
        // Mock data - replace with real transaction history
        { type: 'in', amount: 0.05432109, address: '1A2B3C...7X8Y9Z', time: '2 hours ago' },
        { type: 'out', amount: 0.12345678, address: '3F4G5H...2K3L4M', time: '1 day ago' },
      ]
    };
  } catch (error) {
    console.error('Error loading wallet data:', error);
    return { addresses: [], balance: { btc: 0, usd: 0 }, recentTransactions: [] };
  }
}

module.exports = router;