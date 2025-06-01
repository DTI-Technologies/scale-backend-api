import express, { Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { User } from '../models/User';
import { UsageEvent, UsageEventType } from '../models/UsageEvent';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// Track usage event
router.post('/track', [
  body('userId').notEmpty().withMessage('User ID is required'),
  body('type').isIn(Object.values(UsageEventType)).withMessage('Invalid usage type'),
  body('feature').notEmpty().withMessage('Feature is required'),
  body('metadata').optional().isObject()
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { userId, type, feature, metadata = {} } = req.body;

    // Find user
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({
        error: 'User Not Found',
        message: 'User not found'
      });
    }

    // Check if user has permission for this feature
    if (!user.features.includes(feature)) {
      return res.status(403).json({
        error: 'Feature Not Available',
        message: `Feature '${feature}' is not available in your subscription tier`
      });
    }

    // Check prompt limits for prompt-based usage
    if (type === UsageEventType.PROMPT || type === UsageEventType.CHAT || type === UsageEventType.AGENT) {
      const hasRemaining = user.usageQuota.promptsPerMonth === -1 || user.usageQuota.promptsUsed < user.usageQuota.promptsPerMonth;
      if (!hasRemaining && user.usageQuota.promptsPerMonth !== -1) {
        return res.status(429).json({
          error: 'Usage Limit Exceeded',
          message: 'Monthly prompt limit exceeded',
          usageQuota: {
            promptsPerMonth: user.usageQuota.promptsPerMonth,
            promptsUsed: user.usageQuota.promptsUsed,
            promptsRemaining: 0,
            resetDate: user.usageQuota.resetDate
          }
        });
      }

      // Increment prompt usage
      user.usageQuota.promptsUsed += 1;
      user.metadata.lastActiveDate = new Date();
      await user.save();
    }

    // Create usage event
    const usageEvent = new UsageEvent({
      userId,
      eventId: uuidv4(),
      type,
      feature,
      timestamp: new Date(),
      metadata: {
        ...metadata,
        extensionVersion: user.metadata.extensionVersion,
        source: user.metadata.source
      }
    });

    await usageEvent.save();

    logger.info(`Usage tracked for user ${userId}: ${type}/${feature}`);

    res.json({
      success: true,
      eventId: usageEvent.eventId,
      usageQuota: {
        promptsPerMonth: user.usageQuota.promptsPerMonth,
        promptsUsed: user.usageQuota.promptsUsed,
        promptsRemaining: user.usageQuota.promptsPerMonth === -1 ? -1 :
          Math.max(0, user.usageQuota.promptsPerMonth - user.usageQuota.promptsUsed),
        resetDate: user.usageQuota.resetDate
      }
    });

  } catch (error) {
    logger.error('Usage tracking error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to track usage'
    });
  }
});

// Get usage statistics for a user
router.get('/stats/:userId', [
  param('userId').notEmpty().withMessage('User ID is required'),
  query('startDate').optional().isISO8601().withMessage('Invalid start date'),
  query('endDate').optional().isISO8601().withMessage('Invalid end date'),
  query('type').optional().isIn(Object.values(UsageEventType)).withMessage('Invalid usage type')
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
    const { startDate, endDate, type } = req.query;

    // Find user
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({
        error: 'User Not Found',
        message: 'User not found'
      });
    }

    // Build query
    const query: any = { userId };

    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate as string);
      if (endDate) query.timestamp.$lte = new Date(endDate as string);
    }

    if (type) {
      query.type = type;
    }

    // Get usage events
    const events = await UsageEvent.find(query).sort({ timestamp: -1 }).limit(1000);

    // Calculate statistics
    const stats = {
      totalEvents: events.length,
      eventsByType: {} as Record<string, number>,
      eventsByFeature: {} as Record<string, number>,
      eventsByDay: {} as Record<string, number>,
      averageResponseTime: 0,
      successRate: 0
    };

    let totalResponseTime = 0;
    let responseTimeCount = 0;
    let successCount = 0;

    events.forEach(event => {
      // Count by type
      stats.eventsByType[event.type] = (stats.eventsByType[event.type] || 0) + 1;

      // Count by feature
      stats.eventsByFeature[event.feature] = (stats.eventsByFeature[event.feature] || 0) + 1;

      // Count by day
      const day = event.timestamp.toISOString().split('T')[0];
      stats.eventsByDay[day] = (stats.eventsByDay[day] || 0) + 1;

      // Response time
      if (event.metadata.responseTime) {
        totalResponseTime += event.metadata.responseTime;
        responseTimeCount++;
      }

      // Success rate
      if (event.metadata.success !== false) {
        successCount++;
      }
    });

    stats.averageResponseTime = responseTimeCount > 0 ? totalResponseTime / responseTimeCount : 0;
    stats.successRate = events.length > 0 ? (successCount / events.length) * 100 : 0;

    res.json({
      user: {
        userId: user.userId,
        tier: user.subscription.tier,
        usageQuota: {
          promptsPerMonth: user.usageQuota.promptsPerMonth,
          promptsUsed: user.usageQuota.promptsUsed,
          promptsRemaining: user.usageQuota.promptsPerMonth === -1 ? -1 :
            Math.max(0, user.usageQuota.promptsPerMonth - user.usageQuota.promptsUsed),
          resetDate: user.usageQuota.resetDate
        }
      },
      stats,
      events: events.slice(0, 50) // Return latest 50 events
    });

  } catch (error) {
    logger.error('Get usage stats error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get usage statistics'
    });
  }
});

// Reset usage quota (admin only)
router.post('/reset/:userId', [
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

    user.usageQuota.promptsUsed = 0;
    user.usageQuota.resetDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await user.save();

    logger.info(`Usage quota reset for user ${userId}`);

    res.json({
      success: true,
      usageQuota: {
        promptsPerMonth: user.usageQuota.promptsPerMonth,
        promptsUsed: user.usageQuota.promptsUsed,
        promptsRemaining: user.usageQuota.promptsPerMonth === -1 ? -1 :
          user.usageQuota.promptsPerMonth - user.usageQuota.promptsUsed,
        resetDate: user.usageQuota.resetDate
      }
    });

  } catch (error) {
    logger.error('Reset usage quota error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to reset usage quota'
    });
  }
});

export { router as usageRoutes };
