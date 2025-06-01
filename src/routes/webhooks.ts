import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { User, SubscriptionTier, SubscriptionStatus } from '../models/User';
import { logger } from '../utils/logger';

const router = express.Router();

// GoDaddy webhook endpoint for subscription events
router.post('/godaddy/subscription', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  try {
    // Verify webhook signature
    const signature = req.headers['x-godaddy-signature'] as string;
    const webhookSecret = process.env.GODADDY_WEBHOOK_SECRET;

    if (webhookSecret && signature) {
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(req.body)
        .digest('hex');

      if (signature !== expectedSignature) {
        logger.warn('Invalid GoDaddy webhook signature');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const event = JSON.parse(req.body.toString());
    logger.info('GoDaddy webhook received:', event);

    // Process different event types
    switch (event.type) {
      case 'subscription.created':
        await handleSubscriptionCreated(event.data);
        break;
      case 'subscription.updated':
        await handleSubscriptionUpdated(event.data);
        break;
      case 'subscription.cancelled':
        await handleSubscriptionCancelled(event.data);
        break;
      case 'subscription.expired':
        await handleSubscriptionExpired(event.data);
        break;
      case 'payment.succeeded':
        await handlePaymentSucceeded(event.data);
        break;
      case 'payment.failed':
        await handlePaymentFailed(event.data);
        break;
      default:
        logger.warn(`Unknown webhook event type: ${event.type}`);
    }

    res.status(200).json({ received: true });

  } catch (error) {
    logger.error('GoDaddy webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Handle subscription created
async function handleSubscriptionCreated(data: any) {
  try {
    const { subscriptionId, customerId, planId, customerEmail, metadata } = data;

    // Extract user ID from metadata (should be passed during subscription creation)
    const userId = metadata?.userId;
    if (!userId) {
      logger.error('No userId found in subscription metadata');
      return;
    }

    // Map plan ID to subscription tier
    const tier = mapPlanIdToTier(planId);

    // Find or create user
    let user = await User.findOne({ userId });
    if (!user) {
      user = new User({
        userId,
        email: customerEmail,
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
        features: ['chat', 'agent', 'codeCompletion']
      });
    }

    // Update subscription
    user.subscription.tier = tier;
    user.subscription.status = SubscriptionStatus.ACTIVE;
    user.subscription.goDaddySubscriptionId = subscriptionId;
    user.subscription.goDaddyCustomerId = customerId;
    user.subscription.startDate = new Date();
    user.subscription.isTrialActive = false;

    if (customerEmail) {
      user.email = customerEmail;
    }

    // Update features and quota based on tier
    const tierConfig = getTierConfiguration(tier);
    user.features = tierConfig.features;
    user.usageQuota.promptsPerMonth = tierConfig.promptsPerMonth;

    await user.save();

    logger.info(`Subscription created for user ${userId}: ${tier}`);
  } catch (error) {
    logger.error('Error handling subscription created:', error);
  }
}

// Handle subscription updated
async function handleSubscriptionUpdated(data: any) {
  try {
    const { subscriptionId, planId, status } = data;

    const user = await User.findOne({ 'subscription.goDaddySubscriptionId': subscriptionId });
    if (!user) {
      logger.error(`User not found for subscription ${subscriptionId}`);
      return;
    }

    // Update tier if plan changed
    if (planId) {
      const newTier = mapPlanIdToTier(planId);
      user.subscription.tier = newTier;

      // Update features and quota
      const tierConfig = getTierConfiguration(newTier);
      user.features = tierConfig.features;
      user.usageQuota.promptsPerMonth = tierConfig.promptsPerMonth;
    }

    // Update status
    if (status) {
      user.subscription.status = mapGoDaddyStatusToSubscriptionStatus(status);
    }

    await user.save();

    logger.info(`Subscription updated for user ${user.userId}: ${user.subscription.tier} (${user.subscription.status})`);
  } catch (error) {
    logger.error('Error handling subscription updated:', error);
  }
}

// Handle subscription cancelled
async function handleSubscriptionCancelled(data: any) {
  try {
    const { subscriptionId } = data;

    const user = await User.findOne({ 'subscription.goDaddySubscriptionId': subscriptionId });
    if (!user) {
      logger.error(`User not found for subscription ${subscriptionId}`);
      return;
    }

    user.subscription.status = SubscriptionStatus.CANCELLED;
    user.subscription.endDate = new Date();

    await user.save();

    logger.info(`Subscription cancelled for user ${user.userId}`);
  } catch (error) {
    logger.error('Error handling subscription cancelled:', error);
  }
}

// Handle subscription expired
async function handleSubscriptionExpired(data: any) {
  try {
    const { subscriptionId } = data;

    const user = await User.findOne({ 'subscription.goDaddySubscriptionId': subscriptionId });
    if (!user) {
      logger.error(`User not found for subscription ${subscriptionId}`);
      return;
    }

    user.subscription.status = SubscriptionStatus.EXPIRED;
    user.subscription.endDate = new Date();

    // Downgrade to Fan tier
    user.subscription.tier = SubscriptionTier.FAN;
    const tierConfig = getTierConfiguration(SubscriptionTier.FAN);
    user.features = tierConfig.features;
    user.usageQuota.promptsPerMonth = tierConfig.promptsPerMonth;

    await user.save();

    logger.info(`Subscription expired for user ${user.userId}, downgraded to Fan tier`);
  } catch (error) {
    logger.error('Error handling subscription expired:', error);
  }
}

// Handle payment succeeded
async function handlePaymentSucceeded(data: any) {
  try {
    const { subscriptionId, amount, currency } = data;

    const user = await User.findOne({ 'subscription.goDaddySubscriptionId': subscriptionId });
    if (!user) {
      logger.error(`User not found for subscription ${subscriptionId}`);
      return;
    }

    // Update renewal date
    user.subscription.renewalDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
    user.subscription.status = SubscriptionStatus.ACTIVE;

    await user.save();

    logger.info(`Payment succeeded for user ${user.userId}: ${amount} ${currency}`);
  } catch (error) {
    logger.error('Error handling payment succeeded:', error);
  }
}

// Handle payment failed
async function handlePaymentFailed(data: any) {
  try {
    const { subscriptionId, reason } = data;

    const user = await User.findOne({ 'subscription.goDaddySubscriptionId': subscriptionId });
    if (!user) {
      logger.error(`User not found for subscription ${subscriptionId}`);
      return;
    }

    // Mark subscription as inactive but don't downgrade immediately
    // Give user a grace period to update payment method
    user.subscription.status = SubscriptionStatus.INACTIVE;

    await user.save();

    logger.warn(`Payment failed for user ${user.userId}: ${reason}`);
  } catch (error) {
    logger.error('Error handling payment failed:', error);
  }
}

// Helper functions
function mapPlanIdToTier(planId: string): SubscriptionTier {
  switch (planId) {
    case 'scale-fan':
      return SubscriptionTier.FAN;
    case 'scale-developer':
      return SubscriptionTier.DEVELOPER;
    case 'scale-enterprise':
      return SubscriptionTier.ENTERPRISE;
    default:
      return SubscriptionTier.FAN;
  }
}

function mapGoDaddyStatusToSubscriptionStatus(status: string): SubscriptionStatus {
  switch (status.toLowerCase()) {
    case 'active':
      return SubscriptionStatus.ACTIVE;
    case 'cancelled':
      return SubscriptionStatus.CANCELLED;
    case 'expired':
      return SubscriptionStatus.EXPIRED;
    case 'inactive':
      return SubscriptionStatus.INACTIVE;
    default:
      return SubscriptionStatus.INACTIVE;
  }
}

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

export { router as webhookRoutes };
