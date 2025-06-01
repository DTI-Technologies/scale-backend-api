# Scale Backend API

This is the backend API service for the Scale VS Code Extension, providing subscription management, usage tracking, and GoDaddy Payments integration.

## Features

- **Subscription Management**: Verify and manage user subscriptions across Fan, Developer, and Enterprise tiers
- **Usage Tracking**: Track prompt usage, feature access, and analytics
- **GoDaddy Payments Integration**: Handle subscription webhooks and payment processing
- **Authentication**: JWT-based authentication for secure API access
- **MongoDB Integration**: Persistent storage for user data and usage analytics
- **Rate Limiting**: Protection against API abuse
- **Comprehensive Logging**: Winston-based logging with file rotation

## Quick Start

### Prerequisites

- Node.js 18+ 
- MongoDB (local or cloud)
- GoDaddy Payments account (for production)

### Installation

1. **Install dependencies**:
   ```bash
   cd backend
   npm install
   ```

2. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Build the project**:
   ```bash
   npm run build
   ```

4. **Start the development server**:
   ```bash
   npm run dev
   ```

5. **Start the production server**:
   ```bash
   npm start
   ```

## Environment Configuration

Copy `.env.example` to `.env` and configure the following variables:

### Required Variables

```env
# Database
MONGODB_URI=mongodb://localhost:27017/scale-backend

# JWT Authentication
JWT_SECRET=your-super-secret-jwt-key-here

# GoDaddy Payments (Production)
GODADDY_API_KEY=your-godaddy-api-key
GODADDY_API_SECRET=your-godaddy-api-secret
GODADDY_WEBHOOK_SECRET=your-webhook-secret
```

### Optional Variables

```env
# Server
NODE_ENV=development
PORT=3000
FRONTEND_URL=https://scaleprotocol.net

# CORS
ALLOWED_ORIGINS=http://localhost:3000,https://scaleprotocol.net

# Logging
LOG_LEVEL=info

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

## API Endpoints

### Authentication
- `POST /api/auth/token` - Generate authentication token
- `POST /api/auth/refresh` - Refresh authentication token

### Subscription Management
- `POST /api/subscription/verify` - Verify subscription status
- `PUT /api/subscription/update/:userId` - Update subscription
- `GET /api/subscription/:userId` - Get subscription info

### Usage Tracking
- `POST /api/usage/track` - Track usage event
- `GET /api/usage/stats/:userId` - Get usage statistics
- `POST /api/usage/reset/:userId` - Reset usage quota (admin)

### Webhooks
- `POST /api/webhooks/godaddy/subscription` - GoDaddy subscription webhooks

### Health Check
- `GET /health` - Service health status

## Database Schema

### User Model
```typescript
{
  userId: string,           // Unique VS Code user identifier
  email?: string,           // User email from GoDaddy
  subscription: {
    tier: 'fan' | 'developer' | 'enterprise',
    status: 'active' | 'inactive' | 'cancelled' | 'expired',
    goDaddySubscriptionId?: string,
    goDaddyCustomerId?: string,
    startDate: Date,
    endDate?: Date,
    renewalDate?: Date
  },
  usageQuota: {
    promptsPerMonth: number,
    promptsUsed: number,
    resetDate: Date
  },
  features: string[],       // Available features for the tier
  metadata: {
    extensionVersion?: string,
    lastActiveDate?: Date,
    source?: string         // Tracking parameter
  }
}
```

### Usage Event Model
```typescript
{
  userId: string,
  eventId: string,
  type: 'prompt' | 'code_completion' | 'dependency_visualization' | ...,
  feature: string,
  timestamp: Date,
  metadata: {
    model?: string,
    tokensUsed?: number,
    responseTime?: number,
    success?: boolean
  }
}
```

## GoDaddy Payments Integration

### Webhook Setup

1. **Configure webhook endpoint** in your GoDaddy Payments dashboard:
   ```
   https://your-api-domain.com/api/webhooks/godaddy/subscription
   ```

2. **Set webhook secret** in environment variables:
   ```env
   GODADDY_WEBHOOK_SECRET=your-webhook-secret
   ```

3. **Supported webhook events**:
   - `subscription.created`
   - `subscription.updated`
   - `subscription.cancelled`
   - `subscription.expired`
   - `payment.succeeded`
   - `payment.failed`

### Plan ID Mapping

Configure your GoDaddy plan IDs to match subscription tiers:
- `scale-fan` → Fan Tier ($1/month)
- `scale-developer` → Developer Tier ($30/month)
- `scale-enterprise` → Enterprise Tier ($300/month)

## Deployment

### Docker Deployment

1. **Create Dockerfile**:
   ```dockerfile
   FROM node:18-alpine
   WORKDIR /app
   COPY package*.json ./
   RUN npm ci --only=production
   COPY dist ./dist
   EXPOSE 3000
   CMD ["npm", "start"]
   ```

2. **Build and run**:
   ```bash
   docker build -t scale-backend .
   docker run -p 3000:3000 --env-file .env scale-backend
   ```

### Cloud Deployment

#### Heroku
```bash
# Install Heroku CLI and login
heroku create scale-backend-api
heroku config:set MONGODB_URI=your-mongodb-uri
heroku config:set JWT_SECRET=your-jwt-secret
# ... set other environment variables
git push heroku main
```

#### AWS/DigitalOcean/etc.
1. Set up a Node.js server
2. Install dependencies and build the project
3. Configure environment variables
4. Set up MongoDB (Atlas recommended)
5. Configure reverse proxy (nginx)
6. Set up SSL certificate

## Development

### Scripts
- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm run test` - Run tests
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier

### Testing
```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Monitoring and Logging

### Logs
- Error logs: `logs/error.log`
- Combined logs: `logs/combined.log`
- Console output in development mode

### Health Monitoring
Monitor the `/health` endpoint for service status:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "version": "1.0.0"
}
```

## Security

- **Rate limiting**: 100 requests per 15 minutes per IP
- **CORS protection**: Configurable allowed origins
- **Helmet.js**: Security headers
- **JWT authentication**: Secure API access
- **Input validation**: Express-validator for all inputs
- **Webhook signature verification**: GoDaddy webhook security

## Support

For issues and questions:
- Check the logs in `logs/` directory
- Review environment configuration
- Verify MongoDB connection
- Test GoDaddy webhook connectivity
- Contact support at support@scaleprotocol.net
