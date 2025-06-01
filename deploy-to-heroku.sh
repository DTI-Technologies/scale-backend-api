#!/bin/bash

# Scale Backend - Heroku Deployment Script
# This script automates the deployment of Scale backend to Heroku

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

# Check if Heroku CLI is installed
check_heroku_cli() {
    log "Checking if Heroku CLI is installed..."
    if ! command -v heroku &> /dev/null; then
        error "Heroku CLI is not installed. Please install it first: https://devcenter.heroku.com/articles/heroku-cli"
    fi
    success "Heroku CLI is installed"
}

# Check if user is logged in to Heroku
check_heroku_login() {
    log "Checking Heroku login status..."
    if ! heroku auth:whoami &> /dev/null; then
        warning "Not logged in to Heroku. Please run 'heroku login' first."
        read -p "Would you like to login now? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            heroku login
        else
            error "Please login to Heroku and run this script again."
        fi
    fi
    success "Logged in to Heroku as $(heroku auth:whoami)"
}

# Create Heroku app
create_heroku_app() {
    log "Creating Heroku app..."
    
    # Check if app name is provided
    if [ -z "$1" ]; then
        APP_NAME="scale-backend-api"
        warning "No app name provided, using default: $APP_NAME"
    else
        APP_NAME="$1"
    fi
    
    # Try to create the app
    if heroku create "$APP_NAME" 2>/dev/null; then
        success "Created Heroku app: $APP_NAME"
    else
        warning "App name '$APP_NAME' might already exist or be taken."
        read -p "Enter a different app name: " NEW_APP_NAME
        if heroku create "$NEW_APP_NAME"; then
            APP_NAME="$NEW_APP_NAME"
            success "Created Heroku app: $APP_NAME"
        else
            error "Failed to create Heroku app"
        fi
    fi
    
    echo "$APP_NAME" > .heroku-app-name
    log "App name saved to .heroku-app-name"
}

# Set environment variables
set_environment_variables() {
    log "Setting environment variables..."
    
    # Read app name
    if [ -f .heroku-app-name ]; then
        APP_NAME=$(cat .heroku-app-name)
    else
        error "App name not found. Please run the create_heroku_app function first."
    fi
    
    # Set basic configuration
    heroku config:set NODE_ENV="production" --app "$APP_NAME"
    heroku config:set FRONTEND_URL="https://scaleprotocol.net" --app "$APP_NAME"
    heroku config:set LOG_LEVEL="info" --app "$APP_NAME"
    heroku config:set RATE_LIMIT_WINDOW_MS="900000" --app "$APP_NAME"
    heroku config:set RATE_LIMIT_MAX_REQUESTS="100" --app "$APP_NAME"
    
    # Set JWT configuration
    JWT_SECRET="scale-jwt-secret-2024-production-$(openssl rand -hex 16)"
    heroku config:set JWT_SECRET="$JWT_SECRET" --app "$APP_NAME"
    heroku config:set JWT_EXPIRES_IN="7d" --app "$APP_NAME"
    
    # Set encryption key
    ENCRYPTION_KEY="scale-encryption-key-2024-prod-$(openssl rand -hex 8)"
    heroku config:set ENCRYPTION_KEY="$ENCRYPTION_KEY" --app "$APP_NAME"
    
    # MongoDB URI (using the one from .env)
    if [ -f .env ]; then
        MONGODB_URI=$(grep MONGODB_URI .env | cut -d '=' -f2)
        heroku config:set MONGODB_URI="$MONGODB_URI" --app "$APP_NAME"
        success "MongoDB URI set from .env file"
    else
        warning "No .env file found. Please set MONGODB_URI manually:"
        echo "heroku config:set MONGODB_URI=\"your-mongodb-connection-string\" --app $APP_NAME"
    fi
    
    # Get app URL for CORS
    APP_URL="https://$APP_NAME.herokuapp.com"
    heroku config:set ALLOWED_ORIGINS="https://scaleprotocol.net,$APP_URL" --app "$APP_NAME"
    
    success "Environment variables set successfully"
    
    # Display GoDaddy configuration reminder
    warning "Don't forget to set GoDaddy Payments configuration:"
    echo "heroku config:set GODADDY_API_KEY=\"your-api-key\" --app $APP_NAME"
    echo "heroku config:set GODADDY_API_SECRET=\"your-api-secret\" --app $APP_NAME"
    echo "heroku config:set GODADDY_WEBHOOK_SECRET=\"your-webhook-secret\" --app $APP_NAME"
    echo "heroku config:set GODADDY_API_BASE_URL=\"https://api.godaddy.com\" --app $APP_NAME"
}

