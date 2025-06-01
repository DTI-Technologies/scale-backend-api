import express, { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { User } from '../models/User';
import { logger } from '../utils/logger';
import { generateToken } from '../middleware/auth';

const router = express.Router();

// Generate authentication token for VS Code extension
router.post('/token', [
  body('userId').notEmpty().withMessage('User ID is required'),
  body('extensionVersion').optional().isString(),
  body('installationId').optional().isString()
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { userId, extensionVersion, installationId } = req.body;

    // Find or create user
    let user = await User.findOne({ userId });

    if (!user) {
      // Create new user with default settings
      user = new User({
        userId,
        subscription: {
          tier: 'fan',
          status: 'active',
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
          installationId,
          lastActiveDate: new Date()
        }
      });

      await user.save();
      logger.info(`New user created for authentication: ${userId}`);
    } else {
      // Update metadata
      user.metadata.lastActiveDate = new Date();
      if (extensionVersion) user.metadata.extensionVersion = extensionVersion;
      if (installationId) user.metadata.installationId = installationId;
      await user.save();
    }

    // Generate JWT token
    const token = generateToken(userId, user.email);

    res.json({
      success: true,
      token,
      user: {
        userId: user.userId,
        tier: user.subscription.tier,
        status: user.subscription.status,
        features: user.features
      }
    });

  } catch (error) {
    logger.error('Token generation error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to generate authentication token'
    });
  }
});

// Refresh token
router.post('/refresh', [
  body('userId').notEmpty().withMessage('User ID is required')
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { userId } = req.body;

    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({
        error: 'User Not Found',
        message: 'User not found'
      });
    }

    // Update last active date
    user.metadata.lastActiveDate = new Date();
    await user.save();

    // Generate new token
    const token = generateToken(userId, user.email);

    res.json({
      success: true,
      token,
      user: {
        userId: user.userId,
        tier: user.subscription.tier,
        status: user.subscription.status,
        features: user.features
      }
    });

  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to refresh authentication token'
    });
  }
});

export { router as authRoutes };
