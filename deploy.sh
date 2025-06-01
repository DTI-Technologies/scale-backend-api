#!/bin/bash

# Scale Backend Deployment Script
# This script handles building, testing, and deploying the Scale backend API

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_NAME="scale-backend"
DOCKER_IMAGE="scale-backend:latest"
BACKUP_DIR="./backups"
LOG_FILE="./deploy.log"

# Functions
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
    exit 1
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" | tee -a "$LOG_FILE"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a "$LOG_FILE"
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check if Docker is installed
    if ! command -v docker &> /dev/null; then
        error "Docker is not installed. Please install Docker first."
    fi
    
    # Check if Docker Compose is installed
    if ! command -v docker-compose &> /dev/null; then
        error "Docker Compose is not installed. Please install Docker Compose first."
    fi
    
    # Check if .env file exists
    if [ ! -f ".env" ]; then
        error ".env file not found. Please copy .env.example to .env and configure it."
    fi
    
    # Check if required environment variables are set
    source .env
    if [ -z "$JWT_SECRET" ] || [ -z "$MONGODB_URI" ]; then
        error "Required environment variables are not set. Please check your .env file."
    fi
    
    success "Prerequisites check passed"
}

# Run tests
run_tests() {
    log "Running tests..."
    
    if npm test; then
        success "All tests passed"
    else
        error "Tests failed. Deployment aborted."
    fi
}

# Build the application
build_application() {
    log "Building application..."
    
    # Install dependencies
    log "Installing dependencies..."
    npm ci
    
    # Run linting
    log "Running linter..."
    npm run lint
    
    # Build TypeScript
    log "Building TypeScript..."
    npm run build
    
    success "Application built successfully"
}

# Build Docker image
build_docker_image() {
    log "Building Docker image..."
    
    if docker build -t "$DOCKER_IMAGE" .; then
        success "Docker image built successfully"
    else
        error "Failed to build Docker image"
    fi
}

# Backup database
backup_database() {
    log "Creating database backup..."
    
    # Create backup directory
    mkdir -p "$BACKUP_DIR"
    
    # Generate backup filename with timestamp
    BACKUP_FILE="$BACKUP_DIR/scale-backup-$(date +'%Y%m%d-%H%M%S').gz"
    
    # Create MongoDB backup
    if docker-compose exec -T mongodb mongodump --archive --gzip > "$BACKUP_FILE"; then
        success "Database backup created: $BACKUP_FILE"
    else
        warning "Failed to create database backup"
    fi
}

# Deploy with Docker Compose
deploy_docker_compose() {
    log "Deploying with Docker Compose..."
    
    # Pull latest images
    docker-compose pull
    
    # Stop existing containers
    docker-compose down
    
    # Start services
    if docker-compose up -d; then
        success "Services started successfully"
    else
        error "Failed to start services"
    fi
    
    # Wait for services to be ready
    log "Waiting for services to be ready..."
    sleep 10
    
    # Check health
    if curl -f http://localhost:3000/health > /dev/null 2>&1; then
        success "Health check passed"
    else
        error "Health check failed"
    fi
}

# Deploy to production server
deploy_production() {
    log "Deploying to production server..."
    
    # Check if production server is configured
    if [ -z "$PRODUCTION_SERVER" ]; then
        error "PRODUCTION_SERVER environment variable not set"
    fi
    
    # Build and push Docker image
    docker tag "$DOCKER_IMAGE" "$DOCKER_REGISTRY/$DOCKER_IMAGE"
    docker push "$DOCKER_REGISTRY/$DOCKER_IMAGE"
    
    # Deploy to production server via SSH
    ssh "$PRODUCTION_SERVER" << EOF
        cd /opt/scale-backend
        docker-compose pull
        docker-compose down
        docker-compose up -d
        docker system prune -f
EOF
    
    success "Deployed to production server"
}

# Rollback deployment
rollback() {
    log "Rolling back deployment..."
    
    # Get the previous image
    PREVIOUS_IMAGE=$(docker images --format "table {{.Repository}}:{{.Tag}}" | grep scale-backend | sed -n '2p')
    
    if [ -n "$PREVIOUS_IMAGE" ]; then
        docker tag "$PREVIOUS_IMAGE" "$DOCKER_IMAGE"
        docker-compose down
        docker-compose up -d
        success "Rollback completed"
    else
        error "No previous image found for rollback"
    fi
}

# Show logs
show_logs() {
    log "Showing application logs..."
    docker-compose logs -f scale-backend
}

# Show status
show_status() {
    log "Showing service status..."
    docker-compose ps
    
    log "Checking health endpoint..."
    curl -s http://localhost:3000/health | jq '.' || echo "Health endpoint not responding"
}

# Cleanup old images and containers
cleanup() {
    log "Cleaning up old Docker images and containers..."
    
    # Remove old images (keep last 3)
    docker images --format "table {{.Repository}}:{{.Tag}}\t{{.ID}}" | \
        grep scale-backend | \
        tail -n +4 | \
        awk '{print $2}' | \
        xargs -r docker rmi
    
    # Remove unused containers and networks
    docker system prune -f
    
    success "Cleanup completed"
}

# Main deployment function
main() {
    case "$1" in
        "test")
            check_prerequisites
            run_tests
            ;;
        "build")
            check_prerequisites
            build_application
            build_docker_image
            ;;
        "deploy")
            check_prerequisites
            build_application
            run_tests
            build_docker_image
            backup_database
            deploy_docker_compose
            cleanup
            ;;
        "production")
            check_prerequisites
            build_application
            run_tests
            build_docker_image
            backup_database
            deploy_production
            ;;
        "rollback")
            rollback
            ;;
        "logs")
            show_logs
            ;;
        "status")
            show_status
            ;;
        "cleanup")
            cleanup
            ;;
        *)
            echo "Usage: $0 {test|build|deploy|production|rollback|logs|status|cleanup}"
            echo ""
            echo "Commands:"
            echo "  test       - Run tests only"
            echo "  build      - Build application and Docker image"
            echo "  deploy     - Full deployment to local/staging environment"
            echo "  production - Deploy to production server"
            echo "  rollback   - Rollback to previous version"
            echo "  logs       - Show application logs"
            echo "  status     - Show service status"
            echo "  cleanup    - Clean up old Docker images"
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"