# Initialize git and deploy
deploy_to_heroku() {
    log "Preparing for deployment..."
    
    # Read app name
    if [ -f .heroku-app-name ]; then
        APP_NAME=$(cat .heroku-app-name)
    else
        error "App name not found. Please run the create_heroku_app function first."
    fi
    
    # Initialize git if not already done
    if [ ! -d .git ]; then
        log "Initializing git repository..."
        git init
        git add .
        git commit -m "Initial commit for Heroku deployment"
    else
        log "Git repository already exists, adding changes..."
        git add .
        if git diff --staged --quiet; then
            log "No changes to commit"
        else
            git commit -m "Update for Heroku deployment - $(date)"
        fi
    fi
    
    # Add Heroku remote if not exists
    if ! git remote | grep -q heroku; then
        log "Adding Heroku remote..."
        heroku git:remote -a "$APP_NAME"
    fi
    
    # Deploy to Heroku
    log "Deploying to Heroku..."
    git push heroku main
    
    success "Deployment completed!"
    
    # Get app URL
    APP_URL="https://$APP_NAME.herokuapp.com"
    success "Your app is available at: $APP_URL"
    
    # Test health endpoint
    log "Testing health endpoint..."
    sleep 10  # Wait for app to start
    if curl -f "$APP_URL/health" > /dev/null 2>&1; then
        success "Health check passed!"
    else
        warning "Health check failed. Check logs with: heroku logs --tail --app $APP_NAME"
    fi
}

# Main function
main() {
    log "Starting Scale Backend deployment to Heroku..."
    
    # Check prerequisites
    check_heroku_cli
    check_heroku_login
    
    # Get app name from command line argument
    APP_NAME_ARG="$1"
    
    case "${2:-all}" in
        "create")
            create_heroku_app "$APP_NAME_ARG"
            ;;
        "config")
            set_environment_variables
            ;;
        "deploy")
            deploy_to_heroku
            ;;
        "all")
            create_heroku_app "$APP_NAME_ARG"
            set_environment_variables
            deploy_to_heroku
            ;;
        *)
            echo "Usage: $0 [app-name] [create|config|deploy|all]"
            echo "  app-name: Name for your Heroku app (optional, defaults to scale-backend-api)"
            echo "  create:   Only create the Heroku app"
            echo "  config:   Only set environment variables"
            echo "  deploy:   Only deploy the code"
            echo "  all:      Do everything (default)"
            exit 1
            ;;
    esac
    
    success "Script completed successfully!"
    
    # Display next steps
    echo
    log "Next steps:"
    echo "1. Configure GoDaddy Payments API credentials"
    echo "2. Set up webhooks in GoDaddy dashboard"
    echo "3. Update your VS Code extension to use the production URL"
    echo "4. Test the complete integration"
    echo
    echo "Your app URL: https://$(cat .heroku-app-name 2>/dev/null || echo 'your-app-name').herokuapp.com"
    echo "Webhook URL: https://$(cat .heroku-app-name 2>/dev/null || echo 'your-app-name').herokuapp.com/api/webhooks/godaddy/subscription"
}

# Run main function with all arguments
main "$@"
