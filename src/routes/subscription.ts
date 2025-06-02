import express, { Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { User, SubscriptionTier, SubscriptionStatus } from '../models/User';
import { logger } from '../utils/logger';
import { goDaddyService } from '../services/goDaddyService';

const router = express.Router();

// Verify subscription status
router.post('/verify', [
  body('userId').notEmpty().withMessage('User ID is required'),
  body('extensionVersion').optional().isString(),
  body('source').optional().isString()
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { userId, extensionVersion, source } = req.body;

    // Find or create user
    let user = await User.findOne({ userId });

    if (!user) {
      // Create new user with Fan tier by default
      user = new User({
        userId,
        subscription: {
          tier: SubscriptionTier.FAN,
          status: SubscriptionStatus.ACTIVE,
          startDate: new Date(),
          isTrialActive: false
        },
        usageQuota: {
          promptsPerMonth: 75,
          promptsUsed: 0,
          resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        },
        features: ['chat', 'agent', 'codeCompletion'],
        metadata: {
          extensionVersion,
          source,
          lastActiveDate: new Date()
        }
      });

      await user.save();
      logger.info(`New user created: ${userId}`);
    } else {
      // Update metadata
      user.metadata.lastActiveDate = new Date();
      if (extensionVersion) user.metadata.extensionVersion = extensionVersion;
      if (source) user.metadata.source = source;

      // Check if usage quota needs reset
      if (user.usageQuota.resetDate < new Date()) {
        user.usageQuota.promptsUsed = 0;
        user.usageQuota.resetDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      }

      await user.save();
    }

    // Verify with GoDaddy if subscription ID exists
    if (user.subscription.goDaddySubscriptionId) {
      try {
        const goDaddyStatus = await goDaddyService.verifySubscription(
          user.subscription.goDaddySubscriptionId
        );

        if (goDaddyStatus.isActive !== (user.subscription.status === SubscriptionStatus.ACTIVE)) {
          user.subscription.status = goDaddyStatus.isActive ?
            SubscriptionStatus.ACTIVE : SubscriptionStatus.INACTIVE;
          await user.save();
        }
      } catch (error) {
        logger.warn(`Failed to verify GoDaddy subscription for user ${userId}:`, error);
      }
    }

    // Check subscription status
    const isActive = user.subscription.status === SubscriptionStatus.ACTIVE &&
                     (!user.subscription.endDate || user.subscription.endDate > new Date());
    const isTrialActive = user.subscription.isTrialActive &&
                          user.subscription.trialEndDate &&
                          user.subscription.trialEndDate > new Date();

    res.json({
      valid: isActive || isTrialActive,
      user: {
        userId: user.userId,
        tier: user.subscription.tier,
        status: user.subscription.status,
        features: user.features,
        usageQuota: {
          promptsPerMonth: user.usageQuota.promptsPerMonth,
          promptsUsed: user.usageQuota.promptsUsed,
          promptsRemaining: user.usageQuota.promptsPerMonth - user.usageQuota.promptsUsed,
          resetDate: user.usageQuota.resetDate
        },
        isTrialActive: isTrialActive,
        trialEndDate: user.subscription.trialEndDate
      }
    });

  } catch (error) {
    logger.error('Subscription verification error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to verify subscription'
    });
  }
});

// Update subscription (called from GoDaddy webhooks or manual updates)
router.put('/update/:userId', [
  param('userId').notEmpty().withMessage('User ID is required'),
  body('tier').isIn(Object.values(SubscriptionTier)).withMessage('Invalid subscription tier'),
  body('status').isIn(Object.values(SubscriptionStatus)).withMessage('Invalid subscription status'),
  body('goDaddySubscriptionId').optional().isString(),
  body('goDaddyCustomerId').optional().isString()
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { userId } = req.params;
    const { tier, status, goDaddySubscriptionId, goDaddyCustomerId } = req.body;

    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({
        error: 'User Not Found',
        message: 'User not found'
      });
    }

    // Update subscription
    user.subscription.tier = tier;
    user.subscription.status = status;

    if (goDaddySubscriptionId) {
      user.subscription.goDaddySubscriptionId = goDaddySubscriptionId;
    }

    if (goDaddyCustomerId) {
      user.subscription.goDaddyCustomerId = goDaddyCustomerId;
    }

    // Update features and quota based on tier
    const tierConfig = getTierConfiguration(tier);
    user.features = tierConfig.features;
    user.usageQuota.promptsPerMonth = tierConfig.promptsPerMonth;

    await user.save();

    logger.info(`Subscription updated for user ${userId}: ${tier} (${status})`);

    res.json({
      success: true,
      user: {
        userId: user.userId,
        tier: user.subscription.tier,
        status: user.subscription.status,
        features: user.features,
        usageQuota: {
          promptsPerMonth: user.usageQuota.promptsPerMonth,
          promptsUsed: user.usageQuota.promptsUsed,
          promptsRemaining: user.usageQuota.promptsPerMonth - user.usageQuota.promptsUsed,
          resetDate: user.usageQuota.resetDate
        }
      }
    });

  } catch (error) {
    logger.error('Subscription update error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update subscription'
    });
  }
});

