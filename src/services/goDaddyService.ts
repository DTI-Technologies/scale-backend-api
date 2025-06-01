import axios from 'axios';
import { logger } from '../utils/logger';

export interface GoDaddySubscriptionStatus {
  subscriptionId: string;
  customerId: string;
  planId: string;
  status: string;
  isActive: boolean;
  nextBillingDate?: Date | undefined;
  amount?: number;
  currency?: string;
}

export interface GoDaddyCustomer {
  customerId: string;
  email: string;
  name?: string;
  createdAt: Date;
}

class GoDaddyService {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.GODADDY_API_KEY || '';
    this.apiSecret = process.env.GODADDY_API_SECRET || '';
    this.baseUrl = process.env.GODADDY_API_BASE_URL || 'https://api.godaddy.com';

    if (!this.apiKey || !this.apiSecret) {
      logger.warn('GoDaddy API credentials not configured');
    }
  }

  /**
   * Verify subscription status with GoDaddy
   */
  async verifySubscription(subscriptionId: string): Promise<GoDaddySubscriptionStatus> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/v1/subscriptions/${subscriptionId}`,
        {
          headers: {
            'Authorization': `sso-key ${this.apiKey}:${this.apiSecret}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const subscription = response.data;

      return {
        subscriptionId: subscription.subscriptionId,
        customerId: subscription.customerId,
        planId: subscription.planId,
        status: subscription.status,
        isActive: subscription.status === 'ACTIVE',
        nextBillingDate: subscription.nextBillingDate ? new Date(subscription.nextBillingDate) : undefined,
        amount: subscription.amount,
        currency: subscription.currency
      };
    } catch (error) {
      logger.error(`Failed to verify GoDaddy subscription ${subscriptionId}:`, error);
      throw new Error('Failed to verify subscription with GoDaddy');
    }
  }

  /**
   * Get customer information from GoDaddy
   */
  async getCustomer(customerId: string): Promise<GoDaddyCustomer> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/v1/customers/${customerId}`,
        {
          headers: {
            'Authorization': `sso-key ${this.apiKey}:${this.apiSecret}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const customer = response.data;

      return {
        customerId: customer.customerId,
        email: customer.email,
        name: customer.name,
        createdAt: new Date(customer.createdAt)
      };
    } catch (error) {
      logger.error(`Failed to get GoDaddy customer ${customerId}:`, error);
      throw new Error('Failed to get customer from GoDaddy');
    }
  }

  /**
   * Cancel subscription with GoDaddy
   */
  async cancelSubscription(subscriptionId: string, reason?: string): Promise<boolean> {
    try {
      await axios.post(
        `${this.baseUrl}/v1/subscriptions/${subscriptionId}/cancel`,
        {
          reason: reason || 'Customer requested cancellation'
        },
        {
          headers: {
            'Authorization': `sso-key ${this.apiKey}:${this.apiSecret}`,
            'Content-Type': 'application/json'
          }
        }
      );

      logger.info(`Successfully cancelled GoDaddy subscription ${subscriptionId}`);
      return true;
    } catch (error) {
      logger.error(`Failed to cancel GoDaddy subscription ${subscriptionId}:`, error);
      throw new Error('Failed to cancel subscription with GoDaddy');
    }
  }

  /**
   * Update subscription plan
   */
  async updateSubscriptionPlan(subscriptionId: string, newPlanId: string): Promise<boolean> {
    try {
      await axios.put(
        `${this.baseUrl}/v1/subscriptions/${subscriptionId}`,
        {
          planId: newPlanId
        },
        {
          headers: {
            'Authorization': `sso-key ${this.apiKey}:${this.apiSecret}`,
            'Content-Type': 'application/json'
          }
        }
      );

      logger.info(`Successfully updated GoDaddy subscription ${subscriptionId} to plan ${newPlanId}`);
      return true;
    } catch (error) {
      logger.error(`Failed to update GoDaddy subscription ${subscriptionId}:`, error);
      throw new Error('Failed to update subscription with GoDaddy');
    }
  }

  /**
   * Get subscription history
   */
  async getSubscriptionHistory(subscriptionId: string): Promise<any[]> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/v1/subscriptions/${subscriptionId}/history`,
        {
          headers: {
            'Authorization': `sso-key ${this.apiKey}:${this.apiSecret}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data.events || [];
    } catch (error) {
      logger.error(`Failed to get GoDaddy subscription history ${subscriptionId}:`, error);
      throw new Error('Failed to get subscription history from GoDaddy');
    }
  }

  /**
   * Create a checkout session for subscription
   */
  async createCheckoutSession(planId: string, customerEmail: string, metadata: any): Promise<string> {
    try {
      const response = await axios.post(
        `${this.baseUrl}/v1/checkout/sessions`,
        {
          planId,
          customerEmail,
          metadata,
          successUrl: `${process.env.FRONTEND_URL}/subscription/success`,
          cancelUrl: `${process.env.FRONTEND_URL}/subscription/cancel`
        },
        {
          headers: {
            'Authorization': `sso-key ${this.apiKey}:${this.apiSecret}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data.checkoutUrl;
    } catch (error) {
      logger.error('Failed to create GoDaddy checkout session:', error);
      throw new Error('Failed to create checkout session with GoDaddy');
    }
  }

  /**
   * Validate webhook signature
   */
  validateWebhookSignature(payload: string, signature: string, secret: string): boolean {
    const crypto = require('crypto');
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return signature === expectedSignature;
  }
}

export const goDaddyService = new GoDaddyService();
