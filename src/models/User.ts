import mongoose, { Document, Schema } from 'mongoose';

export enum SubscriptionTier {
  FAN = 'fan',
  DEVELOPER = 'developer',
  ENTERPRISE = 'enterprise'
}

export enum SubscriptionStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
  TRIAL = 'trial'
}

export interface IUsageQuota {
  promptsPerMonth: number;
  promptsUsed: number;
  resetDate: Date;
  lastResetDate?: Date;
}

export interface ISubscription {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  startDate: Date;
  endDate?: Date;
  renewalDate?: Date;
  goDaddySubscriptionId?: string;
  goDaddyCustomerId?: string;
  paymentMethodId?: string;
  trialEndDate?: Date;
  isTrialActive: boolean;
}

export interface IUser extends Document {
  userId: string; // Unique identifier from VS Code extension
  email?: string;
  apiKey?: string; // User's OpenAI API key (encrypted)
  subscription: ISubscription;
  usageQuota: IUsageQuota;
  features: string[];
  metadata: {
    extensionVersion?: string;
    lastActiveDate?: Date;
    installationId?: string;
    source?: string; // Tracking parameter from pricing page
  };
  createdAt: Date;
  updatedAt: Date;
}

const UsageQuotaSchema = new Schema<IUsageQuota>({
  promptsPerMonth: { type: Number, required: true, default: 75 },
  promptsUsed: { type: Number, required: true, default: 0 },
  resetDate: { type: Date, required: true },
  lastResetDate: { type: Date }
});

const SubscriptionSchema = new Schema<ISubscription>({
  tier: {
    type: String,
    enum: Object.values(SubscriptionTier),
    required: true,
    default: SubscriptionTier.FAN
  },
  status: {
    type: String,
    enum: Object.values(SubscriptionStatus),
    required: true,
    default: SubscriptionStatus.ACTIVE
  },
  startDate: { type: Date, required: true, default: Date.now },
  endDate: { type: Date },
  renewalDate: { type: Date },
  goDaddySubscriptionId: { type: String },
  goDaddyCustomerId: { type: String },
  paymentMethodId: { type: String },
  trialEndDate: { type: Date },
  isTrialActive: { type: Boolean, default: false }
});

const UserSchema = new Schema<IUser>({
  userId: { type: String, required: true, unique: true, index: true },
  email: { type: String, sparse: true },
  apiKey: { type: String }, // Will be encrypted
  subscription: { type: SubscriptionSchema, required: true },
  usageQuota: { type: UsageQuotaSchema, required: true },
  features: [{ type: String }],
  metadata: {
    extensionVersion: { type: String },
    lastActiveDate: { type: Date, default: Date.now },
    installationId: { type: String },
    source: { type: String } // vscode_chat, vscode_agent, etc.
  }
}, {
  timestamps: true
});

// Indexes for performance
UserSchema.index({ 'subscription.goDaddySubscriptionId': 1 });
UserSchema.index({ 'subscription.goDaddyCustomerId': 1 });
UserSchema.index({ 'subscription.status': 1 });
UserSchema.index({ 'subscription.tier': 1 });
UserSchema.index({ 'metadata.lastActiveDate': 1 });

// Add methods to the interface
declare module 'mongoose' {
  interface Document {
    hasRemainingPrompts?(): boolean;
    incrementPromptUsage?(): void;
    resetUsageQuota?(): void;
    isSubscriptionActive?(): boolean;
    isTrialActive?(): boolean;
  }
}

// Methods
UserSchema.methods.hasRemainingPrompts = function(): boolean {
  return this.usageQuota.promptsPerMonth === -1 || this.usageQuota.promptsUsed < this.usageQuota.promptsPerMonth;
};

UserSchema.methods.incrementPromptUsage = function(): void {
  this.usageQuota.promptsUsed += 1;
  this.metadata.lastActiveDate = new Date();
};

UserSchema.methods.resetUsageQuota = function(): void {
  this.usageQuota.promptsUsed = 0;
  this.usageQuota.lastResetDate = new Date();
  this.usageQuota.resetDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
};

UserSchema.methods.isSubscriptionActive = function(): boolean {
  const now = new Date();
  return this.subscription.status === SubscriptionStatus.ACTIVE &&
         (!this.subscription.endDate || this.subscription.endDate > now);
};

UserSchema.methods.isTrialActive = function(): boolean {
  const now = new Date();
  return this.subscription.isTrialActive &&
         this.subscription.trialEndDate &&
         this.subscription.trialEndDate > now;
};

export const User = mongoose.model<IUser>('User', UserSchema);