// Get subscription info
router.get('/:userId', [
  param('userId').notEmpty().withMessage('User ID is required')
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { userId } = req.params;
    const user = await User.findOne({ userId });

    if (!user) {
      return res.status(404).json({
        error: 'User Not Found',
        message: 'User not found'
      });
    }

    res.json({
      user: {
        userId: user.userId,
        tier: user.subscription.tier,
        status: user.subscription.status,
        features: user.features,
        usageQuota: {
          promptsPerMonth: user.usageQuota.promptsPerMonth,
          promptsUsed: user.usageQuota.promptsUsed,
          promptsRemaining: user.usageQuota.promptsPerMonth - user.usageQuota.promptsUsed,
          resetDate: user.usageQuota.resetDate
        },
        isTrialActive: user.subscription.isTrialActive &&
                       user.subscription.trialEndDate &&
                       user.subscription.trialEndDate > new Date(),
        trialEndDate: user.subscription.trialEndDate,
        renewalDate: user.subscription.renewalDate
      }
    });

  } catch (error) {
    logger.error('Get subscription error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get subscription info'
    });
  }
});

// Get subscription purchase URL (PayLinks)
router.get('/purchase/:tier', [
  param('tier').isIn(['fan', 'developer', 'enterprise']).withMessage('Invalid subscription tier')
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { tier } = req.params;
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'User ID is required'
      });
    }

    // PayLink URLs for each tier
    const payLinks: { [key: string]: string } = {
      'fan': process.env.GODADDY_PAYLINK_FAN || 'https://scaleprotocol.net/pricing',
      'developer': process.env.GODADDY_PAYLINK_DEVELOPER || 'https://scaleprotocol.net/pricing',
      'enterprise': process.env.GODADDY_PAYLINK_ENTERPRISE || 'https://scaleprotocol.net/pricing'
    };

    const tierLower = tier.toLowerCase();

    // Log the purchase attempt for tracking
    logger.info(`Subscription purchase initiated: ${userId} -> ${tierLower}`);

    res.json({
      success: true,
      paymentUrl: payLinks[tierLower],
      tier: tierLower,
      message: 'Complete payment and return to VS Code to verify subscription',
      instructions: [
        '1. Click the payment link to open GoDaddy PayLink',
        '2. Complete your payment securely with GoDaddy',
        '3. Return to VS Code and use "Scale: Verify Subscription" command',
        '4. Your subscription will be activated automatically'
      ]
    });

  } catch (error) {
    logger.error('Failed to get subscription purchase URL:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get purchase URL'
    });
  }
});

// Manual subscription verification (for PayLinks)
router.post('/verify-payment', [
  body('userId').notEmpty().withMessage('User ID is required'),
  body('tier').isIn(['fan', 'developer', 'enterprise']).withMessage('Invalid subscription tier'),
  body('transactionId').optional().isString(),
  body('email').optional().isEmail()
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { userId, tier, transactionId, email } = req.body;

    // Find or create user
    let user = await User.findOne({ userId });
    if (!user) {
      user = new User({
        userId,
        email: email || `user-${userId}@scale.local`,
        subscription: {
          tier: SubscriptionTier.FAN,
          status: SubscriptionStatus.INACTIVE,
          startDate: new Date(),
          isTrialActive: true,
          trialEndDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days trial
        },
        features: ['chat', 'agent', 'codeCompletion'],
        usageQuota: {
          promptsPerMonth: 75,
          promptsUsed: 0,
          resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      });
    }

    // Update subscription based on tier
    const tierEnum = tier.toUpperCase() as keyof typeof SubscriptionTier;
    user.subscription.tier = SubscriptionTier[tierEnum];
    user.subscription.status = SubscriptionStatus.ACTIVE;
    user.subscription.startDate = new Date();
    user.subscription.endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    user.subscription.renewalDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    if (transactionId) {
      user.subscription.goDaddySubscriptionId = transactionId;
    }

    // Update features and quota based on tier
    const tierConfig = getTierConfiguration(user.subscription.tier);
    user.features = tierConfig.features;
    user.usageQuota.promptsPerMonth = tierConfig.promptsPerMonth;

    await user.save();

    logger.info(`Manual subscription verification completed: ${userId} -> ${tier} (Transaction: ${transactionId})`);

    res.json({
      success: true,
      message: 'Subscription verified and activated successfully',
      user: {
        userId: user.userId,
        tier: user.subscription.tier,
        status: user.subscription.status,
        features: user.features,
        usageQuota: {
          promptsPerMonth: user.usageQuota.promptsPerMonth,
          promptsUsed: user.usageQuota.promptsUsed,
          promptsRemaining: user.usageQuota.promptsPerMonth === -1 ? -1 : user.usageQuota.promptsPerMonth - user.usageQuota.promptsUsed,
          resetDate: user.usageQuota.resetDate
        },
        renewalDate: user.subscription.renewalDate
      }
    });

  } catch (error) {
    logger.error('Manual subscription verification error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to verify subscription'
    });
  }
});

// Helper function to get tier configuration
function getTierConfiguration(tier: SubscriptionTier) {
  switch (tier) {
    case SubscriptionTier.FAN:
      return {
        promptsPerMonth: 75,
        features: ['chat', 'agent', 'codeCompletion']
      };
    case SubscriptionTier.DEVELOPER:
      return {
        promptsPerMonth: -1, // Unlimited
        features: ['chat', 'agent', 'codeCompletion', 'dependencyVisualization', 'knowledgeBase']
      };
    case SubscriptionTier.ENTERPRISE:
      return {
        promptsPerMonth: -1, // Unlimited
        features: ['chat', 'agent', 'codeCompletion', 'dependencyVisualization', 'knowledgeBase', 'fineTuning', 'rbac', 'auditLogging', 'sso']
      };
    default:
      return {
        promptsPerMonth: 75,
        features: ['chat', 'agent', 'codeCompletion']
      };
  }
}

export { router as subscriptionRoutes };
